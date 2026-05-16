/* ============================================================
   data.js — Fetches sources.json, all configured indices,
   normalizes into a unified model, and computes per-procedure
   coverage state.

   Public API:
     loadInsomniaData()  -> Promise<Model>

   Model shape:
     {
       sources: [{ Name, Type, BaseUrl, RawIndexBaseUrl, error? }],
       trrs:        Map<TRRID, TRR>           // TRR0011 -> {...}
       procedures:  Map<ProcID, Procedure>    // TRR0011.AD.A -> {...}
       pcrs:        Map<PCRID, PCR>
       pcrsByProc:  Map<ProcID, PCR[]>        // join key
       orphanedPcrs: PCR[]                    // PCRs referencing missing procedures
       loadErrors:  string[]
     }

   Each Procedure carries computed fields:
     state:    'covered' | 'partial' | 'gap' | 'opportunity'
     coveredCount, gapCount
     fraction: 0..1   (covered / (covered + gap), 0 if no records)
   ============================================================ */

// --- Constants ---------------------------------------------------------

const PCR_TYPE = {
  GAP:      'gap',
  COVERAGE: 'coverage',
  DETECTION:'detection',
};

const STATE = {
  COVERED:     'covered',
  PARTIAL:     'partial',
  GAP:         'gap',
  OPPORTUNITY: 'opportunity',
};

// --- PCR type classification ------------------------------------------

function classifyPcrType(rawType) {
  if (!rawType) return null;
  const t = String(rawType).trim().toLowerCase();
  if (t === 'gap record' || t === 'gap') return PCR_TYPE.GAP;
  if (t === 'coverage record' || t === 'coverage') return PCR_TYPE.COVERAGE;
  if (t.startsWith('detection')) return PCR_TYPE.DETECTION;
  return null;  // unknown type — treat as orphan/skip
}

function isCoveredType(classifiedType) {
  return classifiedType === PCR_TYPE.COVERAGE || classifiedType === PCR_TYPE.DETECTION;
}

// --- Fetch helpers ----------------------------------------------------

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
  return r.json();
}

function joinUrl(base, name) {
  if (!base) return name;
  return base.endsWith('/') ? base + name : base + '/' + name;
}

// --- Normalization ----------------------------------------------------

function normalizeTrr(raw, sourceName) {
  // Expand procedures map into Procedure records with stable IDs.
  const platformShort = (raw.platforms && raw.platforms[0])
    ? platformShortCode(raw.platforms[0])
    : 'XXX';

  const procedures = [];
  if (raw.procedures && typeof raw.procedures === 'object') {
    for (const [letter, name] of Object.entries(raw.procedures)) {
      const id = `${raw.id}.${platformShort}.${letter}`;
      procedures.push({
        id,
        trrId: raw.id,
        letter,
        name,
        platformShort,
        // computed later:
        coveredCount: 0,
        gapCount: 0,
        fraction: 0,
        state: STATE.OPPORTUNITY,
      });
    }
  }

  return {
    id: raw.id,
    name: raw.name,
    tactics:      raw.tactics      || [],
    platforms:    raw.platforms    || [],
    externalIds:  raw.external_ids || [],
    contributors: raw.contributors || [],
    pubDate:      raw.pub_date     || null,
    lastUpdate:   raw.last_update  || raw.pub_date || null,
    sourceName,
    procedureIds: procedures.map(p => p.id),
    procedures,        // also keep nested for convenience
  };
}

function normalizePcr(raw, sourceName) {
  return {
    id:         raw.id,
    title:      (raw.title || '').trim(),
    type:       classifyPcrType(raw.type),
    rawType:    raw.type,
    status:     raw.status || 'Active',
    platforms:  raw.platforms  || [],
    tactics:    raw.tactics    || [],
    techniques: raw.techniques || [],
    procedures: raw.procedures || [],
    contributors: raw.contributors || [],
    avlRule:    raw.avl_rule    || null,
    avlUseCase: raw.avl_use_case|| null,
    severity:   raw.severity    || null,
    confidence: raw.confidence  || null,
    pubDate:    raw.pub_date    || null,
    lastUpdate: raw.last_update || raw.pub_date || null,
    sourceName,
  };
}

// Map full platform name to the short code embedded in procedure IDs.
// (e.g. "Active Directory" -> "AD", "Windows" -> "WIN", "Azure" -> "AZR")
// This is best-effort; the canonical mapping should come from each TRR
// source's platforms.json eventually.
function platformShortCode(platformName) {
  const p = String(platformName).toLowerCase();
  if (p.includes('active directory')) return 'AD';
  if (p.includes('windows')) return 'WIN';
  if (p === 'azure' || p.startsWith('azure')) return 'AZR';
  if (p.includes('exchange')) return 'EXO';
  if (p.includes('linux')) return 'LIN';
  if (p.includes('mac')) return 'MAC';
  if (p.includes('kubernetes')) return 'K8S';
  if (p.includes('aws')) return 'AWS';
  if (p.includes('gcp') || p.includes('google cloud')) return 'GCP';
  if (p.includes('m365') || p.includes('microsoft 365') || p.includes('office')) return 'M365';
  // fallback: first 3 letters uppercased
  return platformName.slice(0, 3).toUpperCase();
}

// --- Coverage computation --------------------------------------------

function computeCoverageStates(model) {
  for (const proc of model.procedures.values()) {
    const pcrs = (model.pcrsByProc.get(proc.id) || [])
      .filter(p => p.status !== 'Retired');  // exclude retired by default
    let cov = 0, gap = 0;
    for (const pcr of pcrs) {
      if (pcr.type === PCR_TYPE.GAP) gap++;
      else if (isCoveredType(pcr.type)) cov++;
    }
    proc.coveredCount = cov;
    proc.gapCount = gap;
    proc.recordCount = cov + gap;

    if (cov === 0 && gap === 0) {
      proc.fraction = 0;
      proc.state = STATE.OPPORTUNITY;
    } else if (gap === 0) {
      proc.fraction = 1;
      proc.state = STATE.COVERED;
    } else if (cov === 0) {
      proc.fraction = 0;
      proc.state = STATE.GAP;
    } else {
      proc.fraction = cov / (cov + gap);
      proc.state = STATE.PARTIAL;
    }
  }
}

// --- Top-level loader -------------------------------------------------

export async function loadInsomniaData(configPath = 'sources.json') {
  const sources = await fetchJson(configPath);

  const model = {
    sources: sources.map(s => ({ ...s })),  // copies for mutation
    trrs: new Map(),
    procedures: new Map(),
    pcrs: new Map(),
    pcrsByProc: new Map(),
    orphanedPcrs: [],
    loadErrors: [],
  };

  // Fetch all source indices in parallel
  const fetches = model.sources.map(async (src) => {
    try {
      const indexUrl = joinUrl(src.RawIndexBaseUrl, 'index.json');
      const data = await fetchJson(indexUrl);
      if (!Array.isArray(data)) {
        throw new Error(`index.json from "${src.Name}" is not an array`);
      }
      if (src.Type === 'TRR') {
        for (const raw of data) {
          if (!raw.id) continue;
          const trr = normalizeTrr(raw, src.Name);
          model.trrs.set(trr.id, trr);
          for (const proc of trr.procedures) {
            model.procedures.set(proc.id, proc);
          }
        }
      } else if (src.Type === 'PCR') {
        for (const raw of data) {
          if (!raw.id) continue;
          const pcr = normalizePcr(raw, src.Name);
          model.pcrs.set(pcr.id, pcr);
        }
      } else {
        throw new Error(`Unknown source Type: ${src.Type}`);
      }
    } catch (e) {
      const msg = `Failed to load ${src.Type} source "${src.Name}": ${e.message}`;
      src.error = e.message;
      model.loadErrors.push(msg);
      console.error(msg);
    }
  });

  await Promise.all(fetches);

  // Build join: procedure id -> PCRs that reference it.
  // Identify orphans (PCRs that reference no known procedure).
  for (const pcr of model.pcrs.values()) {
    let anyValid = false;
    for (const procId of pcr.procedures) {
      if (model.procedures.has(procId)) {
        anyValid = true;
        if (!model.pcrsByProc.has(procId)) {
          model.pcrsByProc.set(procId, []);
        }
        model.pcrsByProc.get(procId).push(pcr);
      }
    }
    if (!anyValid) {
      model.orphanedPcrs.push(pcr);
    }
  }

  computeCoverageStates(model);

  // Library-only mode: no PCR sources configured at all (or all failed).
  // Drives the UI to hide coverage indicators.
  model.hasPcrSource = model.sources.some(s => s.Type === 'PCR' && !s.error);

  return model;
}

// Re-export for other modules
export { STATE, PCR_TYPE, isCoveredType };
