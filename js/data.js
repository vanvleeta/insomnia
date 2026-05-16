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

function normalizeTrr(raw, sourceName, nameToShort) {
  // Resolve the procedure ID's platform short code. Prefer the source's
  // platforms.json lookup; fall back to the heuristic for any miss.
  const firstPlatform = raw.platforms && raw.platforms[0];
  let platformShort = 'XXX';
  if (firstPlatform) {
    platformShort = (nameToShort && nameToShort.get(firstPlatform)) || heuristicShortCode(firstPlatform);
  }

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

// --- Platform short-code resolution ----------------------------------

// Heuristic fallback when platforms.json doesn't cover a value.
function heuristicShortCode(platformName) {
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
  // last-resort: first 3 chars uppercased
  return platformName.slice(0, 3).toUpperCase();
}

// Parse a platforms.json document into a name -> short_code map.
//
// Canonical TRR-library shape (the one we expect):
//   { "Active Directory": "ad", "Windows": "win", ... }   (name -> short)
//
// Also accepted defensively (in case other repos diverge):
//   { "AD": "Active Directory", ... }                     (short -> name)
//   [ { "name": "Windows", "id": "WIN" }, ... ]
//   [ "Windows", "AWS", ... ]                              (names only)
//
// Short codes are normalized to UPPERCASE because the existing procedure IDs
// (e.g. "TRR0030.WIN.A") use uppercase, regardless of the source's casing.
function parsePlatformsDoc(doc) {
  const nameToShort = new Map();
  const shortToName = new Map();
  if (!doc) return { nameToShort, shortToName };

  const record = (name, short) => {
    if (!name || !short) return;
    const upper = String(short).toUpperCase();
    nameToShort.set(name, upper);
    shortToName.set(upper, name);
  };

  if (Array.isArray(doc)) {
    for (const entry of doc) {
      if (typeof entry === 'string') {
        record(entry, heuristicShortCode(entry));
      } else if (entry && typeof entry === 'object') {
        const name = entry.name || entry.platform || entry.display || entry.label;
        const short = entry.id || entry.short || entry.code || entry.shortCode || entry.short_code;
        if (name) record(name, short || heuristicShortCode(name));
      }
    }
  } else if (typeof doc === 'object') {
    // Disambiguate map direction. The canonical shape has *long-form names as
    // keys* and short codes as values. Detect by checking whether values look
    // like short codes (short + alphanumeric).
    const entries = Object.entries(doc);
    const valuesLookLikeShorts = entries.length > 0 &&
      entries.every(([_, v]) =>
        typeof v === 'string' && v.length <= 6 && /^[A-Za-z0-9_]+$/.test(v));
    for (const [k, v] of entries) {
      if (typeof v !== 'string') continue;
      const name  = valuesLookLikeShorts ? k : v;
      const short = valuesLookLikeShorts ? v : k;
      record(name, short);
    }
  }
  return { nameToShort, shortToName };
}

// --- Normalization ----------------------------------------------------

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
    detachedPcrs: [],
    loadErrors: [],
    // Platform metadata, merged across TRR sources.
    platformNameToShort: new Map(),
    platformShortToName: new Map(),
    // Sets of platform display names seen (union across sources)
    trrPlatformNames: new Set(),
    pcrPlatformNames: new Set(),
  };

  // First pass: for each TRR source, fetch platforms.json (best-effort) so
  // we have a per-source name->short lookup ready when we normalize TRRs.
  const trrSourcePlatforms = new Map();  // source.Name -> { nameToShort, shortToName }
  await Promise.all(model.sources.map(async (src) => {
    if (src.Type !== 'TRR') return;
    try {
      const platUrl = joinUrl(src.RawIndexBaseUrl, 'platforms.json');
      const doc = await fetchJson(platUrl);
      const parsed = parsePlatformsDoc(doc);
      trrSourcePlatforms.set(src.Name, parsed);
      // Merge into model-wide platform tables.
      for (const [name, short] of parsed.nameToShort.entries()) {
        model.platformNameToShort.set(name, short);
        model.platformShortToName.set(short, name);
      }
    } catch (e) {
      // platforms.json is optional — fall back to heuristic silently.
      trrSourcePlatforms.set(src.Name, { nameToShort: new Map(), shortToName: new Map() });
    }
  }));

  // Second pass: fetch all source index.json files in parallel.
  const fetches = model.sources.map(async (src) => {
    try {
      const indexUrl = joinUrl(src.RawIndexBaseUrl, 'index.json');
      const data = await fetchJson(indexUrl);
      if (!Array.isArray(data)) {
        throw new Error(`index.json from "${src.Name}" is not an array`);
      }
      if (src.Type === 'TRR') {
        const platLookup = (trrSourcePlatforms.get(src.Name) || {}).nameToShort || new Map();
        for (const raw of data) {
          if (!raw.id) continue;
          const trr = normalizeTrr(raw, src.Name, platLookup);
          model.trrs.set(trr.id, trr);
          for (const proc of trr.procedures) {
            model.procedures.set(proc.id, proc);
          }
          for (const p of (raw.platforms || [])) model.trrPlatformNames.add(p);
        }
      } else if (src.Type === 'PCR') {
        for (const raw of data) {
          if (!raw.id) continue;
          const pcr = normalizePcr(raw, src.Name);
          model.pcrs.set(pcr.id, pcr);
          for (const p of (raw.platforms || [])) model.pcrPlatformNames.add(p);
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

  // Build join: procedure id -> PCRs that reference it. Distinguish:
  //   - detached: PCR explicitly references no procedures (empty list)
  //   - orphaned: PCR references procedure IDs we don't know about
  //   - normal:   at least one reference matches a known procedure
  for (const pcr of model.pcrs.values()) {
    if (!pcr.procedures || pcr.procedures.length === 0) {
      model.detachedPcrs.push(pcr);
      continue;
    }
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
