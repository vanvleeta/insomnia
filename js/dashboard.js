/* ============================================================
   dashboard.js — Renders the dashboard view (index.html).
   ============================================================ */

import { loadInsomniaData, STATE } from './data.js';
import {
  computeMetrics, coverageByTactic, coverageByPlatform,
  topGapsAndOpportunities, buildTrend, trendDelta
} from './metrics.js';

// --- Utilities -------------------------------------------------------

const fmtScore = (n) => n.toFixed(1);
const fmtPct   = (n) => n.toFixed(1);
const fmtInt   = (n) => Math.round(n).toString();
const fmtDelta = (n, digits = 1) => (n >= 0 ? '+' : '') + n.toFixed(digits);

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

// --- Sparkline -------------------------------------------------------

function sparkline(values, color) {
  if (!values.length) return null;
  const w = 130, h = 46, pad = 3;
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

function renderHeroMetrics(metrics, trend, deltas) {
  const grid = el('div', { class: 'metric-hero-grid' });

  // Score card
  const scoreCard = el('div', { class: 'card metric-hero' },
    el('div', { class: 'label' }, 'Coverage score'),
    el('div', { class: 'value mono' }, fmtScore(metrics.score)),
    el('div', { class: 'sub' },
      `${fmtDelta(deltas.score)} in last 90 days  ·  ` +
      `${fmtInt(metrics.trrCount)} TRRs  ·  ${fmtPct(metrics.surfaceCovered)} procedure-equivalents`)
  );
  const scoreSpark = sparkline(trend.map(p => p.score), 'var(--brand)');
  if (scoreSpark) {
    const wrap = el('div', { class: 'sparkline' });
    wrap.append(scoreSpark);
    scoreCard.append(wrap);
  }

  // Surface card
  const surfaceCard = el('div', { class: 'card metric-hero surface' },
    el('div', { class: 'label' }, 'Attack surface covered'),
    el('div', { class: 'value mono' },
      fmtPct(metrics.surfacePct), el('span', { class: 'pct' }, '%')),
    el('div', { class: 'sub' },
      `${fmtPct(metrics.surfaceCovered)} of ${metrics.procCount} procedures  ·  ` +
      `${fmtDelta(deltas.surfacePct)} pts in 90 days`)
  );
  const surfaceSpark = sparkline(trend.map(p => p.surfacePct), 'var(--covered)');
  if (surfaceSpark) {
    const wrap = el('div', { class: 'sparkline' });
    wrap.append(surfaceSpark);
    surfaceCard.append(wrap);
  }

  grid.append(scoreCard, surfaceCard);
  return grid;
}

function renderStatStrip(metrics) {
  return el('div', { class: 'stat-strip' },
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label' }, 'TRRs'),
      el('div', { class: 'stat-value' }, fmtInt(metrics.trrCount))),
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label' }, 'Procedures'),
      el('div', { class: 'stat-value' }, fmtInt(metrics.procCount))),
    el('div', { class: 'stat is-covered' },
      el('div', { class: 'stat-label' }, 'Covered'),
      el('div', { class: 'stat-value' }, fmtInt(metrics.coveredCount + metrics.partialCount))),
    el('div', { class: 'stat is-gap' },
      el('div', { class: 'stat-label' }, 'Gaps'),
      el('div', { class: 'stat-value' }, fmtInt(metrics.gapCount + metrics.partialCount))),
    el('div', { class: 'stat is-opportunity' },
      el('div', { class: 'stat-label' }, 'Opportunities'),
      el('div', { class: 'stat-value' }, fmtInt(metrics.opportunityCount))),
  );
}

function renderLegend() {
  return el('div', { class: 'legend' },
    el('span', { class: 'legend-item' }, el('span', { class: 'legend-sw covered' }), 'covered'),
    el('span', { class: 'legend-item' }, el('span', { class: 'legend-sw partial' }), 'partial'),
    el('span', { class: 'legend-item' }, el('span', { class: 'legend-sw gap' }), 'gap'),
    el('span', { class: 'legend-item' }, el('span', { class: 'legend-sw opportunity' }), 'opportunity'),
  );
}

function renderBarChart(title, rows, showLegend = true) {
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'chart-header' },
    el('div', { class: 'chart-title' }, title),
    showLegend ? renderLegend() : null
  ));

  for (const row of rows) {
    // Each bar shows the four states stacked, proportional to procedure count
    const t = row.total || 1;
    const segs = [
      { cls: 'covered',     pct: (row.covered     / t) * 100 },
      { cls: 'partial',     pct: (row.partial     / t) * 100 },
      { cls: 'gap',         pct: (row.gap         / t) * 100 },
      { cls: 'opportunity', pct: (row.opportunity / t) * 100 },
    ];
    const track = el('div', { class: 'bar-track' });
    for (const s of segs) {
      if (s.pct > 0) {
        const seg = el('div', { class: `bar-seg ${s.cls}` });
        seg.style.width = s.pct + '%';
        track.append(seg);
      }
    }

    const pctClass = row.pct >= 60 ? '' : (row.pct >= 30 ? 'mid' : (row.pct > 0 ? 'low' : 'zero'));
    const pctColor = row.pct >= 60 ? 'var(--covered)' :
                     row.pct >= 30 ? 'var(--partial)' :
                     row.pct >  0  ? 'var(--gap)'     : 'var(--text-dim)';

    const pctEl = el('span', { class: 'pct' }, fmtInt(row.pct) + '%');
    pctEl.style.color = pctColor;

    card.append(el('div', { class: 'bar-row' },
      el('span', { class: 'name', title: row.name }, row.name),
      track,
      pctEl
    ));
  }
  return card;
}

function renderTopGaps(items) {
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'chart-header' },
    el('div', { class: 'chart-title' }, 'Top gaps & opportunities')
  ));
  const list = el('div', { class: 'gaps-list' });
  for (const item of items) {
    const tagCls = item.status === 'gap' ? 'gap' :
                   item.status === 'partial' ? 'gap' : 'opportunity';
    const tagText = item.status === 'partial' ? 'partial' : item.status;
    list.append(el('div', { class: 'gap-item' },
      el('span', { class: 'desc' },
        el('span', { class: 'id mono' }, item.proc.id),
        item.trr ? item.trr.name : item.proc.name),
      el('span', { class: `status-tag ${tagCls}` }, tagText)
    ));
  }
  card.append(list);
  return card;
}

function renderOrphanBanner(orphans) {
  if (!orphans.length) {
    return el('div', { class: 'orphan-banner is-clean' },
      el('div', { class: 'orphan-icon', html: '<i class="ti ti-check"></i>' }),
      el('div', { class: 'body' },
        el('div', { class: 'title' }, 'No orphaned PCRs'),
        el('div', { class: 'detail' }, 'Every PCR references a known procedure. The data is clean.'))
    );
  }
  const detail = orphans.map(o =>
    `${o.id} → ${o.procedures.join(', ')}`
  ).join('  ·  ');
  return el('div', { class: 'orphan-banner' },
    el('div', { class: 'orphan-icon', html: '<i class="ti ti-alert-triangle"></i>' }),
    el('div', { class: 'body' },
      el('div', { class: 'title' },
        `${orphans.length} orphaned ${orphans.length === 1 ? 'PCR' : 'PCRs'}`),
      el('div', { class: 'detail' }, detail)),
    el('a', { class: 'review-btn', href: 'procedures.html?view=orphans' }, 'Review →')
  );
}

// --- Entry point -----------------------------------------------------

export async function renderDashboard(container) {
  container.innerHTML = '';
  container.append(el('div', { class: 'loader' }, 'Loading sources'));

  let model;
  try {
    model = await loadInsomniaData();
  } catch (e) {
    container.innerHTML = '';
    container.append(el('div', { class: 'error-banner' },
      el('div', { class: 'err-title' }, 'Could not load Insomnia data'),
      el('div', { class: 'err-detail' }, e.message)));
    return;
  }

  const metrics = computeMetrics(model);
  const trend = buildTrend(model);
  const deltas = trendDelta(trend, 90);
  const tactics = coverageByTactic(model);
  const platforms = coverageByPlatform(model);
  const tops = topGapsAndOpportunities(model, 6);

  container.innerHTML = '';

  // Show any per-source load errors
  if (model.loadErrors.length) {
    for (const msg of model.loadErrors) {
      container.append(el('div', { class: 'error-banner' },
        el('div', { class: 'err-title' }, 'Source failed to load'),
        el('div', { class: 'err-detail' }, msg)));
    }
  }

  container.append(renderHeroMetrics(metrics, trend, deltas));
  container.append(renderStatStrip(metrics));
  container.append(el('div', { class: 'charts-grid' },
    renderBarChart('Coverage by tactic', tactics, true),
    renderBarChart('Coverage by platform', platforms, false),
  ));
  container.append(el('div', { class: 'charts-grid' },
    renderTopGaps(tops),
    renderBarChart('Coverage by source', [
      ...new Map(
        Array.from(model.trrs.values()).map(t => [t.sourceName, null])
      ).keys()
    ].map(name => {
      const procs = Array.from(model.procedures.values())
        .filter(p => model.trrs.get(p.trrId)?.sourceName === name);
      let total = procs.length, sum = 0;
      const counts = { covered:0, partial:0, gap:0, opportunity:0 };
      for (const p of procs) {
        sum += p.fraction;
        counts[p.state]++;
      }
      return { name, ...counts, total, fractionSum: sum,
               pct: total ? (sum / total) * 100 : 0 };
    }), false),
  ));
  container.append(renderOrphanBanner(model.orphanedPcrs));
}
