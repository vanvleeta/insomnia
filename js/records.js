/* ============================================================
   records.js — Renders the coverage record browse view ("Records").
   Mirrors the structure of techniques.js but for Procedure
   Coverage Records.

   URL params:
     ?procedure=TRR0030.WIN.A   filter to coverage records that reference this procedure
     ?type=gap|coverage|detection|detached
   ============================================================ */

import { loadInsomniaData, RECORD_TYPE, recordUrl } from './data.js';
import { el, uniqueSorted, renderLoadProblems } from './utils.js';

const TYPE_DISPLAY = {
  [RECORD_TYPE.GAP]:       'gap',
  [RECORD_TYPE.COVERAGE]:  'coverage',
  [RECORD_TYPE.DETECTION]: 'detection',
};

function typeTagClass(t) {
  if (t === RECORD_TYPE.GAP) return 'gap';
  if (t === RECORD_TYPE.COVERAGE) return 'covered';
  if (t === RECORD_TYPE.DETECTION) return 'covered';
  return 'opportunity';
}

function renderRecordCard(record, model, href) {
  const card = el('div', { class: 'record-card' });

  const titleNode = href
    ? el('a', { class: 'card-title-link', href, target: '_blank', rel: 'noopener' }, record.title || '(untitled)')
    : (record.title || '(untitled)');

  const idLink = href
    ? el('a', { href, target: '_blank', rel: 'noopener' }, record.id)
    : record.id;
  const ids = el('div', { class: 'card-ids mono' }, idLink);
  for (const tech of record.techniques.slice(0, 3)) {
    ids.append(document.createTextNode(' · '), tech);
  }
  if (record.techniques.length > 3) {
    ids.append(document.createTextNode(' · '));
    ids.append(el('span', {
      class: 'more-ids',
      title: record.techniques.join(', ')
    }, `+${record.techniques.length - 3}`));
  }

  const isDetached = !record.procedures || record.procedures.length === 0;

  // Card head: title + IDs (left) and type/status (right)
  const headRight = el('div', { class: 'card-head-right' });
  if (record.type) {
    headRight.append(el('span', {
      class: `status-tag ${typeTagClass(record.type)}`,
      title: record.rawType
    }, TYPE_DISPLAY[record.type] || record.type));
  }
  if (record.status === 'Retired') {
    headRight.append(el('span', { class: 'status-tag retired' }, 'retired'));
  }

  card.append(el('div', { class: 'card-head' },
    el('div', { class: 'card-head-left' },
      el('div', { class: 'card-title' }, titleNode),
      ids,
    ),
    headRight,
  ));

  // Tags row: source, platforms, tactics, detached marker
  const tags = el('div', { class: 'item-tags' });
  tags.append(el('span', { class: 'tag source', title: 'Source repo' }, record.sourceName));
  if (record.provider) {
    tags.append(el('span',
      { class: 'tag provider', title: 'Coverage provider' }, record.provider));
  }
  if (isDetached) {
    tags.append(el('span', { class: 'tag detached', title: 'No procedure references' }, 'detached'));
  }
  for (const plat of record.platforms) {
    tags.append(el('span', { class: 'tag platform' }, plat));
  }
  for (const tac of record.tactics) {
    tags.append(el('span', { class: 'tag' }, tac));
  }
  card.append(tags);

  // Referenced procedures (link back to techniques)
  if (!isDetached && record.procedures.length > 0) {
    const list = el('div', { class: 'record-proc-list' });
    for (const procId of record.procedures) {
      const proc = model.procedures.get(procId);
      const trr = proc ? model.trrs.get(proc.trrKey) : null;
      const fullLabel = proc && trr
        ? `${proc.name} · ${trr.title}`
        : '(unknown procedure)';
      const label = proc ? proc.name : '(unknown procedure)';
      if (proc) {
        // Stay in this view and filter to the procedure, matching how the
        // techniques view navigates. Linking to techniques.html with a
        // procedure ID never matched anything, because that view searches
        // reports by report ID.
        list.append(el('a', {
          class: 'record-proc-ref',
          href: `records.html?procedure=${encodeURIComponent(procId)}`,
          title: fullLabel,
        },
          el('span', { class: 'mono record-proc-id' }, procId),
          el('span', { class: 'record-proc-name' }, label),
        ));
      } else {
        // Unknown procedure — render as a non-clickable row, since a search
        // for the ID would return zero results anyway.
        list.append(el('div', {
          class: 'record-proc-ref unknown',
          title: 'This procedure is not present in any configured TRR source.',
        },
          el('span', { class: 'mono record-proc-id' }, procId),
          el('span', { class: 'record-proc-name' }, label),
        ));
      }
    }
    card.append(list);
  }

  // AVL detection metadata is intentionally omitted from card display to
  // keep all record types visually consistent — the Records view focuses on
  // which procedures each record addresses, not the rule internals.

  return card;
}

function matchesFilters(record, filters, model) {
  if (filters.platform !== 'all' && !record.platforms.includes(filters.platform)) return false;
  if (filters.provider !== 'all' && record.provider !== filters.provider)         return false;
  if (filters.tactic   !== 'all' && !record.tactics.includes(filters.tactic))     return false;
  if (filters.type     !== 'all') {
    if (filters.type === 'detached') {
      // Detached = record explicitly lists no procedures.
      if (record.procedures && record.procedures.length > 0) return false;
    } else if (filters.type === 'orphaned') {
      // Orphaned = record references procedure IDs, but none of them resolve.
      if (!record.procedures || record.procedures.length === 0) return false;
      const anyKnown = record.procedures.some(id => model.procedures.has(id));
      if (anyKnown) return false;
    } else if (record.type !== filters.type) {
      return false;
    }
  }
  if (filters.status !== 'all' && record.status !== filters.status) return false;
  if (filters.created !== 'all') {
    const days = parseInt(filters.created, 10);
    if (!isNaN(days)) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const d = record.pubDate || '';
      if (!d || d < cutoffStr) return false;
    }
  }
  if (filters.procedure && filters.procedure !== 'all') {
    if (!record.procedures.includes(filters.procedure)) return false;
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const hay = [
      record.id, record.title || '',
      ...(record.techniques || []),
      ...(record.tactics || []),
      ...(record.platforms || []),
      ...(record.procedures || []),
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
  container.append(renderLoadProblems(model));

  // No coverage source configured: explain rather than render an empty list.
  if (!model.hasCoverageSource) {
    container.append(el('div', { class: 'library-only-hint' },
      el('div', { class: 'hint-title' }, 'No coverage records'),
      el('div', { class: 'hint-body' },
        'Coverage records are only available when a coverage source is configured. ',
        'Add a ', el('code', null, '{"Type":"coverage",…}'), ' entry to ',
        el('code', null, 'local/config.json'), ' to enable this view.')
    ));
    return;
  }

  // Honor URL filters
  const url = new URLSearchParams(window.location.search);
  const urlType = url.get('type') || 'all';
  // When arriving via the dashboard's orphan/detached banner, default to
  // showing all statuses so the count matches what the banner advertised.
  // (Otherwise the default 'Active' filter would silently hide retired coverage records.)
  const defaultStatus = (urlType === 'orphaned' || urlType === 'detached') ? 'all' : 'Active';
  const filters = {
    search:    '',
    platform:  'all',
    provider:  'all',
    tactic:    'all',
    type:      urlType,
    status:    defaultStatus,
    created:   'all',
    procedure: url.get('procedure') || 'all',
    sort:      'newest',
  };

  // Source URL resolver — builds <BaseUrl>/records/<id-lowercase>/README.md
  const recordUrlFor = (record) => recordUrl(record, model);

  const allPlatforms = uniqueSorted(Array.from(model.records.values()).flatMap(p => p.platforms));
  const allTactics   = uniqueSorted(Array.from(model.records.values()).flatMap(p => p.tactics));
  const allProviders = uniqueSorted(
    Array.from(model.records.values()).map(r => r.provider).filter(Boolean));

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

  // Only offered when the loaded records actually name providers; a
  // library-only deployment has none.
  const providerSel = allProviders.length
    ? el('select', { class: 'filter-select' },
        el('option', { value: 'all' }, 'All providers'),
        ...allProviders.map(p => el('option', { value: p }, p)))
    : null;
  if (providerSel) {
    providerSel.addEventListener('change', () => {
      filters.provider = providerSel.value; rerender();
    });
  }

  const tacticSel = el('select', { class: 'filter-select' },
    el('option', { value: 'all' }, 'All tactics'),
    ...allTactics.map(t => el('option', { value: t }, t)));
  tacticSel.addEventListener('change', () => { filters.tactic = tacticSel.value; rerender(); });

  const typeSel = el('select', { class: 'filter-select' },
    el('option', { value: 'all' }, 'Any type'),
    el('option', { value: RECORD_TYPE.COVERAGE }, 'Coverage records'),
    el('option', { value: RECORD_TYPE.GAP }, 'Gap records'),
    el('option', { value: 'detached' }, 'Detached records'),
    el('option', { value: 'orphaned' }, 'Orphaned records'),
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
    el('option', { value: 'id-asc' }, 'Sort: Record ID ascending'),
    el('option', { value: 'id-desc' }, 'Sort: Record ID descending'),
    el('option', { value: 'type' }, 'Sort: by type'),
  );
  sortSel.addEventListener('change', () => { filters.sort = sortSel.value; rerender(); });

  const controls = el('div', { class: 'browse-controls' },
    searchInput, platformSel,
    ...(providerSel ? [providerSel] : []),
    tacticSel, typeSel, statusSel, createdSel, sortSel);
  container.append(controls);

  // Active-filter banner. Shows the procedure filter (from URL) with a clear button.
  const filterBanner = el('div', { class: 'active-filter-banner', style: 'display:none;' });
  container.append(filterBanner);

  const meta = el('div', { class: 'results-meta' });
  container.append(meta);

  const grid = el('div', { class: 'item-grid' });
  container.append(grid);

  function updateFilterBanner() {
    if (filters.procedure && filters.procedure !== 'all') {
      filterBanner.style.display = '';
      filterBanner.innerHTML = '';
      const proc = model.procedures.get(filters.procedure);
      const trr = proc ? model.trrs.get(proc.trrKey) : null;
      const label = proc && trr ? `${proc.name} (${trr.title})` : '(unknown)';
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
    const matching = Array.from(model.records.values())
      .filter(p => matchesFilters(p, filters, model))
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
      'id-asc':  'record ID ascending',
      'id-desc': 'record ID descending',
      type:    'by type',
    };
    meta.textContent = `${matching.length} of ${model.records.size} records · sorted by ${sortLabels[filters.sort]}`;

    grid.innerHTML = '';
    if (matching.length === 0) {
      grid.append(el('div', { class: 'card', style: 'grid-column: 1 / -1; text-align: center; color: var(--text-dim);' },
        'No records match the current filters.'));
      return;
    }
    for (const record of matching) {
      grid.append(renderRecordCard(record, model, recordUrlFor(record)));
    }
  }

  updateFilterBanner();
  rerender();
}
