/* ============================================================
   data.js — Fetches local/config.json, all configured indices,
   normalizes into a unified model, and computes per-procedure
   coverage state.

   Public API:
     loadInsomniaData()      -> Promise<Model>
     trrUrl(trr, model)      -> string | null
     recordUrl(rec, model)   -> string | null

   Configuration (local/config.json):
     {
       "schema": 1,
       "excludePlatforms": ["AWS"],
       "sources": [
         { "Name": "TIRED Labs",
           "Type": "library" | "coverage" | "validation" | "emulation",
           "Repo": "https://github.com/owner/repo",   // one of these...
           "LocalPath": "data/example-library/",      // ...or this
           "Branch": "main" }                         // optional
       ]
     }

   After resolveSourceLocation runs, each source also carries:
     _rawBase   -> base URL/path for fetching index.json
     _linkBase  -> base URL for building README links (null for LocalPath)

   Index documents are envelopes (schema 2):
     { schema, generated, platforms: {name: short}, records: [...] }
   Anything else -- a bare array, or a platform map that is not a
   name-to-short-code object -- is rejected with a load error.

   Model shape:
     {
       sources: [resolved-source...],
       trrs:        Map<TRRKey, TRR>          // "TRR0033.AZR" -> {...}
       procedures:  Map<ProcID, Procedure>    // "TRR0011.AD.A" -> {...}
       records:     Map<RecordID, Record>     // coverage records
       recordsByProc: Map<ProcID, Record[]>   // join key
       platforms:   Map<Name, ShortCode>      // union across sources
       orphanedRecords: Record[]              // reference missing procedures
       detachedRecords: Record[]              // empty procedure list
       excludedRecords: Record[]              // excluded platforms only
       loadErrors:  string[]
       warnings:    string[]                  // cross-source problems
     }

   A TRR is keyed by ID *and* platform. A report covering two platforms
   produces one index record per platform folder, and keying by ID alone
   silently dropped one of them.
   ============================================================ */

// --- Constants ---------------------------------------------------------

const RECORD_TYPE = {
  GAP:      'gap',
  COVERAGE: 'coverage',
};

const SOURCE_TYPE = {
  LIBRARY:    'library',
  COVERAGE:   'coverage',
  VALIDATION: 'validation',
  EMULATION:  'emulation',
};

const STATE = {
  COVERED:     'covered',
  PARTIAL:     'partial',
  GAP:         'gap',
  OPPORTUNITY: 'opportunity',
};

const CONFIG_PATH = 'local/config.json';
const INDEX_SCHEMA_SUPPORTED = 2;

// Where a source's index is read from.
//   live    the browser fetches it from the repository directly
//   synced  the sync workflows bring it into data/<slug>/ and the browser
//           reads it from there
// Named for the behaviour rather than for repository visibility, because the
// two are independent: a public repository can reasonably be synced.
const LOAD = {
  LIVE:   'live',
  SYNCED: 'synced',
};
const DEFAULT_LOAD = LOAD.LIVE;

// Hosts the page's Content-Security-Policy lets a live source be fetched
// from. Kept in step with connect-src in the HTML pages.
const CSP_ALLOWED_HOSTS = ['raw.githubusercontent.com'];

// --- Record type classification ---------------------------------------

function classifyRecordType(rawType) {
  if (!rawType) return null;
  const t = String(rawType).trim().toLowerCase();
  if (t === 'gap' || t === 'gap record') return RECORD_TYPE.GAP;
  if (t === 'coverage' || t === 'coverage record') return RECORD_TYPE.COVERAGE;
  return null;  // unknown type — treat as orphan/skip
}

function isCoveredType(classifiedType) {
  return classifiedType === RECORD_TYPE.COVERAGE;
}

// --- Fetch helpers ----------------------------------------------------

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
  return r.json();
}

// --- Index envelope ---------------------------------------------------

// Validates and unpacks a schema-2 envelope. Anything Insomnia cannot use
// reliably is rejected with an error rather than loaded in a degraded form:
// a source whose platforms cannot be resolved produces procedure IDs that
// silently fail to match, which reads as missing coverage rather than as a
// problem with the data.
function readIndexDocument(doc, sourceName) {
  if (Array.isArray(doc)) {
    throw new Error(
      'index.json is a bare array, from before the schema-2 envelope. It ' +
      'carries no platform map, so its platforms cannot be resolved. ' +
      'Reindex the repository with current tooling.'
    );
  }

  if (!doc || typeof doc !== 'object') {
    throw new Error('index.json is not a JSON object');
  }

  if (!Array.isArray(doc.records)) {
    throw new Error('index.json envelope has no "records" array');
  }

  const platforms = doc.platforms;
  if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) {
    throw new Error(
      'index.json "platforms" must be a map of display name to short code, ' +
      'e.g. {"Windows": "win"}. Check the repository\'s platform ' +
      'configuration and reindex.'
    );
  }
  for (const [name, short] of Object.entries(platforms)) {
    if (typeof short !== 'string' || !short.trim()) {
      throw new Error(
        `index.json platform "${name}" has no short code. Every platform ` +
        `needs one, e.g. {"${name}": "..."}.`
      );
    }
  }

  const schema = doc.schema || 1;
  let warning = null;
  if (schema > INDEX_SCHEMA_SUPPORTED) {
    warning = `Source "${sourceName}" reports index schema ${schema}, ` +
              `newer than the ${INDEX_SCHEMA_SUPPORTED} this build ` +
              `understands. Some fields may be ignored.`;
  }

  return {
    records: doc.records,
    platforms,
    generated: doc.generated || null,
    schema,
    warning,
  };
}

// --- Normalization ----------------------------------------------------

function normalizeTrr(raw, sourceName, platformShort) {
  const procedures = [];
  const key = `${raw.id}.${platformShort}`;

  if (raw.procedures && typeof raw.procedures === 'object') {
    for (const [letter, name] of Object.entries(raw.procedures)) {
      procedures.push({
        id: `${raw.id}.${platformShort}.${letter}`,
        trrId: raw.id,
        trrKey: key,          // resolves to one report, not to an ID
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
    key,
    id: raw.id,
    title: raw.title || '',
    tactics:      raw.tactics      || [],
    platforms:    raw.platforms    || [],
    platformShort,
    externalIds:  raw.external_ids || [],
    contributors: raw.contributors || [],
    pubDate:      raw.pub_date     || null,
    lastUpdate:   raw.last_update  || raw.pub_date || null,
    sourceName,
    procedureIds: procedures.map(p => p.id),
    procedures,
  };
}

function normalizeRecord(raw, sourceName) {
  // Provider-specific fields are nested so that every coverage record has the
  // same shape regardless of which system supplies the coverage.
  const details = raw.provider_details || {};

  return {
    id:         raw.id,
    title:      (raw.title || '').trim(),
    type:       classifyRecordType(raw.type),
    rawType:    raw.type,
    status:     raw.status || 'Active',
    provider:   raw.provider || null,
    providerDetails: details,
    platforms:  raw.platforms  || [],
    tactics:    raw.tactics    || [],
    techniques: raw.techniques || [],
    procedures: raw.procedures || [],
    contributors: raw.contributors || [],
    pubDate:    raw.pub_date    || null,
    lastUpdate: raw.last_update || raw.pub_date || null,
    sourceName,
  };
}

// --- Source location --------------------------------------------------

function parseGitHubRepo(repoUrl) {
  const m = String(repoUrl).match(
    /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/
  );
  if (!m) return null;
  return { host: m[1], owner: m[2], repo: m[3] };
}

// Directory a synced source's index lands in. Must match the derivation in
// tools/sync_sources.py and in the push workflow, or a pull and a push would
// write two copies and the browser would read neither reliably.
function sourceSlug(name) {
  return String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'source';
}

function resolveSourceLocation(src) {
  if (src.LocalPath) {
    const base = src.LocalPath.endsWith('/') ? src.LocalPath : src.LocalPath + '/';
    src._rawBase = base;
    src._linkBase = null;
    return src;
  }

  const parsed = parseGitHubRepo(src.Repo);
  if (!parsed) {
    throw new Error(`Cannot parse Repo URL: ${src.Repo}`);
  }

  const branch = src.Branch || 'main';

  const load = String(src.Load || DEFAULT_LOAD).toLowerCase();
  if (!Object.values(LOAD).includes(load)) {
    throw new Error(
      `Load "${src.Load}" is not recognized. Use "live" or "synced".`
    );
  }
  src.Load = load;

  if (load === LOAD.SYNCED) {
    // A browser cannot fetch a private repository and has nowhere safe to
    // keep a token, so private data arrives through the sync workflows.
    src._rawBase = `data/${sourceSlug(src.Name)}/`;
  } else {
    const rawHost = parsed.host === 'github.com'
      ? 'raw.githubusercontent.com'
      : `${parsed.host}/raw`;          // GitHub Enterprise
    src._rawBase = `https://${rawHost}/${parsed.owner}/${parsed.repo}/${branch}/`;
    src._rawHost = rawHost.split('/')[0];
  }

  // Repo always builds links out to individual records, which the viewer
  // opens with their own credentials.
  src._linkBase = `https://${parsed.host}/${parsed.owner}/${parsed.repo}/blob/${branch}`;
  return src;
}

// --- URL builders -----------------------------------------------------

function sourceByName(model, name) {
  return model.sources.find(s => s.Name === name) || null;
}

export function trrUrl(trr, model) {
  const src = sourceByName(model, trr.sourceName);
  if (!src || !src._linkBase) return null;
  const platformDir = String(trr.platformShort || '').toLowerCase();
  return `${src._linkBase}/reports/${String(trr.id).toLowerCase()}/${platformDir}/README.md`;
}

export function recordUrl(rec, model) {
  const src = sourceByName(model, rec.sourceName);
  if (!src || !src._linkBase) return null;
  return `${src._linkBase}/records/${String(rec.id).toLowerCase()}/README.md`;
}

// --- Loading ----------------------------------------------------------

export async function loadInsomniaData() {
  const model = {
    sources: [],
    trrs: new Map(),
    procedures: new Map(),
    records: new Map(),
    recordsByProc: new Map(),
    platforms: new Map(),
    trrPlatformNames: new Set(),
    recordPlatformNames: new Set(),
    orphanedRecords: [],
    detachedRecords: [],
    excludedRecords: [],
    loadErrors: [],
    warnings: [],
    excludedPlatforms: new Set(),
    sourceCounts: {},
    config: null,
  };

  // --- configuration ---------------------------------------------------
  let config;
  try {
    config = await fetchJson(CONFIG_PATH);
  } catch (e) {
    model.loadErrors.push(`Failed to load ${CONFIG_PATH}: ${e.message}`);
    return model;
  }

  model.config = config;

  for (const name of (config.excludePlatforms || [])) {
    model.excludedPlatforms.add(String(name).toLowerCase());
  }

  for (const src of (config.sources || [])) {
    const type = String(src.Type || '').toLowerCase();
    if (!Object.values(SOURCE_TYPE).includes(type)) {
      model.loadErrors.push(
        `Source "${src.Name}" has unknown Type "${src.Type}". ` +
        `Expected one of: ${Object.values(SOURCE_TYPE).join(', ')}.`
      );
      continue;
    }
    try {
      model.sources.push(resolveSourceLocation({ ...src, Type: type }));
      model.sourceCounts[type] = (model.sourceCounts[type] || 0) + 1;
    } catch (e) {
      model.loadErrors.push(`Source "${src.Name}": ${e.message}`);
    }
  }

  for (const src of model.sources) {
    if (src.Load === LOAD.LIVE && src._rawHost &&
        !CSP_ALLOWED_HOSTS.includes(src._rawHost)) {
      model.warnings.push(
        `Source "${src.Name}" is set to Load "live" on ${src._rawHost}, ` +
        `which this page's Content-Security-Policy does not allow, so the ` +
        `browser will refuse the fetch. Set it to "synced" so the sync ` +
        `workflows bring its data in instead.`
      );
    }
  }

  // --- fetch every source's index in parallel --------------------------
  // Platform maps are recorded per source so a disagreement between two
  // sources can be reported rather than silently resolved to whichever
  // happened to load last.
  const platformClaims = new Map();   // name -> Map<short, [sourceName]>

  await Promise.all(model.sources.map(async (src) => {
    try {
      const doc = await fetchJson(src._rawBase + 'index.json');
      const parsed = readIndexDocument(doc, src.Name);

      src.generated = parsed.generated;
      src.indexSchema = parsed.schema;
      if (parsed.warning) model.warnings.push(parsed.warning);

      for (const [name, short] of Object.entries(parsed.platforms)) {
        const upper = String(short).toUpperCase();
        if (!platformClaims.has(name)) platformClaims.set(name, new Map());
        const claims = platformClaims.get(name);
        if (!claims.has(upper)) claims.set(upper, []);
        claims.get(upper).push(src.Name);
      }

      src._records = parsed.records;
      src._platforms = parsed.platforms;   // this source's own map
    } catch (e) {
      src.error = e.message;
      model.loadErrors.push(
        `Failed to load ${src.Type} source "${src.Name}": ${e.message}`
      );
    }
  }));

  // --- reconcile platform maps -----------------------------------------
  // A name mapped to two different short codes makes procedure IDs from the
  // two sources unjoinable, which otherwise shows up only as missing coverage.
  for (const [name, claims] of platformClaims) {
    const codes = Array.from(claims.keys());
    if (codes.length > 1) {
      const detail = codes
        .map(c => `${c} (${claims.get(c).join(', ')})`)
        .join(' vs ');
      model.warnings.push(
        `Platform "${name}" is mapped to conflicting short codes: ${detail}. ` +
        `Procedure references between these sources will not match.`
      );
    }
    model.platforms.set(name, codes[0]);
  }

  // --- normalize -------------------------------------------------------
  const isExcluded = (name) =>
    model.excludedPlatforms.has(String(name).toLowerCase());

  for (const src of model.sources) {
    if (!src._records) continue;

    // A record's platforms are resolved against the map published in *its
    // own* source's index -- not the union across sources. Borrowing a short
    // code from another source would hide the fact that this index is
    // incomplete, and there is no longer any guessing: a platform that is not
    // defined is an error, and the record is skipped.
    const ownPlatforms = src._platforms || {};
    const skipped = [];                    // "ID (Platform, Platform)"

    const undefinedIn = (names) => names.filter(n => !(n in ownPlatforms));

    if (src.Type === SOURCE_TYPE.LIBRARY) {
      for (const raw of src._records) {
        if (!raw.id) continue;

        const names = raw.platforms || [];
        if (names.length === 0) {
          skipped.push(`${raw.id} (no platform)`);
          continue;
        }
        const missing = undefinedIn(names);
        if (missing.length) {
          skipped.push(`${raw.id} (${missing.join(', ')})`);
          continue;
        }

        const primary = names[0];
        if (isExcluded(primary)) continue;

        const short = String(ownPlatforms[primary]).toUpperCase();
        const trr = normalizeTrr(raw, src.Name, short);
        // Keyed by ID *and* platform: one report per platform folder.
        model.trrs.set(trr.key, trr);
        for (const proc of trr.procedures) {
          model.procedures.set(proc.id, proc);
        }
        for (const p of names) model.trrPlatformNames.add(p);
      }
    } else if (src.Type === SOURCE_TYPE.COVERAGE) {
      for (const raw of src._records) {
        if (!raw.id) continue;

        const names = raw.platforms || [];
        const missing = undefinedIn(names);
        if (missing.length) {
          skipped.push(`${raw.id} (${missing.join(', ')})`);
          continue;
        }

        const rec = normalizeRecord(raw, src.Name);
        if (names.length && names.every(isExcluded)) {
          model.excludedRecords.push(rec);
          continue;
        }

        model.records.set(rec.id, rec);
        for (const p of names) model.recordPlatformNames.add(p);
      }
    }
    // validation and emulation sources are configured but not yet consumed.

    // One error per source, listing every record it had to skip, rather than
    // a wall of identical messages.
    if (skipped.length) {
      const noun = skipped.length === 1 ? 'record' : 'records';
      model.loadErrors.push(
        `Source "${src.Name}": ${skipped.length} ${noun} skipped because ` +
        `they use platforms not defined in that source's index.json: ` +
        `${skipped.join('; ')}. Add the platforms to the repository's ` +
        `configuration and reindex.`
      );
    }

    delete src._records;
    delete src._platforms;
  }

  // --- join ------------------------------------------------------------
  // A record referencing only excluded procedures is 'excluded', not
  // 'orphaned': removing a platform should not invent orphans.
  for (const rec of model.records.values()) {
    if (!rec.procedures || rec.procedures.length === 0) {
      model.detachedRecords.push(rec);
      continue;
    }

    let anyValid = false;
    let anyExcluded = false;

    for (const procId of rec.procedures) {
      if (model.procedures.has(procId)) {
        anyValid = true;
        if (!model.recordsByProc.has(procId)) {
          model.recordsByProc.set(procId, []);
        }
        model.recordsByProc.get(procId).push(rec);
        continue;
      }
      const parts = String(procId).split('.');
      if (parts.length >= 2) {
        for (const [name, short] of model.platforms) {
          if (short === parts[1].toUpperCase() && isExcluded(name)) {
            anyExcluded = true;
          }
        }
      }
    }

    if (!anyValid) {
      if (anyExcluded) model.excludedRecords.push(rec);
      else model.orphanedRecords.push(rec);
    }
  }

  computeCoverageStates(model);

  model.hasCoverageSource = model.sources.some(
    s => s.Type === SOURCE_TYPE.COVERAGE && !s.error
  );

  return model;
}

// --- Coverage state ---------------------------------------------------

function computeCoverageStates(model) {
  for (const proc of model.procedures.values()) {
    const recs = model.recordsByProc.get(proc.id) || [];
    let covered = 0;
    let gaps = 0;

    for (const rec of recs) {
      if (rec.status && String(rec.status).toLowerCase() === 'retired') continue;
      if (isCoveredType(rec.type)) covered++;
      else if (rec.type === RECORD_TYPE.GAP) gaps++;
    }

    proc.coveredCount = covered;
    proc.gapCount = gaps;

    const total = covered + gaps;
    proc.fraction = total > 0 ? covered / total : 0;

    if (total === 0) proc.state = STATE.OPPORTUNITY;
    else if (gaps === 0) proc.state = STATE.COVERED;
    else if (covered === 0) proc.state = STATE.GAP;
    else proc.state = STATE.PARTIAL;
  }
}

export { STATE, RECORD_TYPE, SOURCE_TYPE, LOAD, isCoveredType };
