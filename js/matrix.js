/* ============================================================
   matrix.js — Renders the threat coverage matrix view.

   Layout: ATT&CK-Navigator-style — tactics as columns, TRRs as
   cells under each tactic column they belong to, colored by
   coverage state. Click a cell to expand its procedures.
   ============================================================ */

import { loadInsomniaData, STATE } from './data.js';

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

// Overall coverage state for a TRR by aggregating its procedure states.
function trrOverallState(trr, hasPcr) {
  if (!hasPcr) return 'unknown';
  if (!trr.procedures.length) return STATE.OPPORTUNITY;
  let covered = 0, partial = 0, gap = 0, opportunity = 0;
  for (const p of trr.procedures) {
    if (p.state === STATE.COVERED) covered++;
    else if (p.state === STATE.PARTIAL) partial++;
    else if (p.state === STATE.GAP) gap++;
    else opportunity++;
  }
  const total = trr.procedures.length;
  if (covered === total) return STATE.COVERED;
  if (gap === total) return STATE.GAP;
  if (opportunity === total) return STATE.OPPORTUNITY;
  return STATE.PARTIAL;
}

function trrCoveragePct(trr) {
  if (!trr.procedures.length) return 0;
  let sum = 0;
  for (const p of trr.procedures) sum += p.fraction;
  return (sum / trr.procedures.length) * 100;
}

// MITRE ATT&CK tactic ordering for the kill chain reading order. Tactics
// not in this list are appended alphabetically.
const TACTIC_ORDER = [
  'Reconnaissance',
  'Resource Development',
  'Initial Access',
  'Execution',
  'Persistence',
  'Privilege Escalation',
  'Defense Evasion',
  'Credential Access',
  'Discovery',
  'Lateral Movement',
  'Collection',
  'Command and Control',
  'Exfiltration',
  'Impact',
];

function orderedTactics(allTactics) {
  const known = TACTIC_ORDER.filter(t => allTactics.includes(t));
  const rest = allTactics.filter(t => !TACTIC_ORDER.includes(t)).sort();
  return [...known, ...rest];
}

// Build a 2D structure: tactic -> [TRRs in that tactic, sorted by state then id]
function buildMatrix(model) {
  const allTactics = Array.from(new Set(
    Array.from(model.trrs.values()).flatMap(t => t.tactics)
  ));
  const tactics = orderedTactics(allTactics);

  // For each tactic, collect TRRs
  const columns = tactics.map(tactic => {
    const trrs = Array.from(model.trrs.values()).filter(t => t.tactics.includes(tactic));
    // Stable sort: gaps first, then partial, opportunity, covered, then by id
    // This puts what-needs-work at top of each column.
    const order = { [STATE.GAP]: 0, [STATE.PARTIAL]: 1, [STATE.OPPORTUNITY]: 2, [STATE.COVERED]: 3, 'unknown': 4 };
    trrs.sort((a, b) => {
      const sa = trrOverallState(a, model.hasPcrSource);
      const sb = trrOverallState(b, model.hasPcrSource);
      if (order[sa] !== order[sb]) return order[sa] - order[sb];
      return a.id.localeCompare(b.id);
    });
    return { tactic, trrs };
  });

  return { columns, tactics };
}

function renderCell(trr, model) {
  const state = trrOverallState(trr, model.hasPcrSource);
  const pct = trrCoveragePct(trr);
  const src = model.sources.find(s => s.Name === trr.sourceName);
  const href = src && src.BaseUrl
    ? `${src.BaseUrl}${src.BaseUrl.endsWith('/') ? '' : '/'}?trr=${trr.id}`
    : null;

  const tooltip = model.hasPcrSource
    ? `${trr.id} · ${trr.name}\n${trr.procedures.length} procedures · ${Math.round(pct)}% covered`
    : `${trr.id} · ${trr.name}\n${trr.procedures.length} procedures`;

  const cell = el(href ? 'a' : 'div', {
    class: `matrix-cell state-${state}`,
    ...(href ? { href, target: '_blank', rel: 'noopener' } : {}),
    title: tooltip,
  },
    el('div', { class: 'matrix-cell-id mono' }, trr.id),
    el('div', { class: 'matrix-cell-name' }, trr.name),
    model.hasPcrSource ? el('div', { class: 'matrix-cell-pct mono' }, Math.round(pct) + '%') : null,
  );
  return cell;
}

function renderLegend(hasPcr) {
  if (!hasPcr) return el('div', { class: 'legend' },
    el('span', { class: 'legend-item' },
      el('span', { class: 'legend-sw', style: 'background: var(--bg-inset); border: 1px solid var(--border-strong);' }),
      'TRR'));
  return el('div', { class: 'legend' },
    el('span', { class: 'legend-item' }, el('span', { class: 'legend-sw covered' }), 'covered'),
    el('span', { class: 'legend-item' }, el('span', { class: 'legend-sw partial' }), 'partial'),
    el('span', { class: 'legend-item' }, el('span', { class: 'legend-sw gap' }), 'gap'),
    el('span', { class: 'legend-item' }, el('span', { class: 'legend-sw opportunity' }), 'opportunity'),
  );
}

export async function renderMatrixView(container) {
  container.innerHTML = '';
  container.append(el('div', { class: 'loader' }, 'Loading matrix'));

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

  const { columns } = buildMatrix(model);
  container.innerHTML = '';

  // Header strip with legend and summary
  container.append(el('div', { class: 'matrix-header' },
    el('div', { class: 'matrix-summary' },
      el('span', null, `${model.trrs.size} TRRs across ${columns.length} tactics`),
      model.hasPcrSource
        ? el('span', { style: 'color: var(--text-dim);' }, ' · ordered with what-needs-work first')
        : null,
    ),
    renderLegend(model.hasPcrSource),
  ));

  // The matrix itself: a horizontally-scrollable grid of columns.
  const matrix = el('div', { class: 'matrix-grid' });
  for (const col of columns) {
    const column = el('div', { class: 'matrix-column' });
    column.append(el('div', { class: 'matrix-col-header' },
      el('div', { class: 'matrix-col-title' }, col.tactic),
      el('div', { class: 'matrix-col-count mono' }, `${col.trrs.length}`),
    ));
    const cells = el('div', { class: 'matrix-col-cells' });
    for (const trr of col.trrs) {
      cells.append(renderCell(trr, model));
    }
    column.append(cells);
    matrix.append(column);
  }
  container.append(matrix);
}
