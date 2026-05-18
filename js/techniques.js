/* ============================================================
   techniques.js — Renders the TRR browse view with card-per-TRR
   layout and coverage indicators. Supports search, filters, sort.
   ============================================================ */

import { loadInsomniaData, STATE, trrUrl } from './data.js';

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

function trrCoveragePct(trr) {
  if (!trr.procedures.length) return 0;
  let sum = 0;
  for (const p of trr.procedures) sum += p.fraction;
  return (sum / trr.procedures.length) * 100;
}

function trrCoverageClass(pct) {
  if (pct >= 75) return 'high';
  if (pct >= 25) return 'mid';
  if (pct > 0)   return 'low';
  return 'zero';
}

function procCountsLabel(proc) {
  const parts = [];
  if (proc.coveredCount > 0) parts.push(`${proc.coveredCount} cov`);
  if (proc.gapCount > 0)     parts.push(`${proc.gapCount} gap`);
  if (parts.length === 0)    return 'opportunity';
  return parts.join(' · ');
}

function renderTrrCard(trr, model, sourceUrl, hasPcr) {
  const pct = trrCoveragePct(trr);
  const pctCls = trrCoverageClass(pct);

  const card = el('div', { class: 'trr-card' });

  // Title is a hyperlink to the source TRR page when a BaseUrl is configured.
  const titleNode = sourceUrl
    ? el('a', { class: 'trr-card-title-link', href: sourceUrl, target: '_blank', rel: 'noopener' }, trr.name)
    : trr.name;

  // IDs row: TRR ID + external IDs, truncated to one line.
  const idLink = sourceUrl
    ? el('a', { href: sourceUrl, target: '_blank', rel: 'noopener' }, trr.id)
    : trr.id;
  const ids = el('div', { class: 'trr-card-ids mono' }, idLink);

  // Fit as many external IDs as we can on a single visual line.
  // Strategy: character budget — the IDs row is one nowrap line, and IDs are
  // monospace, so character count is a good proxy for width. Tuned for the
  // minimum card width (~360px); any overflow becomes a "+N" pill with the
  // full list shown as a tooltip.
  const SEP = ' · ';
  const CHAR_BUDGET = 32;
  let used = 0;
  let shown = 0;
  for (const ext of trr.externalIds) {
    const cost = SEP.length + ext.length;
    if (used + cost > CHAR_BUDGET && shown > 0) break;
    ids.append(document.createTextNode(SEP), ext);
    used += cost;
    shown++;
  }
  const hidden = trr.externalIds.length - shown;
  if (hidden > 0) {
    const fullList = trr.externalIds.join(', ');
    ids.append(document.createTextNode(SEP));
    ids.append(el('span', { class: 'more-ids', title: fullList }, `+${hidden}`));
  }

  // Card head — coverage % only when we have a PCR source
  const headLeft = el('div', { class: 'trr-card-head-left' },
    el('div', { class: 'trr-card-title' }, titleNode),
    ids,
  );
  const headChildren = [headLeft];
  if (hasPcr) {
    headChildren.push(el('div', { class: `coverage-pct ${pctCls}` },
      Math.round(pct) + '%',
      el('span', { class: 'pct-label' }, 'COVERED')));
  }
  card.append(el('div', { class: 'trr-card-head' }, ...headChildren));

  // Tags: source, platforms, tactics
  const tags = el('div', { class: 'trr-tags' });
  tags.append(el('span', { class: 'tag source', title: 'Source repo' }, trr.sourceName));
  for (const plat of trr.platforms) {
    tags.append(el('span', { class: 'tag platform' }, plat));
  }
  for (const tac of trr.tactics) {
    tags.append(el('span', { class: 'tag' }, tac));
  }
  card.append(tags);

  // Procedure list
  card.append(el('div', { class: 'proc-count' },
    `${trr.procedures.length} procedure${trr.procedures.length === 1 ? '' : 's'}`));

  const list = el('div', { class: 'proc-list' });
  for (const proc of trr.procedures) {
    if (hasPcr) {
      list.append(el('a', {
        class: 'proc-row proc-row-link',
        href: `records.html?procedure=${encodeURIComponent(proc.id)}`,
        title: `${proc.id} — view related records`,
      },
        el('span', { class: `proc-swatch ${proc.state}` }),
        el('span', { class: 'proc-letter' }, proc.letter),
        el('span', { class: 'proc-name' }, proc.name),
        el('span', { class: 'proc-counts' }, procCountsLabel(proc))
      ));
    } else {
      list.append(el('div', { class: 'proc-row no-coverage', title: proc.id },
        el('span', { class: 'proc-letter' }, proc.letter),
        el('span', { class: 'proc-name' }, proc.name)
      ));
    }
  }
  card.append(list);

  return card;
}

function uniqueSorted(items) {
  return Array.from(new Set(items)).sort();
}

function matchesFilters(trr, filters) {
  if (filters.platform !== 'all' && !trr.platforms.includes(filters.platform)) return false;
  if (filters.tactic   !== 'all' && !trr.tactics.includes(filters.tactic))     return false;
  if (filters.created  !== 'all') {
    const days = parseInt(filters.created, 10);
    if (!isNaN(days)) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const trrDate = trr.pubDate || '';
      if (!trrDate || trrDate < cutoffStr) return false;
    }
  }
  if (filters.coverage !== 'all') {
    const pct = trrCoveragePct(trr);
    if (filters.coverage === 'covered'      && pct < 100) return false;
    if (filters.coverage === 'partial'      && (pct === 0 || pct === 100)) return false;
    if (filters.coverage === 'uncovered'    && pct > 0)   return false;
    if (filters.coverage === 'has-gap'      && !trr.procedures.some(p => p.state === STATE.GAP || p.state === STATE.PARTIAL)) return false;
    if (filters.coverage === 'opportunity'  && !trr.procedures.some(p => p.state === STATE.OPPORTUNITY)) return false;
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const haystack = [
      trr.id, trr.name,
      ...trr.externalIds,
      ...trr.tactics, ...trr.platforms,
      ...trr.procedures.map(p => p.id + ' ' + p.name)
    ].join(' ').toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

export async function renderTechniquesView(container, options = {}) {
  container.innerHTML = '';
  container.append(el('div', { class: 'loader' }, 'Loading sources'));

  let model;
  try {
    model = await loadInsomniaData();
  } catch (e) {
    container.innerHTML = '';
    container.append(el('div', { class: 'error-banner' },
      el('div', { html: '<div class="err-title">Could not load Insomnia data</div>' }),
      el('div', { class: 'err-detail' }, e.message)));
    return;
  }

  container.innerHTML = '';

  // Build sourceUrl lookup using the centralized helper.
  // Produces: <BaseUrl>/<trr_id_lowercase>/<platform_lowercase>/README.md
  const sourceUrlFor = (trr) => trrUrl(trr, model);

  // Controls
  const allPlatforms = uniqueSorted(Array.from(model.trrs.values()).flatMap(t => t.platforms));
  const allTactics   = uniqueSorted(Array.from(model.trrs.values()).flatMap(t => t.tactics));

  const filters = {
    search: '',
    platform: 'all',
    tactic: 'all',
    created: 'all',
    coverage: 'all',
    sort: 'coverage-asc',
  };

  // Honor ?view=orphans by switching to a special orphans-mode view
  const urlParams = new URLSearchParams(window.location.search);
  const orphansMode = urlParams.get('view') === 'orphans';

  if (orphansMode) {
    container.append(renderOrphansView(model));
    return;
  }

  const searchInput = el('input', {
    class: 'search-input',
    type: 'text',
    placeholder: 'Search TRRs, procedures, or technique IDs…',
  });
  searchInput.addEventListener('input', () => {
    filters.search = searchInput.value.trim();
    rerender();
  });

  const platformSel = el('select', { class: 'filter-select' },
    el('option', { value: 'all' }, 'All platforms'),
    ...allPlatforms.map(p => el('option', { value: p }, p)));
  platformSel.addEventListener('change', () => { filters.platform = platformSel.value; rerender(); });

  const tacticSel = el('select', { class: 'filter-select' },
    el('option', { value: 'all' }, 'All tactics'),
    ...allTactics.map(t => el('option', { value: t }, t)));
  tacticSel.addEventListener('change', () => { filters.tactic = tacticSel.value; rerender(); });

  const createdSel = el('select', { class: 'filter-select' },
    el('option', { value: 'all' }, 'All time'),
    el('option', { value: '30' },  'Last 30 days'),
    el('option', { value: '60' },  'Last 60 days'),
    el('option', { value: '90' },  'Last 90 days'),
    el('option', { value: '365' }, 'Last year'));
  createdSel.addEventListener('change', () => { filters.created = createdSel.value; rerender(); });

  let covSel = null;
  if (model.hasPcrSource) {
    covSel = el('select', { class: 'filter-select' },
      el('option', { value: 'all' }, 'Any coverage'),
      el('option', { value: 'covered' }, 'Fully covered'),
      el('option', { value: 'partial' }, 'Partially covered'),
      el('option', { value: 'uncovered' }, 'No coverage'),
      el('option', { value: 'has-gap' }, 'Has documented gap'),
      el('option', { value: 'opportunity' }, 'Has opportunity'));
    covSel.addEventListener('change', () => { filters.coverage = covSel.value; rerender(); });
  }

  // Build sort options. Coverage sorts only make sense when PCRs are loaded.
  const sortOpts = model.hasPcrSource
    ? [
        ['coverage-asc',  'Sort: lowest coverage first'],
        ['coverage-desc', 'Sort: highest coverage first'],
        ['id-asc',        'Sort: TRR ID ascending'],
        ['id-desc',       'Sort: TRR ID descending'],
        ['newest',        'Sort: most recently published'],
      ]
    : [
        ['newest',  'Sort: most recently published'],
        ['id-asc',  'Sort: TRR ID ascending'],
        ['id-desc', 'Sort: TRR ID descending'],
      ];
  // Default sort flips to "newest" when there's no coverage data
  if (!model.hasPcrSource) filters.sort = 'newest';

  const sortSel = el('select', { class: 'filter-select', title: 'Sort order' },
    ...sortOpts.map(([v, label]) => el('option', { value: v }, label))
  );
  sortSel.addEventListener('change', () => { filters.sort = sortSel.value; rerender(); });

  const controls = el('div', { class: 'browse-controls' },
    searchInput, platformSel, tacticSel, createdSel, covSel, sortSel);
  container.append(controls);

  const meta = el('div', { class: 'results-meta' });
  container.append(meta);

  const grid = el('div', { class: 'trr-grid' });
  container.append(grid);

  function rerender() {
    const matching = Array.from(model.trrs.values())
      .filter(trr => matchesFilters(trr, filters))
      .sort((a, b) => {
        switch (filters.sort) {
          case 'coverage-desc': {
            const ap = trrCoveragePct(a), bp = trrCoveragePct(b);
            if (ap !== bp) return bp - ap;
            return a.id.localeCompare(b.id);
          }
          case 'id-asc':
            return a.id.localeCompare(b.id);
          case 'id-desc':
            return b.id.localeCompare(a.id);
          case 'newest': {
            const ad = a.lastUpdate || a.pubDate || '';
            const bd = b.lastUpdate || b.pubDate || '';
            if (ad !== bd) return bd.localeCompare(ad);
            return a.id.localeCompare(b.id);
          }
          case 'coverage-asc':
          default: {
            const ap = trrCoveragePct(a), bp = trrCoveragePct(b);
            if (ap !== bp) return ap - bp;
            return a.id.localeCompare(b.id);
          }
        }
      });

    const sortLabels = {
      'coverage-asc':  'lowest coverage first',
      'coverage-desc': 'highest coverage first',
      'id-asc':        'TRR ID ascending',
      'id-desc':       'TRR ID descending',
      'newest':        'most recently published',
    };
    meta.textContent = `${matching.length} of ${model.trrs.size} TRRs · sorted by ${sortLabels[filters.sort]}`;

    grid.innerHTML = '';
    if (matching.length === 0) {
      grid.append(el('div', { class: 'card', style: 'grid-column: 1 / -1; text-align: center; color: var(--text-dim);' },
        'No TRRs match the current filters.'));
      return;
    }
    for (const trr of matching) {
      grid.append(renderTrrCard(trr, model, sourceUrlFor(trr), model.hasPcrSource));
    }
  }

  rerender();
}

function renderOrphansView(model) {
  const wrap = el('div', { class: 'card' });
  wrap.append(el('div', { class: 'chart-header' },
    el('div', { class: 'chart-title' }, `Orphaned PCRs (${model.orphanedPcrs.length})`)));
  if (model.orphanedPcrs.length === 0) {
    wrap.append(el('div', { style: 'color: var(--text-dim); padding: 10px 0;' },
      'No orphaned PCRs. Every PCR references a known procedure.'));
    return wrap;
  }
  for (const pcr of model.orphanedPcrs) {
    wrap.append(el('div', { class: 'gap-item' },
      el('span', { class: 'desc' },
        el('span', { class: 'id mono' }, pcr.id),
        pcr.title || '(no title)'),
      el('span', { class: 'mono', style: 'color: var(--text-dim); font-size: 11px;' },
        pcr.procedures.join(', '))));
  }
  return wrap;
}
