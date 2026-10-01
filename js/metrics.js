/* ============================================================
   metrics.js — Score, attack surface %, derived counts,
   and historical trend reconstruction from pub_dates.
   ============================================================ */

import { STATE, RECORD_TYPE } from './data.js';

// --- Live (current-state) metrics ------------------------------------

// The records that count toward the awareness score: active coverage and gap
// records -- an organization's own assessments of its environment.
// Opportunities do not count. The TRR already carries the awareness of the
// procedure; an opportunity only marks where more coverage could come from.
function countsTowardAwareness(record) {
  if (record.status === 'Retired') return false;
  return record.type === RECORD_TYPE.COVERAGE || record.type === RECORD_TYPE.GAP;
}

export function computeMetrics(model) {
  const trrCount = model.trrs.size;
  const procCount = model.procedures.size;

  let score = 0;
  let surfaceCovered = 0;  // sum of fractions (matches the proportional metric)
  // One counter per state, indexed by the state itself.
  const counts = Object.fromEntries(Object.values(STATE).map(st => [st, 0]));
  for (const proc of model.procedures.values()) {
    surfaceCovered += proc.fraction;
    counts[proc.state]++;
  }

  // Count active coverage and gap records. Each contributes 1 to the
  // awareness score — even detached ones, since they still represent observed
  // environmental knowledge.
  let activeRecordCount = 0;
  for (const record of model.records.values()) {
    if (countsTowardAwareness(record)) activeRecordCount++;
  }

  // Score: 2 per TRR + 1 per active coverage or gap record.
  // The coverage percentage tells the procedure-fraction story; the
  // awareness score is just about volume of research and observations.
  score = (2 * trrCount) + activeRecordCount;

  const surfacePct = procCount > 0 ? (surfaceCovered / procCount) * 100 : 0;

  return {
    trrCount,
    procCount,
    recordCountActive: activeRecordCount,
    coveredCount:     counts[STATE.COVERED],
    partialCount:     counts[STATE.PARTIAL],
    gapCount:         counts[STATE.GAP],
    opportunityCount: counts[STATE.OPPORTUNITY],
    unassessedCount:  counts[STATE.UNASSESSED],
    score,                 // open-ended, no denominator
    surfacePct,            // 0..100
    surfaceCovered,        // numerator value (e.g. 24.5)
    recordCount: model.records.size,
    orphanCount: model.orphanedRecords.length,
  };
}

// --- Coverage breakdowns ---------------------------------------------

// Generic group-by that returns rows for the stacked bar chart.
function tallyByGroup(model, groupFn) {
  // group -> { covered, partial, gap, opportunity, unassessed, total, fractionSum }
  const groups = new Map();
  for (const proc of model.procedures.values()) {
    const trr = model.trrs.get(proc.trrKey);
    if (!trr) continue;
    const keys = groupFn(trr, proc);
    for (const key of keys) {
      if (!groups.has(key)) {
        groups.set(key, { name: key, covered:0, partial:0, gap:0, opportunity:0, unassessed:0, total:0, fractionSum:0 });
      }
      const g = groups.get(key);
      g.total++;
      g.fractionSum += proc.fraction;
      // Group fields are named after the states, so the state indexes them.
      g[proc.state]++;
    }
  }
  // Convert to array + percentage of covered fraction
  return Array.from(groups.values()).map(g => ({
    ...g,
    pct: g.total > 0 ? (g.fractionSum / g.total) * 100 : 0,
  })).sort((a, b) => b.pct - a.pct || b.total - a.total);
}

export function coverageByTactic(model) {
  return tallyByGroup(model, (trr) => trr.tactics.length ? trr.tactics : ['(none)']);
}

export function coverageByPlatform(model) {
  return tallyByGroup(model, (trr) => trr.platforms.length ? trr.platforms : ['(none)']);
}

// --- Top gaps & opportunities ----------------------------------------

// Just the gaps (state === 'gap') and partials (sorted lowest fraction first).
// Partials show up as gaps in this view because they have at least one documented
// gap record someone still needs to address.
export function topGaps(model, limit = 6) {
  const all = Array.from(model.procedures.values());
  const gaps = all.filter(p => p.state === STATE.GAP);
  const partials = all.filter(p => p.state === STATE.PARTIAL)
    .sort((a, b) => a.fraction - b.fraction);
  return [...gaps, ...partials].slice(0, limit).map(p => decorateProc(p, model));
}

// Procedures in the opportunity state: no coverage or gap records of the
// organization's own, but a published way to detect them exists.
export function topOpportunities(model, limit = 6) {
  const all = Array.from(model.procedures.values());
  const opps = all.filter(p => p.state === STATE.OPPORTUNITY);
  // Sort by TRR id for stable ordering; could weight by tactic relevance later.
  opps.sort((a, b) => a.id.localeCompare(b.id));
  return opps.slice(0, limit).map(p => decorateProc(p, model));
}

function decorateProc(p, model) {
  const trr = model.trrs.get(p.trrKey);
  return {
    proc: p,
    trr,
    label: trr ? `${trr.title} · ${p.name}` : p.name,
    status: p.state,
  };
}

// --- Latest additions -------------------------------------------------

// Return TRRs and coverage records added within the last `days` days, interleaved by
// publication date (newest first). coverage records without pub_date are skipped.
export function latestAdditions(model, days = 30, limit = 20) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const items = [];
  for (const trr of model.trrs.values()) {
    const d = trr.pubDate;
    if (d && d >= cutoffStr) {
      items.push({ kind: 'TRR', id: trr.id, title: trr.title, date: d, trr });
    }
  }
  for (const record of model.records.values()) {
    const d = record.pubDate;
    if (d && d >= cutoffStr) {
      // A published opportunity is labelled as one, so it cannot be mistaken
      // for a coverage or gap record the organization wrote.
      const kind = record.type === RECORD_TYPE.OPPORTUNITY ? 'opportunity' : 'record';
      items.push({ kind, id: record.id, title: record.title || '(untitled)', date: d, record });
    }
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  return items.slice(0, limit);
}

// --- Historical trend from pub_dates ---------------------------------

// How far back the "+N in last N days" figures on the dashboard look.
export const DELTA_WINDOW_DAYS = 90;

// Enough points for a sparkline's shape. The trend is a sense of direction,
// not an audit trail, so it is sampled rather than plotted at every date.
const TREND_POINTS = 60;

const DAY_MS = 86400000;
const toDay = (iso) => Date.parse(iso + 'T00:00:00Z') / DAY_MS;
const fromDay = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

// Build a time series of { date, score, surfacePct }, replaying history as it
// was on each sampled date: only TRRs published by then exist, and only the
// coverage and gap records published by then count. Anything with no
// pub_date is treated as having always existed.
//
// Rather than recompute everything at every date, this sorts the
// publications once and sweeps through them, keeping running totals. A record
// changes the coverage of only the procedures it names, so each one is
// applied in a single step. The cost is one sort plus one pass, however many
// points are sampled.
export function buildTrend(model) {
  const events = [];
  for (const trr of model.trrs.values()) {
    events.push({ date: trr.pubDate || '', trr });
  }
  for (const record of model.records.values()) {
    if (countsTowardAwareness(record)) events.push({ date: record.pubDate || '', record });
  }
  const dated = events.filter(e => e.date).map(e => e.date);
  if (dated.length === 0) return [];
  // ISO dates sort correctly as plain strings -- faster than localeCompare,
  // and independent of the viewer's locale.
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Sample dates: evenly spaced from the first publication to the last, plus
  // the exact start of the delta window, so that figure stays precise however
  // coarse the sampling is.
  const first = toDay(dated.reduce((a, b) => (a < b ? a : b)));
  const last = toDay(dated.reduce((a, b) => (a > b ? a : b)));
  const samples = new Set();
  const steps = Math.max(1, Math.min(TREND_POINTS - 1, last - first));
  for (let i = 0; i <= steps; i++) samples.add(fromDay(Math.round(first + (last - first) * i / steps)));
  const windowStart = last - DELTA_WINDOW_DAYS;
  if (windowStart > first) samples.add(fromDay(windowStart));
  const sampleDates = Array.from(samples).sort();

  // Running state.
  const perProc = new Map();       // procedure id -> { cov, gap }
  const inScope = new Set();       // procedures whose TRR is published
  let trrCount = 0, procCount = 0, recordCount = 0, surfaceSum = 0;
  const fraction = (id) => {
    const c = perProc.get(id);
    return c && c.cov + c.gap > 0 ? c.cov / (c.cov + c.gap) : 0;
  };

  const apply = (event) => {
    if (event.trr) {
      trrCount++;
      for (const proc of event.trr.procedures) {
        inScope.add(proc.id);
        procCount++;
        surfaceSum += fraction(proc.id);   // records may predate their TRR
      }
      return;
    }
    recordCount++;
    for (const id of event.record.procedures) {
      if (!model.procedures.has(id)) continue;
      const before = fraction(id);
      if (!perProc.has(id)) perProc.set(id, { cov: 0, gap: 0 });
      const counts = perProc.get(id);
      if (event.record.type === RECORD_TYPE.GAP) counts.gap++;
      else counts.cov++;
      if (inScope.has(id)) surfaceSum += fraction(id) - before;
    }
  };

  const series = [];
  let next = 0;
  for (const date of sampleDates) {
    while (next < events.length && events[next].date <= date) apply(events[next++]);
    series.push({
      date,
      score: (2 * trrCount) + recordCount,
      surfacePct: procCount > 0 ? (surfaceSum / procCount) * 100 : 0,
    });
  }
  return series;
}

// Convenience: get "change in last N days" from the trend.
export function trendDelta(series, days = DELTA_WINDOW_DAYS) {
  if (!series.length) return { score: 0, surfacePct: 0 };
  const latest = series[series.length - 1];
  const cutoff = new Date(latest.date);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Find latest entry before cutoff
  let baseline = null;
  for (const pt of series) {
    if (pt.date <= cutoffStr) baseline = pt;
    else break;
  }
  if (!baseline) baseline = series[0];

  return {
    score: latest.score - baseline.score,
    surfacePct: latest.surfacePct - baseline.surfacePct,
  };
}
