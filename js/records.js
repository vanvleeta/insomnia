/* ============================================================
   records.js — Renders the PCR browse view ("Records").
   Mirrors the structure of techniques.js but for Procedure
   Coverage Records.

   URL params:
     ?procedure=TRR0030.WIN.A   filter to PCRs that reference this procedure
     ?type=gap|coverage|detection|detached
   ============================================================ */

import { loadInsomniaData, PCR_TYPE } from './data.js';

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

function uniqueSorted(items) {
  return Array.from(new Set(items)).sort();
}

const TYPE_DISPLAY = {
  [PCR_TYPE.GAP]:       'gap',
  [PCR_TYPE.COVERAGE]:  'coverage',
  [PCR_TYPE.DETECTION]: 'detection',
};

function typeTagClass(t) {
  if (t === PCR_TYPE.GAP) return 'gap';
  if (t === PCR_TYPE.COVERAGE) return 'covered';
  if (t === PCR_TYPE.DETECTION) return 'covered';
  return 'opportunity';
}

function renderPcrCard(pcr, model, pcrUrl) {
  const card = el('div', { class: 'pcr-card' });

  const titleNode = pcrUrl
    ? el('a', { class: 'pcr-card-title-link', href: pcrUrl, target: '_blank', rel: 'noopener' }, pcr.title || '(untitled)')
    : (pcr.title || '(untitled)');

  const idLink = pcrUrl
    ? el('a', { href: pcrUrl, target: '_blank', rel: 'noopener' }, pcr.id)
    : pcr.id;
  const ids = el('div', { class: 'pcr-card-ids mono' }, idLink);
  for (const tech of pcr.techniques.slice(0, 3)) {
    ids.append(document.createTextNode(' · '), tech);
  }
  if (pcr.techniques.length > 3) {
    ids.append(document.createTextNode(' · '));
    ids.append(el('span', {
      class: 'more-ids',
      title: pcr.techniques.join(', ')
    }, `+${pcr.techniques.length - 3}`));
  }

  const isDetached = !pcr.procedures || pcr.procedures.length === 0;

  // Card head: title + IDs (left) and type/status (right)
  const headRight = el('div', { class: 'pcr-card-head-right' });
  if (pcr.type) {
    headRight.append(el('span', {
      class: `status-tag ${typeTagClass(pcr.type)}`,
      title: pcr.rawType
    }, TYPE_DISPLAY[pcr.type] || pcr.type));
  }
  if (pcr.status === 'Retired') {
    headRight.append(el('span', { class: 'status-tag retired' }, 'retired'));
  }

  card.append(el('div', { class: 'pcr-card-head' },
    el('div', { class: 'pcr-card-head-left' },
      el('div', { class: 'pcr-card-title' }, titleNode),
      ids,
    ),
    headRight,
  ));

  // Tags row: source, platforms, tactics, detached marker
  const tags = el('div', { class: 'trr-tags' });
  tags.append(el('span', { class: 'tag source', title: 'Source repo' }, pcr.sourceName));
  if (isDetached) {
    tags.append(el('span', { class: 'tag detached', title: 'No procedure references' }, 'detached'));
  }
  for (const plat of pcr.platforms) {
    tags.append(el('span', { class: 'tag platform' }, plat));
  }
  for (const tac of pcr.tactics) {
    tags.append(el('span', { class: 'tag' }, tac));
  }
  card.append(tags);

  // Referenced procedures (link back to techniques)
  if (!isDetached && pcr.procedures.length > 0) {
    card.append(el('div', { class: 'proc-count' },
      `${pcr.procedures.length} procedure${pcr.procedures.length === 1 ? '' : 's'}`));
    const list = el('div', { class: 'pcr-proc-list' });
    for (const procId of pcr.procedures) {
      const proc = model.procedures.get(procId);
      const trr = proc ? model.trrs.get(proc.trrId) : null;
      const label = proc && trr ? `${proc.name} · ${trr.name}` : '(unknown procedure)';
      if (proc) {
        list.append(el('a', {
          class: 'pcr-proc-ref',
          href: `techniques.html?q=${encodeURIComponent(procId)}`,
          title: label,
        },
          el('span', { class: 'mono pcr-proc-id' }, procId),
          el('span', { class: 'pcr-proc-name' }, label),
        ));
      } else {
        // Unknown procedure — render as a non-clickable row, since a search
        // for the ID would return zero results anyway.
        list.append(el('div', {
          class: 'pcr-proc-ref unknown',
          title: 'This procedure is not present in any configured TRR source.',
        },
          el('span', { class: 'mono pcr-proc-id' }, procId),
          el('span', { class: 'pcr-proc-name' }, label),
        ));
      }
    }
    card.append(list);
  }

  // AVL detection metadata is intentionally omitted from card display to
  // keep all PCR types visually consistent — the Records view focuses on
  // which procedures each record addresses, not the rule internals.

  return card;
}

function matchesFilters(pcr, filters) {
  if (filters.platform !== 'all' && !pcr.platforms.includes(filters.platform)) return false;
  if (filters.tactic   !== 'all' && !pcr.tactics.includes(filters.tactic))     return false;
  if (filters.type     !== 'all') {
    if (filters.type === 'detached') {
      if (pcr.procedures && pcr.procedures.length > 0) return false;
    } else if (pcr.type !== filters.type) {
      return false;
    }
  }
  if (filters.status !== 'all' && pcr.status !== filters.status) return false;
  if (filters.created !== 'all') {
    const days = parseInt(filters.created, 10);
    if (!isNaN(days)) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const d = pcr.pubDate || '';
      if (!d || d < cutoffStr) return false;
    }
  }
  if (filters.procedure && filters.procedure !== 'all') {
    if (!pcr.procedures.includes(filters.procedure)) return false;
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const hay = [
      pcr.id, pcr.title || '',
      ...(pcr.techniques || []),
      ...(pcr.tactics || []),
      ...(pcr.platforms || []),
      ...(pcr.procedures || []),
    ].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export async function renderRecordsView(container) {
  container.innerHTML = '';
  container.append(el('div', { class: 'loader' }, 'Loading records'));

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

  container.innerHTML = '';

  // No PCR source configured: explain rather than render an empty list.
  if (!model.hasPcrSource) {
    container.append(el('div', { class: 'library-only-hint' },
      el('div', { class: 'hint-title' }, 'No coverage records'),
      el('div', { class: 'hint-body' },
        'Records (PCRs) are only available when a PCR source is configured. ',
        'Add a ', el('code', null, '{"Type":"PCR",…}'), ' entry to ',
        el('code', null, 'sources.json'), ' to enable this view.')
    ));
    return;
  }

  // Honor URL filters
  const url = new URLSearchParams(window.location.search);
  const filters = {
    search:    '',
    platform:  'all',
    tactic:    'all',
    type:      url.get('type') || 'all',
    status:    'Active',
    created:   'all',
    procedure: url.get('procedure') || 'all',
    sort:      'newest',
  };

  // Source URL resolver
  const pcrUrlFor = (pcr) => {
    const src = model.sources.find(s => s.Name === pcr.sourceName);
    if (!src || !src.BaseUrl) return null;
    return `${src.BaseUrl}${src.BaseUrl.endsWith('/') ? '' : '/'}?pcr=${pcr.id}`;
  };

  const allPlatforms = uniqueSorted(Array.from(model.pcrs.values()).flatMap(p => p.platforms));
  const allTactics   = uniqueSorted(Array.from(model.pcrs.values()).flatMap(p => p.tactics));

  const searchInput = el('input', {
    class: 'search-input',
    type: 'text',
    placeholder: 'Search records, procedure IDs, technique IDs…',
  });
  searchInput.addEventListener('input', () => { filters.search = searchInput.value.trim(); rerender(); });

  const platformSel = el('select', { class: 'filter-select' },
    el('option', { value: 'all' }, 'All platforms'),
    ...allPlatforms.map(p => el('option', { value: p }, p)));
  platformSel.addEventListener('change', () => { filters.platform = platformSel.value; rerender(); });

  const tacticSel = el('select', { class: 'filter-select' },
    el('option', { value: 'all' }, 'All tactics'),
    ...allTactics.map(t => el('option', { value: t }, t)));
  tacticSel.addEventListener('change', () => { filters.tactic = tacticSel.value; rerender(); });

  const typeSel = el('select', { class: 'filter-select' },
    el('option', { value: 'all' }, 'Any type'),
    el('option', { value: PCR_TYPE.COVERAGE }, 'Coverage records'),
    el('option', { value: PCR_TYPE.DETECTION }, 'Detection records'),
    el('option', { value: PCR_TYPE.GAP }, 'Gap records'),
    el('option', { value: 'detached' }, 'Detached records'),
  );
  typeSel.value = filters.type;
  typeSel.addEventListener('change', () => { filters.type = typeSel.value; rerender(); });

  const statusSel = el('select', { class: 'filter-select' },
    el('option', { value: 'Active' }, 'Active only'),
    el('option', { value: 'all' }, 'All statuses'),
    el('option', { value: 'Retired' }, 'Retired only'),
  );
  statusSel.value = filters.status;
  statusSel.addEventListener('change', () => { filters.status = statusSel.value; rerender(); });

  const createdSel = el('select', { class: 'filter-select' },
    el('option', { value: 'all' }, 'All time'),
    el('option', { value: '30' },  'Last 30 days'),
    el('option', { value: '60' },  'Last 60 days'),
    el('option', { value: '90' },  'Last 90 days'),
    el('option', { value: '365' }, 'Last year'));
  createdSel.addEventListener('change', () => { filters.created = createdSel.value; rerender(); });

  const sortSel = el('select', { class: 'filter-select', title: 'Sort order' },
    el('option', { value: 'newest' }, 'Sort: most recently published'),
    el('option', { value: 'id-asc' }, 'Sort: PCR ID ascending'),
    el('option', { value: 'id-desc' }, 'Sort: PCR ID descending'),
    el('option', { value: 'type' }, 'Sort: by type'),
  );
  sortSel.addEventListener('change', () => { filters.sort = sortSel.value; rerender(); });

  const controls = el('div', { class: 'browse-controls' },
    searchInput, platformSel, tacticSel, typeSel, statusSel, createdSel, sortSel);
  container.append(controls);

  // Active-filter banner. Shows the procedure filter (from URL) with a clear button.
  const filterBanner = el('div', { class: 'active-filter-banner', style: 'display:none;' });
  container.append(filterBanner);

  const meta = el('div', { class: 'results-meta' });
  container.append(meta);

  const grid = el('div', { class: 'pcr-grid' });
  container.append(grid);

  function updateFilterBanner() {
    if (filters.procedure && filters.procedure !== 'all') {
      filterBanner.style.display = '';
      filterBanner.innerHTML = '';
      const proc = model.procedures.get(filters.procedure);
      const trr = proc ? model.trrs.get(proc.trrId) : null;
      const label = proc && trr ? `${proc.name} (${trr.name})` : '(unknown)';
      filterBanner.append(
        el('span', null, 'Filtered to procedure '),
        el('span', { class: 'mono', style: 'color: var(--brand);' }, filters.procedure),
        el('span', { style: 'color: var(--text-dim);' }, ` · ${label}`),
        el('button', { class: 'clear-filter-btn', onclick: () => {
          filters.procedure = 'all';
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.delete('procedure');
          window.history.replaceState(null, '', newUrl);
          updateFilterBanner();
          rerender();
        }}, 'Clear filter')
      );
    } else {
      filterBanner.style.display = 'none';
    }
  }

  function rerender() {
    const matching = Array.from(model.pcrs.values())
      .filter(p => matchesFilters(p, filters))
      .sort((a, b) => {
        switch (filters.sort) {
          case 'id-asc':  return a.id.localeCompare(b.id);
          case 'id-desc': return b.id.localeCompare(a.id);
          case 'type':    return (a.type || '').localeCompare(b.type || '') || a.id.localeCompare(b.id);
          case 'newest':
          default: {
            const ad = a.lastUpdate || a.pubDate || '';
            const bd = b.lastUpdate || b.pubDate || '';
            if (ad !== bd) return bd.localeCompare(ad);
            return a.id.localeCompare(b.id);
          }
        }
      });

    const sortLabels = {
      newest:  'most recently published',
      'id-asc':  'PCR ID ascending',
      'id-desc': 'PCR ID descending',
      type:    'by type',
    };
    meta.textContent = `${matching.length} of ${model.pcrs.size} PCRs · sorted by ${sortLabels[filters.sort]}`;

    grid.innerHTML = '';
    if (matching.length === 0) {
      grid.append(el('div', { class: 'card', style: 'grid-column: 1 / -1; text-align: center; color: var(--text-dim);' },
        'No records match the current filters.'));
      return;
    }
    for (const pcr of matching) {
      grid.append(renderPcrCard(pcr, model, pcrUrlFor(pcr)));
    }
  }

  updateFilterBanner();
  rerender();
}
