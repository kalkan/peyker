/**
 * Imaging Hub — Tabbed wrapper for 2D / 3D / GAG imaging tools.
 *
 * Each tool runs in its own iframe. Tabs lazy-load on first click and
 * stay mounted afterwards so user state (satellites, target, opportunities)
 * is preserved when switching tabs.
 */

import './styles/hub.css';

const TABS = [
  {
    id: '2d',
    label: '2D Planlayıcı',
    src: './imaging-planner.html',
    devSrc: './imaging-planner-src.html',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="13" r="4"/><line x1="12" y1="3" x2="12" y2="7"/></svg>`,
  },
  {
    id: '3d',
    label: '3D Planlayıcı',
    badge: 'Beta',
    src: './imaging-planner-3d.html',
    devSrc: './imaging-planner-3d-src.html',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  },
  {
    id: 'gag',
    label: 'Geniş Alan (GAG)',
    badge: 'Beta',
    src: './gag.html',
    devSrc: './gag-src.html',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>`,
  },
];

const mountedFrames = new Map(); // tab.id → HTMLIFrameElement
let activeTabId = null;

function init() {
  const app = document.getElementById('imaging-hub');
  if (!app) return;

  app.innerHTML = `
    <div class="hub-tabbar">
      <div class="hub-title">
        <span class="hub-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="13" r="4"/><line x1="12" y1="3" x2="12" y2="7"/>
          </svg>
        </span>
        Görüntüleme
      </div>
      <div class="hub-tabs" id="hub-tabs"></div>
      <a href="./index.html" class="hub-home" title="Ana Sayfa">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        Ana
      </a>
    </div>
    <div class="hub-stage" id="hub-stage">
      <div class="hub-loading">Yükleniyor…</div>
    </div>
  `;

  const tabsEl = document.getElementById('hub-tabs');
  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.className = 'hub-tab';
    btn.dataset.tabId = tab.id;
    btn.innerHTML = `
      ${tab.icon}
      <span>${tab.label}</span>
      ${tab.badge ? `<span class="hub-tab-badge">${tab.badge}</span>` : ''}
    `;
    btn.addEventListener('click', () => activateTab(tab.id));
    tabsEl.append(btn);
  }

  // Read initial tab from URL hash or default to first
  const hashTab = (window.location.hash || '').replace('#', '');
  const initialTab = TABS.find(t => t.id === hashTab) ? hashTab : TABS[0].id;
  activateTab(initialTab);

  window.addEventListener('hashchange', () => {
    const h = (window.location.hash || '').replace('#', '');
    if (TABS.find(t => t.id === h) && h !== activeTabId) activateTab(h);
  });
}

function activateTab(tabId) {
  const tab = TABS.find(t => t.id === tabId);
  if (!tab) return;
  activeTabId = tabId;

  // Update tab UI
  document.querySelectorAll('.hub-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tabId === tabId);
  });

  // Update URL hash without reloading
  if (window.location.hash !== `#${tabId}`) {
    history.replaceState(null, '', `#${tabId}`);
  }

  // Hide all frames
  const stage = document.getElementById('hub-stage');
  stage.querySelector('.hub-loading')?.remove();
  for (const frame of mountedFrames.values()) {
    frame.classList.add('hidden');
  }

  // Mount or reveal frame
  let frame = mountedFrames.get(tabId);
  if (!frame) {
    frame = document.createElement('iframe');
    frame.className = 'hub-frame';
    frame.src = pickSrc(tab);
    frame.title = tab.label;
    stage.append(frame);
    mountedFrames.set(tabId, frame);
  } else {
    frame.classList.remove('hidden');
  }
}

/** Pick the right URL depending on whether we're in dev or prod. */
function pickSrc(tab) {
  const here = window.location.pathname;
  // In dev mode, pages are served as *-src.html
  const inDev = here.endsWith('-src.html') || here.includes('/src/');
  return inDev ? tab.devSrc : tab.src;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
