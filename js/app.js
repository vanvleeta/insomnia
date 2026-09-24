/* ============================================================
   app.js — Shared init: theme toggle, header behavior.
   ============================================================ */

const THEME_KEY = 'insomnia.theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = theme === 'dark' ? 'ti ti-sun' : 'ti ti-moon';
    }
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }
}

function initTheme() {
  // Default to dark — SOC after midnight. Light mode is opt-in.
  let theme = localStorage.getItem(THEME_KEY);
  if (theme !== 'light' && theme !== 'dark') {
    theme = 'dark';
  }
  applyTheme(theme);

  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    });
  }
}

// Summarize the configured sources by type. The element previously showed
// minutes since page load, which measured nothing about the data.
async function initSourceSummary() {
  const t = document.getElementById('header-last-sync');
  if (!t) return;

  const ORDER = ['library', 'coverage', 'validation', 'emulation'];
  const LABELS = {
    library:    ['library', 'libraries'],
    coverage:   ['coverage', 'coverage'],
    validation: ['validation', 'validation'],
    emulation:  ['emulation', 'emulation'],
  };

  try {
    const r = await fetch('local/config.json', { cache: 'no-cache' });
    const config = await r.json();
    const sources = (config && config.sources) || [];

    const counts = {};
    for (const src of sources) {
      const type = String(src.Type || '').toLowerCase();
      if (ORDER.includes(type)) counts[type] = (counts[type] || 0) + 1;
    }

    const parts = ORDER
      .filter(type => counts[type])
      .map(type => {
        const n = counts[type];
        const [one, many] = LABELS[type];
        return `${n} ${n === 1 ? one : many}`;
      });

    t.textContent = parts.length ? parts.join(' · ') : 'no sources configured';
  } catch (_) {
    t.textContent = 'sources unavailable';
  }
}

// ---------------------------------------------------------------------
// Optional site banner, shown on the dashboard only.
//
// Core ships no banner. An instance that wants one -- the public TRR
// library explaining what the site is, or an internal deployment marking
// itself as confidential -- adds a "banner" block to local/config.json:
//
//   "banner": {
//     "title": "The TIRED Labs Technique Research Library",
//     "body":  ["A paragraph, with [inline links](https://example.com)."],
//     "links": [{ "text": "Contribute", "href": "https://..." }]
//   }
//
// It is built from elements rather than injected as HTML: the page's
// Content-Security-Policy forbids inline styles, and building nodes means a
// banner cannot carry markup or script into the page. It is inserted after
// the header rather than into <main>, because every view clears <main> when
// it renders.
// ---------------------------------------------------------------------

// Only ordinary web links. Anything else -- javascript:, data: -- is
// dropped, so a banner cannot become a way to run code.
function safeHref(href) {
  const value = String(href || '').trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[./#?]|^[a-z0-9_-]+\.html/i.test(value)) return value;  // relative
  return null;
}

// Turn "text with [a link](https://x)" into text and anchor nodes.
function renderInline(text) {
  const nodes = [];
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(document.createTextNode(text.slice(last, match.index)));
    }
    const href = safeHref(match[2]);
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = match[1];
      if (/^https?:/i.test(href)) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      nodes.push(a);
    } else {
      nodes.push(document.createTextNode(match[1]));
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

// The banner belongs to the dashboard only. Detected from the view the page
// loads rather than from its URL, because a deployment may serve the
// dashboard at "/", "/insomnia/", or "/insomnia/index.html" alike.
function isDashboardPage() {
  return !!document.querySelector('script[src$="init-dashboard.js"]');
}

async function initBanner() {
  if (!isDashboardPage()) return;

  let config;
  try {
    const r = await fetch('local/config.json', { cache: 'no-cache' });
    config = await r.json();
  } catch (_) {
    return;                                 // no config, no banner
  }

  const banner = config && config.banner;
  if (!banner || (!banner.title && !banner.body)) return;

  const header = document.querySelector('header.header');
  if (!header) return;

  const section = document.createElement('section');
  section.className = 'site-banner';
  section.setAttribute('role', 'region');
  section.setAttribute('aria-label', banner.title || 'About this site');

  const inner = document.createElement('div');
  inner.className = 'site-banner-inner';

  if (banner.title) {
    const h = document.createElement('h2');
    h.className = 'site-banner-title';
    h.textContent = banner.title;
    inner.append(h);
  }

  const paragraphs = Array.isArray(banner.body) ? banner.body
                   : banner.body ? [banner.body] : [];
  for (const text of paragraphs) {
    const para = document.createElement('p');
    para.className = 'site-banner-body';
    para.append(...renderInline(String(text)));
    inner.append(para);
  }

  const links = (banner.links || [])
    .map(l => ({ text: l && l.text, href: safeHref(l && l.href) }))
    .filter(l => l.text && l.href);
  if (links.length) {
    const row = document.createElement('div');
    row.className = 'site-banner-links';
    for (const link of links) {
      const a = document.createElement('a');
      a.className = 'site-banner-link';
      a.href = link.href;
      a.textContent = link.text;
      if (/^https?:/i.test(link.href)) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      row.append(a);
    }
    inner.append(row);
  }

  section.append(inner);
  header.insertAdjacentElement('afterend', section);
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initSourceSummary();
  initBanner();
  injectContributeButton();
  injectBrandMark();
  initLibraryOnlyMode();
});

// Tag <body> with `library-only` when no coverage source is configured, so CSS
// can hide nav items that don't make sense (Records). Runs on every page;
// the dashboard's own logic also reads the config but is allowed to render
// either way.
async function initLibraryOnlyMode() {
  try {
    const r = await fetch('local/config.json', { cache: 'no-cache' });
    const config = await r.json();
    const sources = (config && config.sources) || [];
    const hasCoverage = sources.some(
      s => s && String(s.Type).toLowerCase() === 'coverage'
    );
    if (!hasCoverage) document.body.classList.add('library-only');
  } catch (_) { /* ignore — pages render their own load errors */ }
}

// Subtle "Contribute" floating button in the bottom-left, linking to the
// TRR Library project overview.
// TIRED Labs mark, bottom-right -- opposite the contribute button, which sits
// bottom-left, so the two never collide. Two images, one per theme, swapped by
// the same .eye-dark / .eye-light rules the header logo uses.
function injectBrandMark() {
  if (document.getElementById('brand-fab')) return;
  const a = document.createElement('a');
  a.id = 'brand-fab';
  a.href = 'https://www.tired-labs.org/';
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', 'TIRED Labs');
  a.title = 'TIRED Labs';
  for (const [cls, src] of [['eye-dark',  'img/tired-labs-for-dark-mode.png'],
                            ['eye-light', 'img/tired-labs-for-light-mode.png']]) {
    const img = document.createElement('img');
    img.className = cls;
    img.src = src;
    img.alt = '';                 // the link carries the label
    img.decoding = 'async';
    a.append(img);
  }
  document.body.append(a);
}

function injectContributeButton() {
  if (document.getElementById('contribute-fab')) return;
  const a = document.createElement('a');
  a.id = 'contribute-fab';
  // Deliberately hardcoded to the public TRR library, in every deployment
  // including internal ones: the aim is that anyone running Insomnia thinks
  // of contributing research back publicly. Change it here if your instance
  // should point elsewhere -- noting this is a core file, so the change will
  // need re-applying after an upstream merge that touches it.
  a.href = 'https://github.com/tired-labs/techniques/blob/main/docs/CONTRIBUTING.md';
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', 'Contribute to the TRR library');
  const icon = document.createElement('i');
  icon.className = 'ti ti-git-pull-request';
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = 'Contribute';
  a.append(icon, label);
  document.body.append(a);
}
