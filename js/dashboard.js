/* ============================================================
   dashboard.js — Renders the dashboard view (index.html).
   ============================================================ */

import { loadInsomniaData, STATE } from './data.js';
import {
  computeMetrics, coverageByTactic, coverageByPlatform,
  topGaps, topOpportunities, buildTrend, trendDelta, latestAdditions
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

function renderHeroMetrics(metrics, trend, deltas, hasPcr) {
  const grid = el('div', { class: 'metric-hero-grid' });

  // Score card — visible in both full and library-only modes, since TRRs
  // and PCRs both contribute to the awareness score.
  const scoreCard = el('div', { class: 'card metric-hero' },
    el('div', { class: 'label' }, 'Attack surface awareness'),
    el('div', { class: 'value mono' }, fmtScore(metrics.score)),
    el('div', { class: 'sub' }, `${fmtDelta(deltas.score)} in last 90 days`)
  );
  const scoreSpark = sparkline(trend.map(p => p.score), 'var(--brand)');
  if (scoreSpark) {
    const wrap = el('div', { class: 'sparkline' });
    wrap.append(scoreSpark);
    scoreCard.append(wrap);
  }

  // Surface card only when we have coverage data. Otherwise the score
  // card spans full width.
  if (!hasPcr) {
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

function renderStatStrip(metrics, hasPcr) {
  if (!hasPcr) {
    return el('div', { class: 'stat-strip two-col' },
      el('div', { class: 'stat' },
        el('div', { class: 'stat-label' }, 'TRRs'),
        el('div', { class: 'stat-value' }, fmtInt(metrics.trrCount))),
      el('div', { class: 'stat' },
        el('div', { class: 'stat-label' }, 'Procedures'),
        el('div', { class: 'stat-value' }, fmtInt(metrics.procCount))),
    );
  }
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
          item.trr ? item.trr.name : item.proc.name),
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
      el('div', { class: 'orphan-icon', html: '<i class="ti ti-check"></i>' }),
      el('div', { class: 'body' },
        el('div', { class: 'title' }, 'No orphaned or detached PCRs'),
        el('div', { class: 'detail' }, 'Every PCR references a known procedure. The data is clean.'))
    );
  }

  // Orphans take priority — those are data errors.
  if (oCount > 0) {
    const detail = orphans.map(o => `${o.id} → ${o.procedures.join(', ')}`).join('  ·  ');
    return el('div', { class: 'orphan-banner' },
      el('div', { class: 'orphan-icon', html: '<i class="ti ti-alert-triangle"></i>' }),
      el('div', { class: 'body' },
        el('div', { class: 'title' },
          `${oCount} orphaned ${oCount === 1 ? 'PCR' : 'PCRs'}` +
          (dCount ? ` · ${dCount} detached` : '')),
        el('div', { class: 'detail' }, detail)),
      el('a', { class: 'review-btn', href: 'records.html?type=detached' }, 'Review →')
    );
  }

  // Only detached PCRs — they're valid but worth surfacing.
  return el('div', { class: 'orphan-banner is-detached' },
    el('div', { class: 'orphan-icon', html: '<i class="ti ti-link-off"></i>' }),
    el('div', { class: 'body' },
      el('div', { class: 'title' },
        `${dCount} detached ${dCount === 1 ? 'PCR' : 'PCRs'}`),
      el('div', { class: 'detail' },
        'PCRs without procedure references. They count toward awareness but not coverage.')),
    el('a', { class: 'review-btn', href: 'records.html?type=detached' }, 'Review →')
  );
}

function renderLatestAdditions(items) {
  const card = el('div', { class: 'card' });
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
  const gaps = topGaps(model, 6);
  const opportunities = topOpportunities(model, 6);
  const latest = latestAdditions(model, 30, 10);

  container.innerHTML = '';

  // Show any per-source load errors
  if (model.loadErrors.length) {
    for (const msg of model.loadErrors) {
      container.append(el('div', { class: 'error-banner' },
        el('div', { class: 'err-title' }, 'Source failed to load'),
        el('div', { class: 'err-detail' }, msg)));
    }
  }

  container.append(renderHeroMetrics(metrics, trend, deltas, model.hasPcrSource));
  container.append(renderStatStrip(metrics, model.hasPcrSource));

  if (model.hasPcrSource) {
    container.append(el('div', { class: 'charts-grid' },
      renderBarChart('Coverage by tactic', tactics, true),
      renderBarChart('Coverage by platform', platforms, false),
    ));
    container.append(el('div', { class: 'charts-grid two-col' },
      renderTopList('Top gaps', gaps, 'gap',
        'No documented gaps. Either your coverage is complete or no gap records exist yet.'),
      renderTopList('Top opportunities', opportunities, 'opportunity',
        'No untouched procedures. Every procedure has at least one record.'),
    ));
  }

  // Latest Additions card — shown in both full and library-only modes.
  container.append(renderLatestAdditions(latest));

  // Orphan / detached PCR banner — only when we have PCR data
  if (model.hasPcrSource) {
    container.append(renderOrphanBanner(model.orphanedPcrs, model.detachedPcrs));
  }
}
