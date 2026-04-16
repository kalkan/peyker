/**
 * Pass Tracker — clean, dedicated satellite pass monitoring page.
 *
 * Features:
 *  - Satellite selector (shared state from main app via localStorage)
 *  - Large countdown timer to next pass
 *  - Hero view with AOS / TCA / LOS, max elevation, azimuth arc
 *  - Full pass list on the right, click to view any pass
 *  - Auto-refresh every minute
 */

import './styles/pass-tracker.css';

import { fetchTLE } from './sat/fetch.js';
import { parseTLE, predictPasses } from './sat/propagate.js';
import { PRESETS, DEFAULT_GROUND_STATIONS, TRACK_COLORS } from './sat/presets.js';

/* ───── State ───── */

const STORAGE_KEY = 'sat-groundtrack-state';
const ANALYSIS_DAYS = 30;

let satellites = [];   // { noradId, name, color, satrec }
let groundStation = null;
let selectedSatIdx = 0;
let passes = [];
let viewedIdx = -1;    // -1 = auto next
let countdownTimer = null;
let refreshTimer = null;

// Sound notifications
const SOUND_KEY = 'pt-sound-enabled';
const CHIME_WINDOW_MS = 60_000;  // fire within 1 min of AOS/LOS (survives tab throttling)
const KEY_TTL_MS = 24 * 60 * 60 * 1000;  // drop notified keys older than 1 day

let soundEnabled = true;
let audioCtx = null;
let notifiedAosKeys = new Map();  // key → los timestamp (for cleanup)
let notifiedLosKeys = new Map();

function passKey(p) { return p.aos.getTime() + ':' + p.los.getTime(); }

function cleanupNotifiedKeys() {
  const cutoff = Date.now() - KEY_TTL_MS;
  for (const [k, losMs] of notifiedAosKeys) if (losMs < cutoff) notifiedAosKeys.delete(k);
  for (const [k, losMs] of notifiedLosKeys) if (losMs < cutoff) notifiedLosKeys.delete(k);
}

function ensureAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

/**
 * Play a sequence of beeps/pauses. Uses square wave for harsh, attention-grabbing
 * alarm quality. Each step is either { f, d } (freq Hz, duration ms) or { pause }.
 */
function playAlarm(steps, waveType = 'square', vol = 0.38) {
  if (!soundEnabled) return;
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  let t = ctx.currentTime;
  for (const step of steps) {
    if (step.pause != null) { t += step.pause / 1000; continue; }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = waveType;
    osc.frequency.value = step.f;
    // Tight attack/release for crisp alarm beeps
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.005);
    gain.gain.linearRampToValueAtTime(vol, t + step.d / 1000 - 0.012);
    gain.gain.linearRampToValueAtTime(0, t + step.d / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + step.d / 1000 + 0.02);
    t += step.d / 1000;
  }
}

// AOS — urgent rising alarm: 3 staccato beeps + sustained high tone, repeated ×2
// then final long sustain. Square-wave klaxon-style. ~5s total.
function playAosChime() {
  playAlarm([
    { f: 1000, d: 180 }, { pause: 50 },
    { f: 1200, d: 180 }, { pause: 50 },
    { f: 1400, d: 180 }, { pause: 280 },
    { f: 1600, d: 700 }, { pause: 380 },
    { f: 1000, d: 180 }, { pause: 50 },
    { f: 1200, d: 180 }, { pause: 50 },
    { f: 1400, d: 180 }, { pause: 280 },
    { f: 1600, d: 950 },
  ]);
}

// LOS — descending alarm: 3 falling staccato beeps + sustained low tone, repeated ×2
// then final long sustain. ~5s total.
function playLosChime() {
  playAlarm([
    { f: 1600, d: 180 }, { pause: 50 },
    { f: 1200, d: 180 }, { pause: 50 },
    { f: 800,  d: 180 }, { pause: 280 },
    { f: 600,  d: 700 }, { pause: 380 },
    { f: 1600, d: 180 }, { pause: 50 },
    { f: 1200, d: 180 }, { pause: 50 },
    { f: 800,  d: 180 }, { pause: 280 },
    { f: 600,  d: 950 },
  ]);
}

// Short test beep when user turns sound on
function playTestBeep() {
  playAlarm([
    { f: 1400, d: 120 }, { pause: 60 },
    { f: 1600, d: 180 },
  ]);
}

function checkPassTransitions() {
  if (!passes.length) return;
  const now = Date.now();

  for (const p of passes) {
    const k = passKey(p);
    const aosMs = p.aos.getTime();
    const losMs = p.los.getTime();

    // AOS: within last CHIME_WINDOW_MS and not already notified
    if (aosMs <= now && aosMs > now - CHIME_WINDOW_MS && !notifiedAosKeys.has(k)) {
      notifiedAosKeys.set(k, losMs);
      playAosChime();
    }

    // LOS: within last CHIME_WINDOW_MS and not already notified
    if (losMs <= now && losMs > now - CHIME_WINDOW_MS && !notifiedLosKeys.has(k)) {
      notifiedLosKeys.set(k, losMs);
      playLosChime();
    }
  }

  cleanupNotifiedKeys();
}

/* ───── Bootstrap ───── */

function init() {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    if (v !== null) soundEnabled = v === '1';
  } catch {}

  loadFromMainApp();
  buildUI();
  if (satellites.length > 0) loadTLEAndCompute();

  // Re-compute every 60s
  refreshTimer = setInterval(() => {
    if (satellites[selectedSatIdx]?.satrec) computePasses();
  }, 60000);

  // Check AOS/LOS transitions every second (runs always, even if hero not showing pass)
  setInterval(checkPassTransitions, 1000);
}

function loadFromMainApp() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (Array.isArray(s.groundStations) && s.groundStations.length > 0) {
      const idx = typeof s.activeGsIndex === 'number' ? Math.min(s.activeGsIndex, s.groundStations.length - 1) : 0;
      groundStation = s.groundStations[idx];
    }
    if (Array.isArray(s.satellites)) {
      satellites = s.satellites.map((sat, i) => ({
        noradId: sat.noradId,
        name: sat.name || `SAT-${sat.noradId}`,
        color: sat.color || TRACK_COLORS[i % TRACK_COLORS.length],
        satrec: null,
      }));
    }
  } catch { /* ignore */ }

  if (!groundStation) groundStation = DEFAULT_GROUND_STATIONS[0];
  if (satellites.length === 0) {
    satellites = PRESETS.map((p, i) => ({
      noradId: p.noradId, name: p.name,
      color: TRACK_COLORS[i % TRACK_COLORS.length], satrec: null,
    }));
  }
}

async function loadTLEAndCompute() {
  const sat = satellites[selectedSatIdx];
  if (!sat) return;
  if (!sat.satrec) {
    try {
      const tle = await fetchTLE(sat.noradId);
      sat.satrec = parseTLE(tle.line1, tle.line2);
      sat.name = tle.name;
    } catch (err) {
      console.error('TLE fetch failed:', err);
      return;
    }
  }
  computePasses();
}

function computePasses() {
  const sat = satellites[selectedSatIdx];
  if (!sat?.satrec || !groundStation) { passes = []; renderAll(); return; }

  const prevPasses = passes;
  const prevViewed = viewedIdx;
  const prevKey = (prevViewed >= 0 && prevPasses[prevViewed]) ? passKey(prevPasses[prevViewed]) : null;

  passes = predictPasses(sat.satrec, groundStation, ANALYSIS_DAYS);

  // Suppress chimes for transitions that happened before we had the pass list
  // (prevents spurious chime on page load during a running pass)
  const now = Date.now();
  for (const p of passes) {
    const k = passKey(p);
    const losMs = p.los.getTime();
    if (p.aos.getTime() <= now && !notifiedAosKeys.has(k)) notifiedAosKeys.set(k, losMs);
    if (p.los.getTime() <= now && !notifiedLosKeys.has(k)) notifiedLosKeys.set(k, losMs);
  }

  // Preserve the user's selected pass across auto-refreshes
  if (prevKey) {
    const newIdx = passes.findIndex(p => passKey(p) === prevKey);
    viewedIdx = newIdx >= 0 ? newIdx : -1;
  } else {
    viewedIdx = -1;
  }

  renderAll();
}

/* ───── UI ───── */

function buildUI() {
  const app = document.getElementById('pass-tracker-app');
  app.innerHTML = '';

  // Top bar
  const top = el('div', 'pt-topbar');

  const back = el('a', 'pt-back');
  back.href = './index.html';
  back.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg> Ana Sayfa`;
  top.append(back);

  const title = el('span', 'pt-title');
  title.textContent = 'Gecis Takip';
  top.append(title);

  // Satellite selector
  const sel = el('select', 'pt-sat-select');
  sel.id = 'pt-sat-select';
  for (let i = 0; i < satellites.length; i++) {
    const opt = el('option');
    opt.value = i;
    opt.textContent = `${satellites[i].name} (#${satellites[i].noradId})`;
    if (i === selectedSatIdx) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener('change', () => {
    selectedSatIdx = parseInt(sel.value, 10);
    passes = [];
    viewedIdx = -1;
    renderAll();
    loadTLEAndCompute();
  });
  top.append(sel);

  // Add satellite by NORAD ID
  const addWrap = el('div');
  addWrap.style.cssText = 'display:flex;gap:4px;';
  const addIn = el('input', 'pt-sat-select');
  addIn.type = 'text'; addIn.placeholder = 'NORAD ID ekle'; addIn.style.minWidth = '120px';
  const addBtn = el('button', 'pt-back');
  addBtn.textContent = 'Ekle';
  addBtn.style.cursor = 'pointer';
  const flashInput = (msg, ok = false) => {
    addIn.style.borderColor = ok ? 'var(--pt-green)' : 'var(--pt-red)';
    addIn.placeholder = msg;
    addIn.value = '';
    setTimeout(() => {
      addIn.style.borderColor = '';
      addIn.placeholder = 'NORAD ID ekle';
    }, 1800);
  };
  addBtn.addEventListener('click', async () => {
    const val = addIn.value.trim();
    if (!val) return;
    const id = parseInt(val, 10);
    if (isNaN(id) || id <= 0) { flashInput('Gecersiz ID'); return; }
    const existingIdx = satellites.findIndex(s => s.noradId === id);
    if (existingIdx >= 0) {
      // Already added — just switch to it
      sel.value = existingIdx;
      selectedSatIdx = existingIdx;
      flashInput('Zaten eklenmis', true);
      loadTLEAndCompute();
      return;
    }
    const newSat = { noradId: id, name: `SAT-${id}`, color: TRACK_COLORS[satellites.length % TRACK_COLORS.length], satrec: null };
    satellites.push(newSat);
    const opt = el('option');
    opt.value = satellites.length - 1;
    opt.textContent = `${newSat.name} (#${id})`;
    sel.append(opt);
    sel.value = satellites.length - 1;
    selectedSatIdx = satellites.length - 1;
    addIn.value = '';
    loadTLEAndCompute();
  });
  // Enter key submits
  addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });
  addWrap.append(addIn, addBtn);
  top.append(addWrap);

  // Sound toggle
  const soundBtn = el('button', 'pt-back');
  soundBtn.id = 'pt-sound-btn';
  soundBtn.style.cursor = 'pointer';
  const renderSoundBtn = () => {
    soundBtn.innerHTML = soundEnabled
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M19 5a9 9 0 010 14"/></svg> Ses Acik'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg> Ses Kapali';
    soundBtn.style.color = soundEnabled ? 'var(--pt-green)' : 'var(--pt-dim)';
    soundBtn.style.borderColor = soundEnabled ? 'rgba(63,185,80,0.4)' : 'var(--pt-border)';
  };
  renderSoundBtn();
  soundBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    try { localStorage.setItem(SOUND_KEY, soundEnabled ? '1' : '0'); } catch {}
    if (soundEnabled) {
      // First click enables audio ctx + test chime
      ensureAudioCtx();
      playTestBeep();
    }
    renderSoundBtn();
  });
  top.append(soundBtn);

  // GS label
  const gsLabel = el('span', 'pt-gs-label');
  gsLabel.innerHTML = `GS: <strong>${esc(groundStation.name)}</strong> (${groundStation.lat.toFixed(2)}°, ${groundStation.lon.toFixed(2)}°)`;
  top.append(gsLabel);

  app.append(top);

  // Main content
  const main = el('div', 'pt-main');
  main.innerHTML = '<div class="pt-hero" id="pt-hero"></div><div class="pt-list-panel"><div class="pt-list-header" id="pt-list-header"></div><div class="pt-list-scroll" id="pt-list-scroll"></div></div>';
  app.append(main);

  renderAll();
}

function renderAll() {
  renderHero();
  renderList();
}

/* ───── Hero panel ───── */

function renderHero() {
  const hero = document.getElementById('pt-hero');
  if (!hero) return;
  hero.innerHTML = '';

  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

  if (passes.length === 0) {
    hero.innerHTML = `<div class="pt-empty">Uydu secin — gecisler hesaplanacak</div>`;
    return;
  }

  const now = Date.now();
  const nextIdx = passes.findIndex(p => p.los.getTime() > now);
  const idx = viewedIdx === -1 ? (nextIdx >= 0 ? nextIdx : 0) : Math.min(viewedIdx, passes.length - 1);
  const pass = passes[idx];

  const isActive = pass.aos.getTime() <= now && pass.los.getTime() > now;
  const isPast = pass.los.getTime() <= now;

  // Status badge
  const badge = el('div', 'pt-status-badge ' + (isActive ? 'active' : isPast ? 'past' : 'waiting'));
  badge.textContent = isActive ? 'Aktif Gecis' : isPast ? 'Tamamlandi' : 'Yaklasan Gecis';
  hero.append(badge);

  // Countdown
  const cdVal = el('div', 'pt-countdown');
  cdVal.id = 'pt-cd-value';
  const cdLabel = el('div', 'pt-countdown-label');

  if (isActive) {
    cdVal.textContent = fmtCountdown(pass.los.getTime() - now);
    cdLabel.textContent = 'Gecis bitisine kalan';
    cdVal.style.color = '#3fb950';
  } else if (!isPast) {
    cdVal.textContent = fmtCountdown(pass.aos.getTime() - now);
    cdLabel.textContent = 'Gecise kalan sure';
  } else {
    cdVal.textContent = fmtDate(pass.aos);
    cdLabel.textContent = 'Gecis tarihi';
  }
  hero.append(cdVal, cdLabel);

  // Live ticker
  if (!isPast) {
    const targetMs = isActive ? pass.los.getTime() : pass.aos.getTime();
    countdownTimer = setInterval(() => {
      const rem = targetMs - Date.now();
      if (rem <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        renderAll(); // re-render to switch state
        return;
      }
      const cdEl = document.getElementById('pt-cd-value');
      if (cdEl) cdEl.textContent = fmtCountdown(rem);
    }, 1000);
  }

  // Arc SVG
  hero.append(buildArc(pass, isActive));

  // Details row: max el, duration, range
  const details = el('div', 'pt-pass-details');
  const durSec = (pass.los - pass.aos) / 1000;
  const durM = Math.floor(durSec / 60);
  const durS = Math.floor(durSec % 60);

  details.innerHTML = `
    <div class="pt-detail"><div class="pt-detail-value ${pass.maxEl >= 30 ? 'green' : 'accent'}">${pass.maxEl.toFixed(1)}°</div><div class="pt-detail-label">Max Elevasyon</div></div>
    <div class="pt-detail"><div class="pt-detail-value">${durM}m ${durS}s</div><div class="pt-detail-label">Sure</div></div>
    <div class="pt-detail"><div class="pt-detail-value gold">${azToCompass(pass.azAos)}→${azToCompass(pass.azLos)}</div><div class="pt-detail-label">Yon</div></div>
  `;
  hero.append(details);

  // AOS / TCA / LOS times
  const times = el('div', 'pt-times-row');
  times.innerHTML = `
    <div class="pt-time-block"><div class="pt-time-label">AOS</div><div class="pt-time-value">${fmtTime(pass.aos)}</div><div class="pt-time-az">${fmtAz(pass.azAos)}</div></div>
    <div class="pt-time-block"><div class="pt-time-label">TCA</div><div class="pt-time-value">${fmtTime(pass.tca)}</div><div class="pt-time-az">${fmtAz(pass.azTca)}</div></div>
    <div class="pt-time-block"><div class="pt-time-label">LOS</div><div class="pt-time-value">${fmtTime(pass.los)}</div><div class="pt-time-az">${fmtAz(pass.azLos)}</div></div>
  `;
  hero.append(times);

  // Pass navigation
  const nav = el('div');
  nav.style.cssText = 'display:flex;gap:10px;margin-top:20px;align-items:center;';

  const prevBtn = el('button', 'pt-back');
  prevBtn.textContent = '◀ Onceki';
  prevBtn.style.cursor = 'pointer';
  prevBtn.disabled = idx <= 0;
  prevBtn.addEventListener('click', () => { viewedIdx = idx - 1; renderAll(); });

  const counter = el('span');
  counter.style.cssText = 'font-size:13px;color:var(--pt-dim);font-family:monospace;';
  counter.textContent = `${idx + 1} / ${passes.length}`;

  const nextBtn = el('button', 'pt-back');
  nextBtn.textContent = 'Sonraki ▶';
  nextBtn.style.cursor = 'pointer';
  nextBtn.disabled = idx >= passes.length - 1;
  nextBtn.addEventListener('click', () => { viewedIdx = idx + 1; renderAll(); });

  const homeBtn = el('button', 'pt-back');
  homeBtn.textContent = 'Siradaki';
  homeBtn.style.cssText = 'cursor:pointer;color:var(--pt-accent);border-color:var(--pt-accent);';
  homeBtn.addEventListener('click', () => { viewedIdx = -1; renderAll(); });

  nav.append(prevBtn, counter, homeBtn, nextBtn);
  hero.append(nav);
}

function buildArc(pass, isActive) {
  // viewBox 408x144 matches CSS .pt-arc-svg size (no fractional scaling)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pt-arc-svg');
  svg.setAttribute('viewBox', '0 0 408 144');

  // Vertical positions
  const baseY = 122;
  const arcTopY = Math.max(12, baseY - pass.maxEl * 1.2);
  const color = isActive ? '#3fb950' : '#58a6ff';

  svg.innerHTML = `
    <defs>
      <linearGradient id="ag" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.1"/>
        <stop offset="50%" stop-color="${color}" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.1"/>
      </linearGradient>
    </defs>
    <line x1="0" y1="${baseY}" x2="408" y2="${baseY}" stroke="#30363d" stroke-width="1"/>
    <path d="M20 ${baseY} Q204 ${arcTopY} 388 ${baseY}" fill="none" stroke="url(#ag)" stroke-width="3" ${isActive ? '' : 'stroke-dasharray="7 5"'}/>
    <circle cx="20" cy="${baseY}" r="4" fill="#5c6980"/>
    <circle cx="388" cy="${baseY}" r="4" fill="#5c6980"/>
    <circle cx="204" cy="${arcTopY}" r="7" fill="${color}" opacity="0.9">${isActive ? '<animate attributeName="opacity" values="0.9;0.3;0.9" dur="2s" repeatCount="indefinite"/>' : ''}</circle>
    <text x="20" y="140" font-size="13" fill="#5c6980" font-family="sans-serif" text-anchor="middle">AOS</text>
    <text x="204" y="${arcTopY - 14}" font-size="15" fill="${color}" font-family="monospace" font-weight="700" text-anchor="middle">${pass.maxEl.toFixed(1)}°</text>
    <text x="388" y="140" font-size="13" fill="#5c6980" font-family="sans-serif" text-anchor="middle">LOS</text>
    <g transform="translate(196,${baseY})">
      <line x1="8" y1="0" x2="8" y2="-13" stroke="#5c6980" stroke-width="1.4"/>
      <circle cx="8" cy="-13" r="4.5" fill="none" stroke="#5c6980" stroke-width="1.2"/>
      <line x1="1" y1="-8" x2="-4" y2="-3" stroke="#5c6980" stroke-width="1"/>
      <line x1="15" y1="-8" x2="20" y2="-3" stroke="#5c6980" stroke-width="1"/>
    </g>
  `;
  return svg;
}

/* ───── Pass list ───── */

function renderList() {
  const header = document.getElementById('pt-list-header');
  const scroll = document.getElementById('pt-list-scroll');
  if (!header || !scroll) return;

  const sat = satellites[selectedSatIdx];
  header.textContent = sat ? `${sat.name} — ${passes.length} gecis (${ANALYSIS_DAYS} gun)` : 'Uydu seciniz';
  scroll.innerHTML = '';

  if (passes.length === 0) {
    scroll.innerHTML = '<div class="pt-empty">Gecis bulunamadi</div>';
    return;
  }

  const now = Date.now();
  const nextIdx = passes.findIndex(p => p.los.getTime() > now);
  const currentView = viewedIdx === -1 ? (nextIdx >= 0 ? nextIdx : 0) : Math.min(viewedIdx, passes.length - 1);

  // Group by day
  const groups = new Map();
  for (const p of passes) {
    const key = fmtDate(p.aos);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  for (const [day, dayPasses] of groups) {
    const dh = el('div', 'pt-day-header');
    dh.textContent = day;
    scroll.append(dh);

    for (const p of dayPasses) {
      const i = passes.indexOf(p);
      const isAct = p.aos.getTime() <= now && p.los.getTime() > now;
      const isPast = p.los.getTime() <= now;

      const row = el('div', 'pt-pass-row');
      if (i === currentView) row.classList.add('selected');
      if (isPast) row.classList.add('past');
      if (isAct) row.classList.add('active-pass');

      const durSec = (p.los - p.aos) / 1000;
      const dm = Math.floor(durSec / 60);
      const ds = Math.floor(durSec % 60);

      const elCls = p.maxEl >= 60 ? 'pt-el-high' : p.maxEl >= 30 ? 'pt-el-mid' : p.maxEl >= 10 ? 'pt-el-low' : 'pt-el-vlow';

      row.innerHTML = `
        <span class="pt-pass-cell">${fmtTime(p.aos)}</span>
        <span class="pt-pass-cell">${fmtTime(p.los)}</span>
        <span class="pt-pass-cell">${dm}m${ds > 0 ? ds + 's' : ''}</span>
        <span class="pt-el-badge ${elCls}">${p.maxEl.toFixed(1)}°</span>
        <span class="pt-az-cell">${fmtAzShort(p.azAos)}→${fmtAzShort(p.azLos)}</span>
      `;

      row.addEventListener('click', () => {
        viewedIdx = i;
        renderAll();
      });

      scroll.append(row);
    }
  }

  // Scroll selected into view only if not currently visible
  requestAnimationFrame(() => {
    const sel = scroll.querySelector('.selected');
    if (!sel) return;
    const sRect = scroll.getBoundingClientRect();
    const rRect = sel.getBoundingClientRect();
    const isVisible = rRect.top >= sRect.top && rRect.bottom <= sRect.bottom;
    if (!isVisible) sel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

/* ───── Helpers ───── */

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const t = Math.floor(ms / 1000);
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = n => String(n).padStart(2, '0');
  return d > 0 ? `${d}g ${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}:${p(s)}`;
}

function fmtTime(d) {
  return d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function fmtDate(d) {
  return d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function azToCompass(az) {
  if (az == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(az / 22.5) % 16];
}

function fmtAz(az) {
  if (az == null) return '';
  return `AZ ${az.toFixed(0)}° ${azToCompass(az)}`;
}

function fmtAzShort(az) {
  if (az == null) return '?';
  return `${az.toFixed(0)}°`;
}

/* ───── Start ───── */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
