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

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initSourceSummary();
  injectContributeButton();
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
function injectContributeButton() {
  if (document.getElementById('contribute-fab')) return;
  const a = document.createElement('a');
  a.id = 'contribute-fab';
  a.href = 'https://github.com/tired-labs/library';
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
