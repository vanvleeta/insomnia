/* ============================================================
   metrics.js — Score, attack surface %, derived counts,
   and historical trend reconstruction from pub_dates.
   ============================================================ */

import { STATE, isCoveredType, RECORD_TYPE } from './data.js';

// --- Live (current-state) metrics ------------------------------------

export function computeMetrics(model) {
  const trrCount = model.trrs.size;
  const procCount = model.procedures.size;

  let score = 0;
  let surfaceCovered = 0;  // sum of fractions (matches the proportional metric)
  let coveredCount = 0;
  let partialCount = 0;
  let gapCount = 0;
  let opportunityCount = 0;

  for (const proc of model.procedures.values()) {
    surfaceCovered += proc.fraction;
    switch (proc.state) {
      case STATE.COVERED:     coveredCount++; break;
      case STATE.PARTIAL:     partialCount++; break;
      case STATE.GAP:         gapCount++; break;
      case STATE.OPPORTUNITY: opportunityCount++; break;
    }
  }

  // Count active (non-retired) coverage records. Each contributes 1 to the awareness
  // score — even detached ones, since they still represent observed
  // environmental knowledge.
  let activeRecordCount = 0;
  for (const record of model.records.values()) {
    if (record.status !== 'Retired') activeRecordCount++;
  }

  // Score: 2 per TRR + 1 per active (non-retired) record.
  // The coverage percentage tells the procedure-fraction story; the
  // awareness score is just about volume of research and observations.
  score = (2 * trrCount) + activeRecordCount;

  const surfacePct = procCount > 0 ? (surfaceCovered / procCount) * 100 : 0;

  return {
    trrCount,
    procCount,
    recordCountActive: activeRecordCount,
    coveredCount,
    partialCount,
    gapCount,
    opportunityCount,
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
  // group -> { covered, partial, gap, opportunity, total, fractionSum }
  const groups = new Map();
  for (const proc of model.procedures.values()) {
    const trr = model.trrs.get(proc.trrKey);
    if (!trr) continue;
    const keys = groupFn(trr, proc);
    for (const key of keys) {
      if (!groups.has(key)) {
        groups.set(key, { name: key, covered:0, partial:0, gap:0, opportunity:0, total:0, fractionSum:0 });
      }
      const g = groups.get(key);
      g.total++;
      g.fractionSum += proc.fraction;
      switch (proc.state) {
        case STATE.COVERED:     g.covered++; break;
        case STATE.PARTIAL:     g.partial++; break;
        case STATE.GAP:         g.gap++; break;
        case STATE.OPPORTUNITY: g.opportunity++; break;
      }
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

export function coverageBySource(model) {
  return tallyByGroup(model, (trr) => [trr.sourceName]);
}

// --- Top gaps & opportunities ----------------------------------------

export function topGapsAndOpportunities(model, limit = 6) {
  // Gaps first (state === 'gap'), then partials (state === 'partial', lowest fraction first),
  // then opportunities (state === 'opportunity').
  const all = Array.from(model.procedures.values());
  const gaps = all.filter(p => p.state === STATE.GAP);
  const partials = all.filter(p => p.state === STATE.PARTIAL).sort((a,b) => a.fraction - b.fraction);
  const opportunities = all.filter(p => p.state === STATE.OPPORTUNITY);
  const out = [...gaps, ...partials, ...opportunities].slice(0, limit);
  return out.map(p => decorateProc(p, model));
}

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

// Just the opportunities (procedures with no coverage records of any kind yet).
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
      items.push({ kind: 'record', id: record.id, title: record.title || '(untitled)', date: d, record });
    }
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  return items.slice(0, limit);
}

// --- Historical trend from pub_dates ---------------------------------

// Build a time series of (date, score, surfacePct). At each date,
// we replay the world *as it was* on that date: only TRRs published
// on or before that date exist; only coverage records published on or before
// that date count toward coverage. coverage records missing pub_date are
// treated as "always existed" so they count from the earliest date.

export function buildTrend(model) {
  // Collect every relevant date in the data
  const datesSet = new Set();
  for (const trr of model.trrs.values()) {
    if (trr.pubDate) datesSet.add(trr.pubDate);
  }
  for (const record of model.records.values()) {
    if (record.pubDate) datesSet.add(record.pubDate);
  }
  const dates = Array.from(datesSet).sort();
  if (dates.length === 0) return [];

  // Pre-index coverage records by procedure (regardless of date for now)
  // We'll filter inside the loop. Pre-classify type so we don't repeat work.
  const recordsForProc = new Map();
  for (const record of model.records.values()) {
    if (record.status === 'Retired') continue;
    for (const procId of record.procedures) {
      if (!model.procedures.has(procId)) continue;
      if (!recordsForProc.has(procId)) recordsForProc.set(procId, []);
      recordsForProc.get(procId).push(record);
    }
  }

  const series = [];
  for (const date of dates) {
    let trrCount = 0;
    let procCount = 0;
    let surfaceSum = 0;
    const procsInScope = [];

    // Procedures only exist if their TRR was published by `date`
    for (const trr of model.trrs.values()) {
      if (trr.pubDate && trr.pubDate > date) continue;
      trrCount++;
      for (const p of trr.procedures) procsInScope.push(p);
    }
    procCount = procsInScope.length;

    for (const p of procsInScope) {
      const records = (recordsForProc.get(p.id) || []).filter(record => {
        // No pub_date: treat as always-existing
        if (!record.pubDate) return true;
        return record.pubDate <= date;
      });
      let cov = 0, gap = 0;
      for (const record of records) {
        if (record.type === RECORD_TYPE.GAP) gap++;
        else if (isCoveredType(record.type)) cov++;
      }
      if (cov + gap > 0) surfaceSum += cov / (cov + gap);
    }

    // Count active coverage records in scope as of `date`. Includes detached coverage records.
    let recordCountInScope = 0;
    for (const record of model.records.values()) {
      if (record.status === 'Retired') continue;
      if (record.pubDate && record.pubDate > date) continue;
      recordCountInScope++;
    }

    const score = (2 * trrCount) + recordCountInScope;
    const surfacePct = procCount > 0 ? (surfaceSum / procCount) * 100 : 0;
    series.push({ date, score, surfacePct, trrCount, procCount, recordCountInScope });
  }
  return series;
}

// Convenience: get "change in last N days" from the trend.
export function trendDelta(series, days = 90) {
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
