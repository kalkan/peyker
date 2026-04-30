/**
 * Stations Hub — Tabbed wrapper for GS + Antenna tools.
 */

import './styles/hub.css';

const TABS = [
  {
    id: 'gs',
    label: 'GS Planlayıcı',
    src: './gs-planner.html',
    devSrc: './gs-planner-src.html',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>`,
  },
  {
    id: 'antenna',
    label: 'Anten Takip',
    src: './antenna.html',
    devSrc: './antenna-src.html',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>`,
  },
];

const mountedFrames = new Map();
let activeTabId = null;

function init() {
  const app = document.getElementById('stations-hub');
  if (!app) return;

  app.innerHTML = `
    <div class="hub-tabbar">
      <div class="hub-title">
        <span class="hub-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>
          </svg>
        </span>
        İstasyonlar
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
    `;
    btn.addEventListener('click', () => activateTab(tab.id));
    tabsEl.append(btn);
  }

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

  document.querySelectorAll('.hub-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tabId === tabId);
  });

  if (window.location.hash !== `#${tabId}`) {
    history.replaceState(null, '', `#${tabId}`);
  }

  const stage = document.getElementById('hub-stage');
  stage.querySelector('.hub-loading')?.remove();
  for (const frame of mountedFrames.values()) {
    frame.classList.add('hidden');
  }

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

function pickSrc(tab) {
  const here = window.location.pathname;
  const inDev = here.endsWith('-src.html') || here.includes('/src/');
  return inDev ? tab.devSrc : tab.src;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
