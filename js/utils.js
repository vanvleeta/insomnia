/* ============================================================
   utils.js — Shared utilities used across all view modules.
   ============================================================ */

export function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      // Applied through the CSSOM rather than as an attribute: the page's
      // Content-Security-Policy refuses style attributes, so setAttribute
      // would leave the element unstyled -- silently.
      else if (k === 'style') n.style.cssText = v;
      else n.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export function uniqueSorted(items) {
  return Array.from(new Set(items)).sort();
}

export function trrCoveragePct(trr) {
  if (!trr.procedures.length) return 0;
  let sum = 0;
  for (const p of trr.procedures) sum += p.fraction;
  return (sum / trr.procedures.length) * 100;
}

// Errors and warnings from loading, shown at the top of every view. Before
// this existed only the dashboard showed errors and nothing showed warnings,
// so a source failing on another page -- or a cross-source problem such as
// two sources disagreeing about a platform code -- was invisible.
export function renderLoadProblems(model) {
  const frag = document.createDocumentFragment();

  for (const msg of (model.loadErrors || [])) {
    frag.append(el('div', { class: 'error-banner', role: 'alert' },
      el('div', { class: 'err-title' }, 'Load error'),
      el('div', { class: 'err-detail' }, msg)));
  }
  for (const msg of (model.warnings || [])) {
    frag.append(el('div', { class: 'warning-banner', role: 'status' },
      el('div', { class: 'err-title' }, 'Warning'),
      el('div', { class: 'err-detail' }, msg)));
  }
  return frag;
}

