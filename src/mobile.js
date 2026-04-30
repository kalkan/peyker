/**
 * Mobile Pass Tracker — standalone mobile-friendly page.
 * Reads satellite list from shared localStorage state,
 * fetches TLEs, and shows pass predictions + overlap analysis.
 */

import './styles/mobile.css';
import { fetchTLE } from './sat/fetch.js';
import { parseTLE, predictPasses } from './sat/propagate.js';
import { GROUND_STATIONS, PRESETS } from './sat/presets.js';

const STORAGE_KEY = 'sat-groundtrack-state';
const gs = GROUND_STATIONS[0];

// App state
let satellites = [];
let selectedSatId = null;
let viewedPassIndex = -1;
let countdownTimer = null;

// ===== Init =====

function init() {
  loadSatellites();
  buildUI();
  restoreTLEs();
}

function loadSatellites() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed.satellites)) {
      satellites = parsed.satellites.map(s => ({
        noradId: s.noradId,
        name: s.name,
        color: s.color,
        visible: s.visible !== false,
        satrec: null,
        passes: null,
      }));
      selectedSatId = parsed.satellites.length > 0 ? parsed.satellites[0].noradId : null;
    }
  } catch { /* ignore */ }
}

async function restoreTLEs() {
  const statusEl = document.getElementById('m-status');
  for (const sat of satellites) {
    try {
      if (statusEl) statusEl.textContent = `${sat.name} TLE yükleniyor...`;
      const tle = await fetchTLE(sat.noradId);
      sat.satrec = parseTLE(tle.line1, tle.line2);
      sat.name = tle.name;
      sat.passes = predictPasses(sat.satrec, gs, 7);
    } catch {
      if (statusEl) statusEl.textContent = `${sat.name} TLE yüklenemedi`;
    }
  }
  if (statusEl) statusEl.textContent = '';
  renderContent();
}

// ===== UI Build =====

function buildUI() {
  const app = document.getElementById('mobile-app');
  app.innerHTML = `
    <header class="m-header">
      <div class="m-header-top">
        <h1>Pass Tracker</h1>
        <a href="./index.html" class="m-back-link">Harita</a>
      </div>
      <div class="m-gs-info">${gs.name} (${gs.lat.toFixed(2)}°N, ${gs.lon.toFixed(2)}°E)</div>
      <div id="m-status" class="m-status"></div>
    </header>
    <nav class="m-sat-tabs" id="m-sat-tabs"></nav>
    <main class="m-main" id="m-main">
      <div class="m-loading">Uydu verileri yükleniyor...</div>
    </main>
  `;

  renderSatTabs();
}

function renderSatTabs() {
  const tabsEl = document.getElementById('m-sat-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = '';

  // "All" tab for overlaps
  if (satellites.length >= 2) {
    const allTab = document.createElement('button');
    allTab.className = 'm-tab' + (selectedSatId === 'overlaps' ? ' active' : '');
    allTab.textContent = 'Çakışmalar';
    allTab.style.borderColor = '#f0883e';
    allTab.addEventListener('click', () => {
      selectedSatId = 'overlaps';
      viewedPassIndex = -1;
      renderSatTabs();
      renderContent();
    });
    tabsEl.append(allTab);
  }

  for (const sat of satellites) {
    const tab = document.createElement('button');
    tab.className = 'm-tab' + (selectedSatId === sat.noradId ? ' active' : '');
    tab.textContent = sat.name;
    tab.style.borderColor = sat.color;
    tab.addEventListener('click', () => {
      selectedSatId = sat.noradId;
      viewedPassIndex = -1;
      renderSatTabs();
      renderContent();
    });
    tabsEl.append(tab);
  }
}

function renderContent() {
  const main = document.getElementById('m-main');
  if (!main) return;
  main.innerHTML = '';

  if (selectedSatId === 'overlaps') {
    renderOverlaps(main);
    return;
  }

  const sat = satellites.find(s => s.noradId === selectedSatId);
  if (!sat) {
    main.innerHTML = '<div class="m-empty">Uydu seçin</div>';
    return;
  }
  if (!sat.satrec) {
    main.innerHTML = '<div class="m-loading">TLE yükleniyor...</div>';
    return;
  }

  renderPassesForSat(main, sat);
}

// ===== Pass Rendering =====

function renderPassesForSat(container, sat) {
  const passes = sat.passes;
  if (!passes || passes.length === 0) {
    container.innerHTML = '<div class="m-empty">7 gün içinde geçiş yok</div>';
    return;
  }

  const now = Date.now();
  const nextUpIdx = passes.findIndex(p => p.los.getTime() > now);

  let currentIdx;
  if (viewedPassIndex === -1) {
    currentIdx = nextUpIdx >= 0 ? nextUpIdx : 0;
  } else {
    currentIdx = Math.max(0, Math.min(viewedPassIndex, passes.length - 1));
  }

  const pass = passes[currentIdx];

  // Card
  const cardWrap = document.createElement('div');
  renderPassCard(cardWrap, pass, passes, currentIdx, nextUpIdx, now);
  container.append(cardWrap);

  // Pass list
  const listTitle = document.createElement('div');
  listTitle.className = 'm-section-title';
  listTitle.textContent = 'Tüm Geçişler';
  container.append(listTitle);

  const grouped = groupByDay(passes);
  for (const [dayLabel, dayPasses] of grouped) {
    const dayH = document.createElement('div');
    dayH.className = 'm-day-header';
    dayH.textContent = dayLabel;
    container.append(dayH);

    for (const p of dayPasses) {
      const pIdx = passes.indexOf(p);
      const row = document.createElement('div');
      const isPast = p.los.getTime() < now;
      row.className = 'm-pass-row' + (pIdx === currentIdx ? ' active' : '') + (isPast ? ' past' : '');

      const elClass = getElClass(p.maxEl);
      row.innerHTML = `
        <div class="m-pass-row-times">
          <span class="m-pass-row-time">${fmtTime(p.aos)}</span>
          <span class="m-pass-row-sep">→</span>
          <span class="m-pass-row-time">${fmtTime(p.los)}</span>
        </div>
        <div class="m-pass-row-meta">
          <span class="m-pass-row-dur">${fmtDuration(p)}</span>
          <span class="m-el-badge ${elClass}">${p.maxEl.toFixed(1)}°</span>
        </div>
      `;
      row.addEventListener('click', () => {
        viewedPassIndex = pIdx;
        renderContent();
      });
      container.append(row);
    }
  }

  const note = document.createElement('div');
  note.className = 'm-note';
  note.textContent = `${passes.length} geçiş — TR saati (UTC+3)`;
  container.append(note);
}

function renderPassCard(wrapper, pass, passes, idx, nextUpIdx, now) {
  wrapper.innerHTML = '';
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

  const card = document.createElement('div');
  card.className = 'm-card';

  const isActive = pass.aos.getTime() <= now && pass.los.getTime() > now;
  const isPast = pass.los.getTime() <= now;

  let label, labelMod;
  if (isActive) { label = 'AKTİF GEÇİŞ'; labelMod = 'active'; }
  else if (idx === nextUpIdx) { label = 'SONRAKİ GEÇİŞ'; labelMod = ''; }
  else if (isPast) { label = 'GEÇMİŞ'; labelMod = 'past'; }
  else { label = 'GELECEK GEÇİŞ'; labelMod = ''; }

  // Countdown
  let countdownHtml = '';
  if (isActive) {
    const rem = pass.los.getTime() - now;
    countdownHtml = `
      <div class="m-countdown active">
        <div class="m-countdown-label">Geçiş bitimine kalan</div>
        <div class="m-countdown-value" data-target="${pass.los.getTime()}">${fmtCountdown(rem)}</div>
      </div>`;
  } else if (!isPast) {
    const rem = pass.aos.getTime() - now;
    countdownHtml = `
      <div class="m-countdown">
        <div class="m-countdown-label">Geçişe kalan süre</div>
        <div class="m-countdown-value" data-target="${pass.aos.getTime()}">${fmtCountdown(rem)}</div>
      </div>`;
  }

  const elClass = isActive ? 'el-high' : (pass.maxEl >= 30 ? 'el-mid' : (pass.maxEl >= 10 ? 'el-low' : 'el-vlow'));
  const accentColor = isActive ? '#3fb950' : '#5daaff';
  const arcSvg = buildArcSvg(pass, isActive, accentColor);

  card.innerHTML = `
    ${countdownHtml}
    <div class="m-card-badge ${labelMod}">${label}</div>
    ${arcSvg}
    <div class="m-card-el">
      <span class="m-card-el-val ${elClass}">${pass.maxEl.toFixed(1)}°</span>
      <span class="m-card-el-label">maks. yükseklik</span>
    </div>
    <div class="m-card-times">
      <div class="m-card-time-row"><span class="m-card-time-label">AOS</span><span>${fmtTime(pass.aos)}</span><span class="m-card-time-date">${fmtDate(pass.aos)}</span></div>
      <div class="m-card-time-row"><span class="m-card-time-label">TCA</span><span>${fmtTime(pass.tca)}</span><span class="m-card-time-date">${fmtDuration(pass)}</span></div>
      <div class="m-card-time-row"><span class="m-card-time-label">LOS</span><span>${fmtTime(pass.los)}</span><span class="m-card-time-date">${fmtDate(pass.los)}</span></div>
    </div>
  `;

  wrapper.append(card);

  // Live countdown
  const cdEl = card.querySelector('.m-countdown-value[data-target]');
  if (cdEl) {
    const target = parseInt(cdEl.dataset.target, 10);
    countdownTimer = setInterval(() => {
      const rem = target - Date.now();
      if (rem <= 0) { clearInterval(countdownTimer); countdownTimer = null; cdEl.textContent = '00:00:00'; return; }
      cdEl.textContent = fmtCountdown(rem);
    }, 1000);
  }

  // Nav buttons
  const nav = document.createElement('div');
  nav.className = 'm-nav';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'm-nav-btn';
  prevBtn.textContent = '◀';
  prevBtn.disabled = idx <= 0;
  prevBtn.addEventListener('click', () => { viewedPassIndex = idx - 1; renderContent(); });

  const counter = document.createElement('span');
  counter.className = 'm-nav-counter';
  counter.textContent = `${idx + 1} / ${passes.length}`;

  const homeBtn = document.createElement('button');
  homeBtn.className = 'm-nav-btn m-nav-home';
  homeBtn.textContent = 'Sonraki';
  homeBtn.disabled = nextUpIdx < 0;
  homeBtn.addEventListener('click', () => { viewedPassIndex = -1; renderContent(); });

  const nextBtn = document.createElement('button');
  nextBtn.className = 'm-nav-btn';
  nextBtn.textContent = '▶';
  nextBtn.disabled = idx >= passes.length - 1;
  nextBtn.addEventListener('click', () => { viewedPassIndex = idx + 1; renderContent(); });

  nav.append(prevBtn, counter, homeBtn, nextBtn);
  wrapper.append(nav);
}

// ===== Overlap Rendering =====

function renderOverlaps(container) {
  const satsWithTle = satellites.filter(s => s.satrec && s.passes);

  if (satsWithTle.length < 2) {
    container.innerHTML = '<div class="m-empty">Çakışma analizi için en az 2 uydu gerekli</div>';
    return;
  }

  const allPasses = [];
  for (const sat of satsWithTle) {
    for (const p of sat.passes) {
      allPasses.push({ ...p, sat });
    }
  }

  const overlaps = findOverlaps(allPasses);

  const summary = document.createElement('div');
  summary.className = 'm-section-title';
  summary.textContent = `Çakışma Analizi — ${satsWithTle.map(s => s.name).join(', ')}`;
  container.append(summary);

  if (overlaps.length === 0) {
    container.innerHTML += '<div class="m-empty">7 gün içinde çakışma yok</div>';
    return;
  }

  const now = Date.now();
  const grouped = groupByDay(overlaps);

  for (const [dayLabel, dayOverlaps] of grouped) {
    const dayH = document.createElement('div');
    dayH.className = 'm-day-header';
    dayH.textContent = dayLabel;
    container.append(dayH);

    for (const ov of dayOverlaps) {
      const card = document.createElement('div');
      const isPast = ov.end.getTime() < now;
      card.className = 'm-overlap-card' + (isPast ? ' past' : '');

      const durMin = Math.floor(ov.durationSec / 60);
      const durS = Math.floor(ov.durationSec % 60);
      const durStr = durMin > 0 ? `${durMin}dk ${durS}sn` : `${durS}sn`;

      const elClassA = getElClass(ov.maxElA);
      const elClassB = getElClass(ov.maxElB);

      card.innerHTML = `
        <div class="m-overlap-header">
          <div class="m-overlap-sats">
            <span class="m-overlap-chip" style="background:${ov.satA.color}"></span>
            <span>${ov.satA.name}</span>
            <span class="m-overlap-x">&times;</span>
            <span class="m-overlap-chip" style="background:${ov.satB.color}"></span>
            <span>${ov.satB.name}</span>
          </div>
          <span class="m-overlap-dur">${durStr}</span>
        </div>
        <div class="m-overlap-times">${fmtTime(ov.start)} — ${fmtTime(ov.end)}</div>
        <div class="m-overlap-els">
          <span>${ov.satA.name}: <span class="m-el-badge ${elClassA}">${ov.maxElA.toFixed(1)}°</span></span>
          <span>${ov.satB.name}: <span class="m-el-badge ${elClassB}">${ov.maxElB.toFixed(1)}°</span></span>
        </div>
      `;
      container.append(card);
    }
  }

  const note = document.createElement('div');
  note.className = 'm-note';
  note.textContent = `${overlaps.length} çakışma — TR saati (UTC+3)`;
  container.append(note);
}

function findOverlaps(allPasses) {
  const overlaps = [];
  allPasses.sort((a, b) => a.aos - b.aos);

  for (let i = 0; i < allPasses.length; i++) {
    for (let j = i + 1; j < allPasses.length; j++) {
      const a = allPasses[i];
      const b = allPasses[j];
      if (a.sat.noradId === b.sat.noradId) continue;
      if (b.aos >= a.los) break;

      const overlapStart = b.aos;
      const overlapEnd = new Date(Math.min(a.los.getTime(), b.los.getTime()));
      const overlapSec = (overlapEnd - overlapStart) / 1000;

      if (overlapSec > 0) {
        overlaps.push({
          satA: a.sat, satB: b.sat,
          start: overlapStart, end: overlapEnd,
          durationSec: overlapSec,
          maxElA: a.maxEl, maxElB: b.maxEl,
        });
      }
    }
  }
  overlaps.sort((a, b) => a.start - b.start);
  return overlaps;
}

// ===== Helpers =====

function buildArcSvg(pass, isActive, accentColor) {
  const arcY = Math.max(5, 70 - pass.maxEl);
  const dotY = Math.max(8, 70 - pass.maxEl);
  const satY = Math.max(2, 70 - pass.maxEl - 8);

  return `<svg class="m-arc" viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="m-arc-grad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.1"/>
        <stop offset="50%" stop-color="${accentColor}" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="${accentColor}" stop-opacity="0.1"/>
      </linearGradient>
    </defs>
    <path d="M10 70 Q100 ${arcY} 190 70" fill="none" stroke="url(#m-arc-grad)" stroke-width="2" stroke-dasharray="${isActive ? 'none' : '4 3'}"/>
    <circle cx="10" cy="70" r="2" fill="#5c6980"/>
    <circle cx="190" cy="70" r="2" fill="#5c6980"/>
    ${isActive
      ? `<circle cx="100" cy="${dotY}" r="4" fill="#3fb950" opacity="0.9"><animate attributeName="opacity" values="0.9;0.4;0.9" dur="2s" repeatCount="indefinite"/></circle>`
      : `<circle cx="100" cy="${dotY}" r="3" fill="${accentColor}" opacity="0.7"/>`
    }
    <g transform="translate(95, 70)">
      <line x1="5" y1="0" x2="5" y2="-8" stroke="#98a4b8" stroke-width="1.2"/>
      <circle cx="5" cy="-8" r="3" fill="none" stroke="#98a4b8" stroke-width="1"/>
      <line x1="1" y1="-5" x2="-2" y2="-2" stroke="#98a4b8" stroke-width="0.8"/>
      <line x1="9" y1="-5" x2="12" y2="-2" stroke="#98a4b8" stroke-width="0.8"/>
    </g>
    <g transform="translate(95, ${satY})">
      <rect x="0" y="2" width="10" height="6" rx="1" fill="#98a4b8" opacity="0.7"/>
      <rect x="-6" y="3" width="6" height="4" rx="0.5" fill="${accentColor}" opacity="0.5"/>
      <rect x="10" y="3" width="6" height="4" rx="0.5" fill="${accentColor}" opacity="0.5"/>
    </g>
    <text x="10" y="78" font-size="7" fill="#5c6980" font-family="sans-serif">AOS</text>
    <text x="180" y="78" font-size="7" fill="#5c6980" font-family="sans-serif">LOS</text>
  </svg>`;
}

function fmtCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = n => String(n).padStart(2, '0');
  if (d > 0) return `${d}g ${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function fmtDuration(pass) {
  const sec = (pass.los - pass.aos) / 1000;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}dk ${s}sn`;
}

function fmtTime(date) {
  return date.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function fmtDate(date) {
  return date.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function groupByDay(items) {
  const groups = new Map();
  for (const item of items) {
    const d = item.start || item.aos;
    const key = fmtDate(d);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function getElClass(el) {
  if (el >= 60) return 'el-high';
  if (el >= 30) return 'el-mid';
  if (el >= 10) return 'el-low';
  return 'el-vlow';
}

// ===== Start =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
