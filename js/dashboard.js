/* ============================================================
   dashboard.js — Renders the dashboard view (index.html).
   ============================================================ */

import {
  computeMetrics, coverageByTactic, coverageByPlatform,
  topGaps, topOpportunities, buildTrend, trendDelta, latestAdditions, DELTA_WINDOW_DAYS } from './metrics.js';
import { el, loadViewModel, renderStateLegend } from './utils.js';

// --- Utilities -------------------------------------------------------

const fmtScore = (n) => Math.round(n).toString();
const fmtPct   = (n) => n.toFixed(1);
const fmtInt   = (n) => Math.round(n).toString();
const fmtDelta = (n, digits = 1) => (n >= 0 ? '+' : '') + n.toFixed(digits);

// --- Sparkline -------------------------------------------------------

function sparkline(values, color) {
  if (!values.length) return null;
  const w = 200, h = 64, pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = (max - min) || 1;
  const n = values.length;
  const points = values.map((v, i) => {
    const x = n === 1 ? w / 2 : pad + (i / (n - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return [x, y];
  });
  const poly = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1];

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('aria-hidden', 'true');

  // Filled area under the line (subtle)
  const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  area.setAttribute('points', `${pad},${h-pad} ${poly} ${w-pad},${h-pad}`);
  area.setAttribute('fill', color);
  area.setAttribute('fill-opacity', '0.12');
  svg.append(area);

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', poly);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('stroke-linejoin', 'round');
  svg.append(line);

  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', last[0]);
  dot.setAttribute('cy', last[1]);
  dot.setAttribute('r', '2.5');
  dot.setAttribute('fill', color);
  svg.append(dot);

  return svg;
}

// --- Render functions ------------------------------------------------

function renderHeroMetrics(metrics, trend, deltas, hasCoverage) {
  const grid = el('div', { class: 'metric-hero-grid' });

  // Score card — visible in both full and library-only modes, since TRRs
  // and coverage records both contribute to the awareness score.
  const scoreCard = el('div', { class: 'card metric-hero' },
    el('div', { class: 'label' }, 'Attack surface awareness'),
    el('div', { class: 'value mono' }, fmtScore(metrics.score)),
    el('div', { class: 'sub' }, `${fmtDelta(deltas.score, 0)} in last ${DELTA_WINDOW_DAYS} days`)
  );
  const scoreSpark = sparkline(trend.map(p => p.score), 'var(--covered)');
  if (scoreSpark) {
    const wrap = el('div', { class: 'sparkline' });
    wrap.append(scoreSpark);
    scoreCard.append(wrap);
  }

  // Surface card only when we have coverage data. Otherwise the score
  // card spans full width.
  if (!hasCoverage) {
    scoreCard.classList.add('full-width');
    grid.append(scoreCard);
    return grid;
  }

  const surfaceCard = el('div', { class: 'card metric-hero surface' },
    el('div', { class: 'label' }, 'Known attack surface covered'),
    el('div', { class: 'value mono' },
      fmtPct(metrics.surfacePct), el('span', { class: 'pct' }, '%')),
    el('div', { class: 'sub' },
      `${fmtPct(metrics.surfaceCovered)} of ${metrics.procCount} procedures  ·  ` +
      `${fmtDelta(deltas.surfacePct)} pts in ${DELTA_WINDOW_DAYS} days`)
  );
  const surfaceSpark = sparkline(trend.map(p => p.surfacePct), 'var(--brand)');
  if (surfaceSpark) {
    const wrap = el('div', { class: 'sparkline' });
    wrap.append(surfaceSpark);
    surfaceCard.append(wrap);
  }

  grid.append(scoreCard, surfaceCard);
  return grid;
}

function renderStatStrip(metrics, model) {
  const stat = (cls, label, value) => el('div', { class: `stat ${cls}` },
    el('div', { class: 'stat-label' }, label),
    el('div', { class: 'stat-value' }, fmtInt(value)));

  const stats = [stat('', 'TRRs', metrics.trrCount), stat('', 'Procedures', metrics.procCount)];
  if (model.hasCoverageRecords) {
    stats.push(
      stat('is-covered', 'Covered', metrics.coveredCount + metrics.partialCount),
      stat('is-gap', 'Gaps', metrics.gapCount + metrics.partialCount));
  }
  if (model.hasOpportunities) {
    stats.push(stat('is-opportunity', 'Opportunities', metrics.opportunityCount));
  }
  if (model.hasStateData) {
    stats.push(stat('is-unassessed', 'Unassessed', metrics.unassessedCount));
  }
  // One column per stat, so the strip never wraps a stray card onto a new row.
  const cols = { 2: 'two-col', 3: 'three-col', 4: 'four-col', 5: 'five-col', 6: 'six-col' }[stats.length] || '';
  return el('div', { class: `stat-strip ${cols}` }, ...stats);
}


function renderBarChart(title, rows, model, showLegend = true) {
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'chart-header' },
    el('div', { class: 'chart-title' }, title),
    showLegend ? renderStateLegend(model) : null
  ));

  for (const row of rows) {
    // Each bar shows every state stacked, proportional to procedure count
    const t = row.total || 1;
    const segs = [
      { cls: 'covered',     pct: (row.covered     / t) * 100 },
      { cls: 'partial',     pct: (row.partial     / t) * 100 },
      { cls: 'gap',         pct: (row.gap         / t) * 100 },
      { cls: 'opportunity', pct: (row.opportunity / t) * 100 },
      { cls: 'unassessed',  pct: (row.unassessed  / t) * 100 },
    ];
    const track = el('div', { class: 'bar-track' });
    for (const s of segs) {
      if (s.pct > 0) {
        const seg = el('div', { class: `bar-seg ${s.cls}` });
        seg.style.width = s.pct + '%';
        track.append(seg);
      }
    }

    // With coverage records, the figure is the share of the group covered.
    // With only published opportunities there is no coverage to measure, so
    // it is the share of procedures that have an opportunity -- a figure the
    // public library can honestly state. Showing the coverage share there
    // would print 0% on every row.
    const shown = model.hasCoverageRecords ? row.pct : (row.opportunity / t) * 100;
    const pctEl = el('span', { class: 'pct' }, fmtInt(shown) + '%');

    card.append(el('div', { class: 'bar-row' },
      el('span', { class: 'name', title: row.name }, row.name),
      track,
      pctEl
    ));
  }
  return card;
}

function renderTopList(title, items, tagCls, emptyMsg) {
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'chart-header' },
    el('div', { class: 'chart-title' }, title)
  ));
  const list = el('div', { class: 'gaps-list' });
  if (items.length === 0) {
    list.append(el('div', { class: 'empty-list-msg' }, emptyMsg));
  } else {
    for (const item of items) {
      const tagText = item.status === 'partial' ? 'partial' : item.status;
      list.append(el('div', { class: 'gap-item' },
        el('span', { class: 'desc' },
          el('span', { class: 'id mono' }, item.proc.id),
          item.proc.name),
        el('span', { class: `status-tag ${tagCls}` }, tagText)
      ));
    }
  }
  card.append(list);
  return card;
}

function renderOrphanBanner(orphans, detached) {
  const oCount = orphans.length;
  const dCount = detached.length;

  // Clean state: no orphans and no detached
  if (oCount === 0 && dCount === 0) {
    return el('div', { class: 'orphan-banner is-clean' },
      el('div', { class: 'orphan-icon' }, el('i', { class: 'ti ti-check', 'aria-hidden': 'true' })),
      el('div', { class: 'orphan-body' },
        el('div', { class: 'orphan-title' }, 'No orphaned or detached records'),
        el('div', { class: 'orphan-detail' }, 'Every record references a known procedure. The data is clean.'))
    );
  }

  // Orphans take priority — those are data errors.
  if (oCount > 0) {
    const detail = orphans.map(o => `${o.id} → ${o.procedures.join(', ')}`).join('  ·  ');
    return el('div', { class: 'orphan-banner' },
      el('div', { class: 'orphan-icon' }, el('i', { class: 'ti ti-alert-triangle', 'aria-hidden': 'true' })),
      el('div', { class: 'orphan-body' },
        el('div', { class: 'orphan-title' },
          `${oCount} orphaned ${oCount === 1 ? 'record' : 'records'}` +
          (dCount ? ` · ${dCount} detached` : '')),
        el('div', { class: 'orphan-detail' }, detail)),
      el('a', { class: 'orphan-review-btn', href: 'records.html?type=orphaned' }, 'Review →')
    );
  }

  // Only detached coverage records — they're valid but worth surfacing.
  return el('div', { class: 'orphan-banner is-detached' },
    el('div', { class: 'orphan-icon' }, el('i', { class: 'ti ti-link-off', 'aria-hidden': 'true' })),
    el('div', { class: 'orphan-body' },
      el('div', { class: 'orphan-title' },
        `${dCount} detached ${dCount === 1 ? 'record' : 'records'}`),
      el('div', { class: 'orphan-detail' },
        'Records without procedure references. They count toward awareness but not coverage.')),
    el('a', { class: 'orphan-review-btn', href: 'records.html?type=detached' }, 'Review →')
  );
}

function renderLatestAdditions(items) {
  const card = el('div', { class: 'card latest-additions' });
  card.append(el('div', { class: 'chart-header' },
    el('div', { class: 'chart-title' }, 'Latest additions')
  ));
  const list = el('div', { class: 'latest-list' });
  if (items.length === 0) {
    list.append(el('div', { class: 'empty-list-msg' }, 'Nothing added in the last 30 days.'));
  } else {
    for (const it of items) {
      const href = it.kind === 'TRR' ? `techniques.html?q=${encodeURIComponent(it.id)}`
                                     : `records.html?q=${encodeURIComponent(it.id)}`;
      list.append(el('a', { class: 'latest-item', href },
        el('span', { class: `latest-kind kind-${it.kind.toLowerCase()}` }, it.kind),
        el('span', { class: 'id mono' }, it.id),
        el('span', { class: 'desc' }, it.title),
        el('span', { class: 'mono latest-date' }, it.date),
      ));
    }
  }
  card.append(list);
  return card;
}

// --- Entry point -----------------------------------------------------

export async function renderDashboard(container) {
  const model = await loadViewModel(container, 'Loading sources');
  if (!model) return;

  const metrics = computeMetrics(model);
  const trend = buildTrend(model);
  const deltas = trendDelta(trend);
  const tactics = coverageByTactic(model);
  const platforms = coverageByPlatform(model);
  const gaps = topGaps(model, 6);
  const opportunities = topOpportunities(model, 6);
  const latest = latestAdditions(model, 30, 10);


  // The coverage figures need the organization's own coverage or gap records;
  // a library of opportunities alone has none to measure.
  container.append(renderHeroMetrics(metrics, trend, deltas, model.hasCoverageRecords));
  container.append(renderStatStrip(metrics, model));

  if (model.hasStateData) {
    const byTactic = model.hasCoverageRecords ? 'Coverage by tactic' : 'Opportunities by tactic';
    const byPlatform = model.hasCoverageRecords ? 'Coverage by platform' : 'Opportunities by platform';
    container.append(el('div', { class: 'charts-grid' },
      renderBarChart(byTactic, tactics, model, true),
      renderBarChart(byPlatform, platforms, model, false),
    ));
    const lists = [];
    if (model.hasCoverageRecords) {
      lists.push(renderTopList('Top gaps', gaps, 'gap',
        'No documented gaps. Either your coverage is complete or no gap records exist yet.'));
    }
    if (model.hasOpportunities) {
      lists.push(renderTopList('Top opportunities', opportunities, 'opportunity',
        'No open opportunities. Every procedure with a published opportunity has a record of its own.'));
    }
    if (lists.length) {
      container.append(el('div', { class: `charts-grid ${lists.length === 2 ? 'two-col' : ''}` }, ...lists));
    }
  }

  // Latest Additions card — shown in both full and library-only modes.
  container.append(renderLatestAdditions(latest));

  // Orphan / detached record banner — whenever any records are loaded
  if (model.hasStateData) {
    container.append(renderOrphanBanner(model.orphanedRecords, model.detachedRecords));
  }
}
