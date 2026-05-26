/* ============================================================
   utils.js — Shared utilities used across all view modules.
   ============================================================ */

export function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
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

export function uniqueSorted(items) {
  return Array.from(new Set(items)).sort();
}

export function trrCoveragePct(trr) {
  if (!trr.procedures.length) return 0;
  let sum = 0;
  for (const p of trr.procedures) sum += p.fraction;
  return (sum / trr.procedures.length) * 100;
}
