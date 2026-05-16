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

function initLastSyncedClock() {
  const t = document.getElementById('header-last-sync');
  if (!t) return;
  const start = Date.now();
  const tick = () => {
    const mins = Math.floor((Date.now() - start) / 60000);
    t.textContent = mins === 0 ? 'sources synced just now'
                                : `sources synced ${mins}m ago`;
  };
  tick();
  setInterval(tick, 30000);
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initLastSyncedClock();
  initLibraryOnlyMode();
  injectContributeButton();
});

// Detect library-only mode (no PCR source configured) and tag the body
// so CSS can hide the Dashboard nav link.
async function initLibraryOnlyMode() {
  try {
    const r = await fetch('sources.json', { cache: 'no-cache' });
    const sources = await r.json();
    const hasPcr = Array.isArray(sources) && sources.some(s => s && s.Type === 'PCR');
    if (!hasPcr) {
      document.body.classList.add('library-only');
    }
  } catch (_) { /* ignore — let pages render their own errors */ }
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
  a.innerHTML = '<i class="ti ti-git-pull-request" aria-hidden="true"></i><span>Contribute</span>';
  document.body.append(a);
}
