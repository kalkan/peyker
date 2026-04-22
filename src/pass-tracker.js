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
import { parseTLE, predictPasses, getLookAnglesCached as getLookAngles, propagateAt } from './sat/propagate.js';
import { sunElevation } from './sat/sun.js';
import { idbGet, idbSet, idbCleanupExpired } from './sat/idb-cache.js';
import { predictPassesInWorker } from './sat/sgp4-worker-client.js';
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
let transitionsTimer = null;
let allSatNextPassTimer = null;
let allSatPillTimer = null;

// Sound notifications
const SOUND_KEY = 'pt-sound-enabled';
const NOTIF_KEY = 'pt-notif-enabled';
const TTS_KEY = 'pt-tts-enabled';
const WAKE_KEY = 'pt-wake-enabled';
const FILTER_KEY = 'pt-filter';  // JSON: { minEl, visibleOnly, sortBy }
const CHART_VIEW_KEY = 'pt-chart-view';  // 'polar' | 'elvt'
const CHIME_WINDOW_MS = 60_000;  // fire within 1 min of AOS/LOS (survives tab throttling)
const KEY_TTL_MS = 24 * 60 * 60 * 1000;  // drop notified keys older than 1 day
const PRE_AOS_WARN_MS = [5 * 60_000, 60_000];  // 5 min and 1 min before AOS

let soundEnabled = true;
let notifEnabled = false;    // browser notifications
let ttsEnabled = false;      // text-to-speech announcements
let wakeEnabled = false;     // screen wake lock
let wakeLockSentinel = null;
let audioCtx = null;
let notifiedAosKeys = new Map();  // key → los timestamp (for cleanup)
let notifiedLosKeys = new Map();
let warnedPreAosKeys = new Set();  // "${key}:${ms}" — pre-AOS warnings already fired
let spokenKeys = new Set();        // same pattern for TTS events
let allSatNextPass = null;         // { satIdx, aos, pass } — soonest pass across all sats

// Filter + sort state for the pass list (default: no filter, chronological)
let filter = { minEl: 0, visibleOnly: false, sortBy: 'time' };  // sortBy: 'time' | 'score'
let chartView = 'polar';  // 'polar' | 'elvt'

function passKey(p) { return p.aos.getTime() + ':' + p.los.getTime(); }

/**
 * IDB cache key for computed passes. Includes TLE epoch so stale TLE
 * invalidates automatically, plus GS identity and ANALYSIS_DAYS.
 */
function passCacheKey(sat, gs) {
  const tleEpoch = sat.satrec ? `${sat.satrec.epochyr}.${sat.satrec.epochdays.toFixed(6)}` : '0';
  return `passes:${sat.noradId}:${tleEpoch}:${gs.lat.toFixed(3)},${gs.lon.toFixed(3)}:${ANALYSIS_DAYS}`;
}

/** Serialize Date fields to ISO strings for JSON/IDB storage. */
function serializePasses(pss) {
  return pss.map(p => ({ ...p, aos: p.aos.toISOString(), los: p.los.toISOString(), tca: p.tca.toISOString() }));
}

/** Parse a cached pass list back into Date objects. */
function deserializePasses(pss) {
  return pss.map(p => ({ ...p, aos: new Date(p.aos), los: new Date(p.los), tca: new Date(p.tca) }));
}

/**
 * Compute a 0–100 quality score for a pass based on max elevation,
 * duration, and optical visibility. Returned as { score, stars } with
 * stars ∈ [0, 5]. Pure function of an enriched pass object.
 */
function computePassScore(pass) {
  const durMin = (pass.los - pass.aos) / 60000;
  const elScore = Math.min(60, (pass.maxEl / 60) * 60);      // 0–60 pts
  const durScore = Math.min(30, (durMin / 10) * 30);         // 0–30 pts (saturates at 10 min)
  const visScore = pass.visible ? 10 : 0;                    // 0–10 pts
  const score = elScore + durScore + visScore;
  // Bucketed into stars (0..5) — 5★ requires ~80+
  const stars = Math.min(5, Math.floor(score / 20 + 0.5));
  return { score, stars };
}

/**
 * Determine whether a pass is optically visible (naked-eye):
 *   1. Observer at GS is in civil darkness (sun < -6°)
 *   2. Satellite is sunlit (not in Earth's shadow)
 *
 * Evaluated at TCA — the moment of max elevation — as a single-point
 * approximation which is sufficient for filtering LEO passes.
 */
function computePassVisibility(satrec, gs, pass) {
  if (!satrec || !gs) return false;
  // Observer darkness at TCA
  const sunAtGs = sunElevation(pass.tca, gs.lat, gs.lon);
  if (sunAtGs >= -6) return false;
  // Satellite sunlit: sun elevation at subsatellite point > -horizonDrop
  const sat = propagateAt(satrec, pass.tca);
  if (!sat) return false;
  const R = 6371;
  const horizonDrop = Math.acos(R / (R + sat.alt)) * 180 / Math.PI;
  const sunAtSat = sunElevation(pass.tca, sat.lat, sat.lon);
  return sunAtSat > -horizonDrop;
}

/**
 * Enrich passes with `visible`, `score`, and `stars` fields in-place.
 */
function enrichPasses(satrec, gs, passList) {
  for (const p of passList) {
    p.visible = computePassVisibility(satrec, gs, p);
    p.sunElev = gs ? sunElevation(p.tca, gs.lat, gs.lon) : null;
    const q = computePassScore(p);
    p.score = q.score;
    p.stars = q.stars;
  }
  return passList;
}

function cleanupNotifiedKeys() {
  const cutoff = Date.now() - KEY_TTL_MS;
  for (const [k, losMs] of notifiedAosKeys) if (losMs < cutoff) notifiedAosKeys.delete(k);
  for (const [k, losMs] of notifiedLosKeys) if (losMs < cutoff) notifiedLosKeys.delete(k);
  // Clean up stale pre-AOS / TTS keys (keys format "aos:los:offset")
  for (const k of warnedPreAosKeys) {
    const losMs = parseInt(k.split(':')[1], 10);
    if (losMs < cutoff) warnedPreAosKeys.delete(k);
  }
  for (const k of spokenKeys) {
    const parts = k.split(':');
    const losMs = parseInt(parts[1], 10);
    if (losMs < cutoff) spokenKeys.delete(k);
  }
}

/* ───── Browser notifications ───── */

async function requestNotifPerm() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const res = await Notification.requestPermission();
  return res === 'granted';
}

function showNotif(title, body) {
  if (!notifEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: 'pass-tracker', renotify: true });
    n.onclick = () => { window.focus(); n.close(); };
    setTimeout(() => { try { n.close(); } catch {} }, 15000);
  } catch (err) { console.warn('Notif failed:', err); }
}

/* ───── Text-to-speech ───── */

// Cached Turkish voice — looked up lazily because voices load async on
// some browsers (Chrome fires `voiceschanged` after the first call).
let _trVoice = null;
function pickTurkishVoice() {
  if (_trVoice) return _trVoice;
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices() || [];
  // Prefer an exact tr-TR match, then any voice whose lang starts with "tr".
  _trVoice = voices.find(v => v.lang === 'tr-TR')
          || voices.find(v => (v.lang || '').toLowerCase().startsWith('tr'))
          || null;
  return _trVoice;
}

if ('speechSynthesis' in window) {
  // Re-resolve when the voice list is finally available (Chrome quirk).
  speechSynthesis.addEventListener?.('voiceschanged', () => { _trVoice = null; pickTurkishVoice(); });
}

function speak(text, lang = 'tr-TR') {
  if (!ttsEnabled || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();  // drop any queued
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const voice = pickTurkishVoice();
    if (voice) u.voice = voice;
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    speechSynthesis.speak(u);
  } catch (err) { console.warn('TTS failed:', err); }
}

/* ───── Wake lock ───── */

async function enableWakeLock() {
  if (!('wakeLock' in navigator)) return false;
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
    return true;
  } catch (err) { console.warn('Wake lock failed:', err); return false; }
}

async function releaseWakeLock() {
  if (wakeLockSentinel) {
    try { await wakeLockSentinel.release(); } catch {}
    wakeLockSentinel = null;
  }
}

// Re-acquire wake lock when tab becomes visible again (browsers auto-release on hide)
document.addEventListener('visibilitychange', async () => {
  if (wakeEnabled && document.visibilityState === 'visible' && !wakeLockSentinel) {
    await enableWakeLock();
  }
});

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
  const sat = satellites[selectedSatIdx];
  const satName = sat?.name || 'Uydu';

  for (const p of passes) {
    const k = passKey(p);
    const aosMs = p.aos.getTime();
    const losMs = p.los.getTime();

    // Pre-AOS warnings (5 min, 1 min before) — fire within 60s of target offset
    for (const off of PRE_AOS_WARN_MS) {
      const target = aosMs - off;
      const wk = `${aosMs}:${losMs}:${off}`;
      if (target <= now && target > now - CHIME_WINDOW_MS && !warnedPreAosKeys.has(wk)) {
        warnedPreAosKeys.add(wk);
        const mins = Math.round(off / 60000);
        const elStr = p.maxEl.toFixed(0);
        showNotif(`${satName} — ${mins} dk içinde geçiş`, `Max ${elStr}°, AOS ${fmtTime(p.aos)} ${azToCompass(p.azAos)}`);
        speak(`${satName} geçişine ${mins} dakika kaldı. Maksimum elevasyon ${elStr} derece.`);
      }
    }

    // AOS: within last CHIME_WINDOW_MS and not already notified
    if (aosMs <= now && aosMs > now - CHIME_WINDOW_MS && !notifiedAosKeys.has(k)) {
      notifiedAosKeys.set(k, losMs);
      playAosChime();
      const elStr = p.maxEl.toFixed(0);
      showNotif(`${satName} — Geçiş başladı`, `Max ${elStr}°, ${azToCompass(p.azAos)} → ${azToCompass(p.azLos)}`);
      speak(`${satName} geçişi başladı. Maksimum elevasyon ${elStr} derece.`);
    }

    // LOS: within last CHIME_WINDOW_MS and not already notified
    if (losMs <= now && losMs > now - CHIME_WINDOW_MS && !notifiedLosKeys.has(k)) {
      notifiedLosKeys.set(k, losMs);
      playLosChime();
      showNotif(`${satName} — Geçiş tamamlandı`, `Süre: ${Math.floor((losMs - aosMs) / 60000)} dk`);
      speak(`${satName} geçişi tamamlandı.`);
    }
  }

  cleanupNotifiedKeys();
}

/* ───── URL deep-linking ───── */

/**
 * Sync the browser URL with current sat + pass selection so pages can be
 * bookmarked / shared. Format: ?sat=<norad>&idx=<pass-index>
 * Uses history.replaceState to avoid polluting history on every navigation.
 */
function syncUrl() {
  try {
    const sat = satellites[selectedSatIdx];
    if (!sat) return;
    const p = new URLSearchParams(window.location.search);
    p.set('sat', String(sat.noradId));
    if (viewedIdx >= 0) p.set('idx', String(viewedIdx));
    else p.delete('idx');
    const newUrl = `${window.location.pathname}?${p.toString()}${window.location.hash}`;
    history.replaceState(null, '', newUrl);
  } catch {}
}

/**
 * Read sat + pass index from the current URL and apply. Returns true
 * if any URL-derived state was applied (so caller can skip default
 * "next pass" selection).
 */
function applyUrlState() {
  try {
    const p = new URLSearchParams(window.location.search);
    const satParam = p.get('sat');
    const idxParam = p.get('idx');
    if (satParam) {
      const noradId = parseInt(satParam, 10);
      if (!Number.isNaN(noradId)) {
        let i = satellites.findIndex(s => s.noradId === noradId);
        if (i < 0) {
          // Add the satellite implicitly so the deep link works
          satellites.push({
            noradId, name: `SAT-${noradId}`,
            color: TRACK_COLORS[satellites.length % TRACK_COLORS.length], satrec: null,
          });
          i = satellites.length - 1;
        }
        selectedSatIdx = i;
      }
    }
    if (idxParam) {
      const n = parseInt(idxParam, 10);
      if (!Number.isNaN(n) && n >= 0) viewedIdx = n;
    }
    return Boolean(satParam || idxParam);
  } catch { return false; }
}

/* ───── Keyboard shortcuts ───── */

function installKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ignore when typing in form controls
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case 'ArrowLeft': {
        if (passes.length === 0) return;
        const now = Date.now();
        const nextIdx = passes.findIndex(p => p.los.getTime() > now);
        const cur = viewedIdx === -1 ? (nextIdx >= 0 ? nextIdx : 0) : viewedIdx;
        if (cur > 0) { viewedIdx = cur - 1; renderAll(); syncUrl(); }
        e.preventDefault();
        break;
      }
      case 'ArrowRight': {
        if (passes.length === 0) return;
        const now = Date.now();
        const nextIdx = passes.findIndex(p => p.los.getTime() > now);
        const cur = viewedIdx === -1 ? (nextIdx >= 0 ? nextIdx : 0) : viewedIdx;
        if (cur < passes.length - 1) { viewedIdx = cur + 1; renderAll(); syncUrl(); }
        e.preventDefault();
        break;
      }
      case ' ':  // Space → "Sıradaki" (next upcoming)
        viewedIdx = -1; renderAll(); syncUrl();
        e.preventDefault();
        break;
      case 'n': case 'N': {
        // Next satellite
        if (satellites.length <= 1) return;
        selectedSatIdx = (selectedSatIdx + 1) % satellites.length;
        const sel = document.getElementById('pt-sat-select');
        if (sel) sel.value = selectedSatIdx;
        passes = []; viewedIdx = -1; renderAll(); loadTLEAndCompute(); syncUrl();
        break;
      }
      case 'p': case 'P': {
        // Previous satellite
        if (satellites.length <= 1) return;
        selectedSatIdx = (selectedSatIdx - 1 + satellites.length) % satellites.length;
        const sel = document.getElementById('pt-sat-select');
        if (sel) sel.value = selectedSatIdx;
        passes = []; viewedIdx = -1; renderAll(); loadTLEAndCompute(); syncUrl();
        break;
      }
      case 's': case 'S': {
        const b = document.getElementById('pt-sound-btn');
        if (b) b.click();
        break;
      }
      case 'e': case 'E':
        if (passes.length) downloadIcs();
        break;
      case 'v': case 'V':
        // Toggle chart view polar ↔ el-vs-time
        chartView = chartView === 'polar' ? 'elvt' : 'polar';
        try { localStorage.setItem(CHART_VIEW_KEY, chartView); } catch {}
        renderAll();
        break;
      case 'f': case 'F':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
        break;
      case '?':
      case 'h': case 'H':
        toggleShortcutsHelp();
        break;
    }
  });
}

function toggleShortcutsHelp() {
  const existing = document.getElementById('pt-shortcuts-overlay');
  if (existing) { existing.remove(); return; }
  const overlay = el('div', 'pt-shortcuts-overlay');
  overlay.id = 'pt-shortcuts-overlay';
  overlay.innerHTML = `
    <div class="pt-shortcuts-box">
      <h3>Klavye Kısayolları</h3>
      <ul>
        <li><kbd>←</kbd> / <kbd>→</kbd> Önceki / sonraki geçiş</li>
        <li><kbd>Space</kbd> Sıradaki geçiş</li>
        <li><kbd>N</kbd> / <kbd>P</kbd> Sonraki / önceki uydu</li>
        <li><kbd>S</kbd> Ses aç/kapa</li>
        <li><kbd>V</kbd> Grafik görünümü (polar ↔ el-zaman)</li>
        <li><kbd>E</kbd> Takvim (.ics) indir</li>
        <li><kbd>F</kbd> Tam ekran</li>
        <li><kbd>?</kbd> / <kbd>H</kbd> Bu yardım</li>
        <li><kbd>Esc</kbd> Kapat</li>
      </ul>
      <button class="pt-back pt-shortcuts-close">Kapat</button>
    </div>
  `;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('pt-shortcuts-close')) overlay.remove();
  });
  document.addEventListener('keydown', function once(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', once); }
  });
  document.body.append(overlay);
}

/* ───── Bootstrap ───── */

function init() {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    if (v !== null) soundEnabled = v === '1';
    const n = localStorage.getItem(NOTIF_KEY);
    if (n !== null) notifEnabled = n === '1';
    const t = localStorage.getItem(TTS_KEY);
    if (t !== null) ttsEnabled = t === '1';
    const w = localStorage.getItem(WAKE_KEY);
    if (w !== null) wakeEnabled = w === '1';
    const f = localStorage.getItem(FILTER_KEY);
    if (f) Object.assign(filter, JSON.parse(f));
    const cv = localStorage.getItem(CHART_VIEW_KEY);
    if (cv === 'polar' || cv === 'elvt') chartView = cv;
  } catch {}

  // If notifications were previously enabled but permission is no longer granted, disable
  if (notifEnabled && 'Notification' in window && Notification.permission !== 'granted') {
    notifEnabled = false;
    try { localStorage.setItem(NOTIF_KEY, '0'); } catch {}
  }

  loadFromMainApp();
  // Apply URL deep-link state after loading sat list (may select/inject a sat)
  applyUrlState();
  buildUI();
  installKeyboardShortcuts();
  if (satellites.length > 0) loadTLEAndCompute();

  // Restore wake lock if previously enabled
  if (wakeEnabled) enableWakeLock();

  // Re-compute every 60s
  refreshTimer = setInterval(() => {
    if (satellites[selectedSatIdx]?.satrec) computePasses();
  }, 60000);

  // Check AOS/LOS transitions every second (runs always, even if hero not showing pass)
  transitionsTimer = setInterval(checkPassTransitions, 1000);

  // All-satellite next-pass widget: full recompute every 5 min, countdown every 5 s
  updateAllSatNextPass();
  allSatNextPassTimer = setInterval(updateAllSatNextPass, 5 * 60 * 1000);
  allSatPillTimer = setInterval(renderAllSatPill, 5000);

  // One-shot IDB housekeeping — prune expired pass-cache entries
  idbCleanupExpired();

  // Release timers/wake lock when the page unloads so reloading doesn't leak
  window.addEventListener('beforeunload', cleanupOnUnload);
  window.addEventListener('pagehide', cleanupOnUnload);
}

function cleanupOnUnload() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  if (transitionsTimer) { clearInterval(transitionsTimer); transitionsTimer = null; }
  if (allSatNextPassTimer) { clearInterval(allSatNextPassTimer); allSatNextPassTimer = null; }
  if (allSatPillTimer) { clearInterval(allSatPillTimer); allSatPillTimer = null; }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  if (wakeLockSentinel) { try { wakeLockSentinel.release(); } catch {} wakeLockSentinel = null; }
  if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch {} }
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
      sat.tleLine1 = tle.line1;
      sat.tleLine2 = tle.line2;
      sat.name = tle.name;
    } catch (err) {
      console.error('TLE fetch failed:', err);
      return;
    }
  }
  computePasses();
}

async function computePasses() {
  const sat = satellites[selectedSatIdx];
  if (!sat?.satrec || !groundStation) { passes = []; renderAll(); return; }

  const prevPasses = passes;
  const prevViewed = viewedIdx;
  const prevKey = (prevViewed >= 0 && prevPasses[prevViewed]) ? passKey(prevPasses[prevViewed]) : null;

  // Try IDB cache first (expires after 6 h or when TLE epoch changes)
  const cacheKey = passCacheKey(sat, groundStation);
  const now = Date.now();
  const cached = await idbGet(cacheKey);
  if (cached && cached.expiresAt > now && Array.isArray(cached.passes)) {
    passes = deserializePasses(cached.passes);
  } else {
    // Prefer worker-based SGP4 so the UI never freezes on long sweeps.
    // If TLE lines weren't stored (older state), fall back to sync path.
    if (sat.tleLine1 && sat.tleLine2) {
      try {
        passes = await predictPassesInWorker(sat.tleLine1, sat.tleLine2, groundStation, ANALYSIS_DAYS);
      } catch {
        passes = predictPasses(sat.satrec, groundStation, ANALYSIS_DAYS);
      }
    } else {
      passes = predictPasses(sat.satrec, groundStation, ANALYSIS_DAYS);
    }
    enrichPasses(sat.satrec, groundStation, passes);
    // Persist for ~6 h or until TLE changes
    idbSet(cacheKey, {
      expiresAt: now + 6 * 3600 * 1000,
      passes: serializePasses(passes),
    });
  }

  // Suppress chimes for transitions that happened before we had the pass list
  // (prevents spurious chime on page load during a running pass)
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
  soundBtn.setAttribute('aria-label', 'Ses bildirimlerini aç/kapat');
  soundBtn.setAttribute('aria-pressed', String(soundEnabled));
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
    soundBtn.setAttribute('aria-pressed', String(soundEnabled));
    renderSoundBtn();
  });
  top.append(soundBtn);

  // Notification toggle
  const notifBtn = el('button', 'pt-back');
  notifBtn.style.cursor = 'pointer';
  notifBtn.setAttribute('aria-label', 'Tarayıcı bildirimlerini aç/kapat');
  notifBtn.setAttribute('aria-pressed', String(notifEnabled));
  const renderNotifBtn = () => {
    const supported = 'Notification' in window;
    notifBtn.innerHTML = notifEnabled
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg> Bildirim'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Bildirim';
    notifBtn.style.color = notifEnabled ? 'var(--pt-green)' : 'var(--pt-dim)';
    notifBtn.style.borderColor = notifEnabled ? 'rgba(63,185,80,0.4)' : 'var(--pt-border)';
    notifBtn.title = supported ? (notifEnabled ? 'Tarayıcı bildirimleri açık' : 'Tarayıcı bildirimlerini aç') : 'Tarayıcı desteklemiyor';
    notifBtn.disabled = !supported;
  };
  renderNotifBtn();
  notifBtn.addEventListener('click', async () => {
    if (!notifEnabled) {
      const ok = await requestNotifPerm();
      if (!ok) { notifBtn.title = 'İzin reddedildi'; return; }
      notifEnabled = true;
    } else {
      notifEnabled = false;
    }
    try { localStorage.setItem(NOTIF_KEY, notifEnabled ? '1' : '0'); } catch {}
    notifBtn.setAttribute('aria-pressed', String(notifEnabled));
    renderNotifBtn();
  });
  top.append(notifBtn);

  // TTS toggle
  const ttsBtn = el('button', 'pt-back');
  ttsBtn.style.cursor = 'pointer';
  ttsBtn.setAttribute('aria-label', 'Sesli anonsları aç/kapat');
  ttsBtn.setAttribute('aria-pressed', String(ttsEnabled));
  const renderTtsBtn = () => {
    const supported = 'speechSynthesis' in window;
    ttsBtn.innerHTML = ttsEnabled
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg> Sesli'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23"/></svg> Sesli';
    ttsBtn.style.color = ttsEnabled ? 'var(--pt-green)' : 'var(--pt-dim)';
    ttsBtn.style.borderColor = ttsEnabled ? 'rgba(63,185,80,0.4)' : 'var(--pt-border)';
    ttsBtn.title = supported ? (ttsEnabled ? 'Sesli anons açık' : 'Sesli anonsu aç') : 'Tarayıcı desteklemiyor';
    ttsBtn.disabled = !supported;
  };
  renderTtsBtn();
  ttsBtn.addEventListener('click', () => {
    ttsEnabled = !ttsEnabled;
    try { localStorage.setItem(TTS_KEY, ttsEnabled ? '1' : '0'); } catch {}
    if (ttsEnabled) speak('Sesli anons açık.');
    else if ('speechSynthesis' in window) speechSynthesis.cancel();
    ttsBtn.setAttribute('aria-pressed', String(ttsEnabled));
    renderTtsBtn();
  });
  top.append(ttsBtn);

  // Wake lock toggle
  const wakeBtn = el('button', 'pt-back');
  wakeBtn.style.cursor = 'pointer';
  wakeBtn.setAttribute('aria-label', 'Ekran uyku kilidini aç/kapat');
  wakeBtn.setAttribute('aria-pressed', String(wakeEnabled));
  const renderWakeBtn = () => {
    const supported = 'wakeLock' in navigator;
    wakeBtn.innerHTML = wakeEnabled
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg> Ekran Açık'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg> Uyku Modu';
    wakeBtn.style.color = wakeEnabled ? 'var(--pt-green)' : 'var(--pt-dim)';
    wakeBtn.style.borderColor = wakeEnabled ? 'rgba(63,185,80,0.4)' : 'var(--pt-border)';
    wakeBtn.title = supported ? (wakeEnabled ? 'Ekran uyumayacak' : 'Ekranı uyanık tut') : 'Tarayıcı desteklemiyor';
    wakeBtn.disabled = !supported;
  };
  renderWakeBtn();
  wakeBtn.addEventListener('click', async () => {
    if (!wakeEnabled) {
      const ok = await enableWakeLock();
      if (!ok) { wakeBtn.title = 'Ekran kilidi alınamadı'; return; }
      wakeEnabled = true;
    } else {
      wakeEnabled = false;
      await releaseWakeLock();
    }
    try { localStorage.setItem(WAKE_KEY, wakeEnabled ? '1' : '0'); } catch {}
    wakeBtn.setAttribute('aria-pressed', String(wakeEnabled));
    renderWakeBtn();
  });
  top.append(wakeBtn);

  // Calendar export (.ics)
  const icsBtn = el('button', 'pt-back');
  icsBtn.style.cursor = 'pointer';
  icsBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Takvim';
  icsBtn.title = 'Gecisleri .ics dosyasi olarak indir (Google/Outlook/Apple Calendar)';
  icsBtn.addEventListener('click', () => {
    if (!passes.length) { icsBtn.title = 'Onceliği geçiş bekle'; return; }
    downloadIcs();
  });
  top.append(icsBtn);

  // Next-pass-across-all-sats pill
  const pill = el('div', 'pt-all-sat-pill');
  pill.id = 'pt-all-sat-pill';
  pill.style.display = 'none';
  pill.title = 'Tüm uydular arasında en yakın gecis';
  pill.addEventListener('click', () => {
    if (!allSatNextPass) return;
    if (allSatNextPass.satIdx !== selectedSatIdx) {
      sel.value = allSatNextPass.satIdx;
      selectedSatIdx = allSatNextPass.satIdx;
      passes = [];
      viewedIdx = -1;
      renderAll();
      loadTLEAndCompute();
    }
  });
  top.append(pill);

  // Help / shortcuts
  const helpBtn = el('button', 'pt-back');
  helpBtn.style.cursor = 'pointer';
  helpBtn.textContent = '?';
  helpBtn.title = 'Klavye kısayolları (? tuşu)';
  helpBtn.addEventListener('click', toggleShortcutsHelp);
  top.append(helpBtn);

  // GS label
  const gsLabel = el('span', 'pt-gs-label');
  gsLabel.innerHTML = `GS: <strong>${esc(groundStation.name)}</strong> (${groundStation.lat.toFixed(2)}°, ${groundStation.lon.toFixed(2)}°)`;
  top.append(gsLabel);

  app.append(top);

  // 24h Gantt timeline
  const timeline = el('div', 'pt-timeline');
  timeline.id = 'pt-timeline';
  app.append(timeline);

  // Main content
  const main = el('div', 'pt-main');
  main.innerHTML = '<div class="pt-hero" id="pt-hero"></div><div class="pt-list-panel"><div class="pt-list-header" id="pt-list-header"></div><div class="pt-list-scroll" id="pt-list-scroll"></div></div>';
  app.append(main);

  renderAll();
}

function renderAll() {
  renderTimeline();
  renderHero();
  renderList();
  syncUrl();
}

/**
 * 24-hour Gantt timeline: horizontal bar showing all passes in the next
 * 24 h for *every* satellite. Block height ∝ max elevation. Tooltip +
 * click to select.
 */
function renderTimeline() {
  const tl = document.getElementById('pt-timeline');
  if (!tl) return;
  tl.innerHTML = '';

  const now = Date.now();
  const winMs = 24 * 3600 * 1000;
  const end = now + winMs;

  // Collect passes across ALL satellites for the next 24 h.
  // For selected sat we reuse already-computed `passes`; others need a fresh
  // shorter predict call.
  const blocks = [];  // { satIdx, satName, color, p }
  for (let i = 0; i < satellites.length; i++) {
    const s = satellites[i];
    if (!s.satrec || !groundStation) continue;
    let ps;
    if (i === selectedSatIdx) {
      ps = passes.filter(p => p.los.getTime() >= now && p.aos.getTime() <= end);
    } else {
      // Short predict window — keep coarse to be fast
      ps = predictPasses(s.satrec, groundStation, 1, 90)
             .filter(p => p.los.getTime() >= now && p.aos.getTime() <= end);
    }
    for (const p of ps) blocks.push({ satIdx: i, satName: s.name, color: s.color, p });
  }

  // Build horizontal strip
  const inner = el('div', 'pt-tl-inner');

  // Hour ticks
  const ticks = el('div', 'pt-tl-ticks');
  for (let h = 0; h <= 24; h += 3) {
    const frac = h / 24;
    const at = new Date(now + h * 3600 * 1000);
    const tick = el('span', 'pt-tl-tick');
    tick.style.left = (frac * 100) + '%';
    tick.textContent = h === 0 ? 'şimdi' : `+${h}h`;
    if (h > 0) {
      const hr = at.getHours().toString().padStart(2, '0');
      tick.title = `${hr}:00`;
    }
    ticks.append(tick);
  }
  inner.append(ticks);

  // Bar background
  const bar = el('div', 'pt-tl-bar');

  // Pass blocks
  for (const b of blocks) {
    const left = ((b.p.aos.getTime() - now) / winMs) * 100;
    const width = Math.max(0.4, ((b.p.los.getTime() - b.p.aos.getTime()) / winMs) * 100);
    const block = el('div', 'pt-tl-block');
    if (b.satIdx === selectedSatIdx) block.classList.add('current-sat');
    const isActive = b.p.aos.getTime() <= now && b.p.los.getTime() > now;
    if (isActive) block.classList.add('active');
    block.style.left = Math.max(0, left) + '%';
    block.style.width = Math.min(100 - Math.max(0, left), width) + '%';
    // Height/opacity proportional to max elevation (clamped)
    const hFrac = Math.min(1, b.p.maxEl / 60);
    block.style.height = (30 + hFrac * 60) + '%';
    block.style.background = b.color;
    block.style.borderColor = b.color;
    block.title = `${b.satName}\nAOS ${fmtTime(b.p.aos)} → LOS ${fmtTime(b.p.los)}\nMax ${b.p.maxEl.toFixed(1)}°${b.p.visible ? ' 👁' : ''}`;
    block.addEventListener('click', () => {
      if (b.satIdx !== selectedSatIdx) {
        const sel = document.getElementById('pt-sat-select');
        if (sel) sel.value = b.satIdx;
        selectedSatIdx = b.satIdx;
        passes = [];
        viewedIdx = -1;
        loadTLEAndCompute();
      } else {
        const i = passes.findIndex(x => x.aos.getTime() === b.p.aos.getTime());
        if (i >= 0) { viewedIdx = i; renderAll(); }
      }
    });
    bar.append(block);
  }

  // "Now" indicator — at the left edge but still show a clear marker
  const nowMarker = el('div', 'pt-tl-now');
  nowMarker.style.left = '0%';
  bar.append(nowMarker);

  inner.append(bar);
  tl.append(inner);
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
      if (isActive) updateLiveReadout(pass);
    }, 1000);
  }

  // Chart (polar sky dome or elevation-vs-time line)
  const chartWrap = el('div', 'pt-chart-wrap');
  const toggle = el('div', 'pt-chart-toggle');
  toggle.innerHTML = `
    <button data-v="polar" class="${chartView === 'polar' ? 'active' : ''}" title="Polar gökyüzü haritası">⊙ Polar</button>
    <button data-v="elvt" class="${chartView === 'elvt' ? 'active' : ''}" title="Elevasyon vs zaman grafiği">📈 El-Zaman</button>
  `;
  toggle.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = b.getAttribute('data-v');
    if (v && v !== chartView) {
      chartView = v;
      try { localStorage.setItem(CHART_VIEW_KEY, chartView); } catch {}
      renderAll();
    }
  });
  chartWrap.append(toggle);
  chartWrap.append(chartView === 'elvt' ? buildElVsTimeChart(pass, isActive) : buildPolarChart(pass, isActive));
  hero.append(chartWrap);

  // Live AZ / EL / range readout (shown for active pass)
  if (isActive) {
    const live = el('div', 'pt-live-readout');
    live.innerHTML = `
      <div class="pt-live-block"><div class="pt-live-label">AZIMUT</div><div class="pt-live-value" id="pt-live-az">—</div></div>
      <div class="pt-live-block"><div class="pt-live-label">ELEVASYON</div><div class="pt-live-value green" id="pt-live-el">—</div></div>
      <div class="pt-live-block"><div class="pt-live-label">MESAFE</div><div class="pt-live-value" id="pt-live-range">—</div></div>
    `;
    hero.append(live);
    updateLiveReadout(pass);
  }

  // Details row: max el, duration, range
  const details = el('div', 'pt-pass-details');
  const durSec = (pass.los - pass.aos) / 1000;
  const durM = Math.floor(durSec / 60);
  const durS = Math.floor(durSec % 60);

  const heroStars = pass.stars != null ? '★'.repeat(pass.stars) + '☆'.repeat(5 - pass.stars) : '';
  const heroVis = pass.visible ? '<span class="pt-hero-vis" title="Optik olarak izlenebilir">👁 Görünür</span>' : '';
  details.innerHTML = `
    <div class="pt-detail"><div class="pt-detail-value ${pass.maxEl >= 30 ? 'green' : 'accent'}">${pass.maxEl.toFixed(1)}°</div><div class="pt-detail-label">Max Elevasyon</div></div>
    <div class="pt-detail"><div class="pt-detail-value">${durM}m ${durS}s</div><div class="pt-detail-label">Sure</div></div>
    <div class="pt-detail"><div class="pt-detail-value gold">${azToCompass(pass.azAos)}→${azToCompass(pass.azLos)}</div><div class="pt-detail-label">Yon ${heroVis}</div></div>
    <div class="pt-detail" style="grid-column:1/-1;"><div class="pt-detail-value" style="font-size:29px;color:var(--pt-gold);letter-spacing:4px;">${heroStars}</div><div class="pt-detail-label">Kalite (${pass.score?.toFixed(0) ?? 0}/100)</div></div>
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

/**
 * Project (azimuth°, elevation°) to polar-chart Cartesian coords.
 * Zenith at center (cx, cy), horizon at radius `maxR`.
 * North up, East right — azimuth measured clockwise from North.
 */
function polarProject(azDeg, elDeg, cx, cy, maxR) {
  const DEG = Math.PI / 180;
  const r = Math.max(0, (90 - elDeg) / 90) * maxR;
  return [cx + r * Math.sin(azDeg * DEG), cy - r * Math.cos(azDeg * DEG)];
}

function buildPolarChart(pass, isActive) {
  // 400×400 viewBox (square polar chart)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pt-arc-svg');
  svg.setAttribute('viewBox', '0 0 400 400');

  const cx = 200, cy = 200, R = 175;
  const color = isActive ? '#3fb950' : '#58a6ff';

  // Sample trajectory (AOS → LOS) for path
  const sat = satellites[selectedSatIdx];
  const samples = [];
  if (sat?.satrec && groundStation) {
    const N = 48;
    const aosT = pass.aos.getTime();
    const losT = pass.los.getTime();
    for (let i = 0; i <= N; i++) {
      const t = aosT + ((losT - aosT) * i) / N;
      const look = getLookAngles(sat.satrec, new Date(t), groundStation);
      if (look && look.elevation >= 0) samples.push(look);
    }
  }

  // Build trajectory path
  let pathD = '';
  for (let i = 0; i < samples.length; i++) {
    const [x, y] = polarProject(samples[i].azimuth, samples[i].elevation, cx, cy, R);
    pathD += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
  }

  // Key points
  const [aosX, aosY] = pass.azAos != null ? polarProject(pass.azAos, 0, cx, cy, R) : [cx, cy];
  const [losX, losY] = pass.azLos != null ? polarProject(pass.azLos, 0, cx, cy, R) : [cx, cy];
  const [tcaX, tcaY] = pass.azTca != null ? polarProject(pass.azTca, pass.maxEl, cx, cy, R) : [cx, cy];

  // Elevation ring positions (30°, 60°)
  const r30 = ((90 - 30) / 90) * R;
  const r60 = ((90 - 60) / 90) * R;

  svg.innerHTML = `
    <defs>
      <radialGradient id="pt-sky" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#0d1117" stop-opacity="0.0"/>
        <stop offset="100%" stop-color="#161b22" stop-opacity="0.6"/>
      </radialGradient>
    </defs>
    <!-- Sky dome -->
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#pt-sky)" stroke="#30363d" stroke-width="1.5"/>
    <!-- Elevation rings -->
    <circle cx="${cx}" cy="${cy}" r="${r30}" fill="none" stroke="#30363d" stroke-width="1" stroke-dasharray="3 4"/>
    <circle cx="${cx}" cy="${cy}" r="${r60}" fill="none" stroke="#30363d" stroke-width="1" stroke-dasharray="3 4"/>
    <!-- Cross lines N-S / E-W -->
    <line x1="${cx}" y1="${cy - R}" x2="${cx}" y2="${cy + R}" stroke="#30363d" stroke-width="1"/>
    <line x1="${cx - R}" y1="${cy}" x2="${cx + R}" y2="${cy}" stroke="#30363d" stroke-width="1"/>
    <!-- Compass labels -->
    <text x="${cx}" y="${cy - R - 8}" font-size="18" font-weight="700" fill="#8b949e" font-family="sans-serif" text-anchor="middle">K</text>
    <text x="${cx + R + 12}" y="${cy + 6}" font-size="18" font-weight="700" fill="#8b949e" font-family="sans-serif" text-anchor="middle">D</text>
    <text x="${cx}" y="${cy + R + 20}" font-size="18" font-weight="700" fill="#8b949e" font-family="sans-serif" text-anchor="middle">G</text>
    <text x="${cx - R - 12}" y="${cy + 6}" font-size="18" font-weight="700" fill="#8b949e" font-family="sans-serif" text-anchor="middle">B</text>
    <!-- Elevation ring labels -->
    <text x="${cx + 4}" y="${cy - r60 - 3}" font-size="11" fill="#5c6980" font-family="monospace">60°</text>
    <text x="${cx + 4}" y="${cy - r30 - 3}" font-size="11" fill="#5c6980" font-family="monospace">30°</text>
    <!-- Trajectory path -->
    ${pathD ? `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" ${isActive ? '' : 'stroke-dasharray="6 4"'}/>` : ''}
    <!-- AOS marker -->
    <circle cx="${aosX}" cy="${aosY}" r="6" fill="#58a6ff" stroke="#0d1117" stroke-width="2"/>
    <text x="${aosX}" y="${aosY - 12}" font-size="12" font-weight="700" fill="#58a6ff" font-family="sans-serif" text-anchor="middle">AOS</text>
    <!-- LOS marker -->
    <circle cx="${losX}" cy="${losY}" r="6" fill="#f85149" stroke="#0d1117" stroke-width="2"/>
    <text x="${losX}" y="${losY - 12}" font-size="12" font-weight="700" fill="#f85149" font-family="sans-serif" text-anchor="middle">LOS</text>
    <!-- TCA marker -->
    <circle cx="${tcaX}" cy="${tcaY}" r="7" fill="#ffd700" stroke="#0d1117" stroke-width="2"/>
    <text x="${tcaX}" y="${tcaY - 14}" font-size="13" font-weight="700" fill="#ffd700" font-family="monospace" text-anchor="middle">${pass.maxEl.toFixed(1)}°</text>
    <!-- Live dot (will be updated for active pass) -->
    <circle id="pt-live-dot" cx="${cx}" cy="${cy}" r="8" fill="${color}" opacity="0" stroke="#0d1117" stroke-width="2">
      ${isActive ? '<animate attributeName="r" values="8;12;8" dur="1.5s" repeatCount="indefinite"/>' : ''}
    </circle>
  `;
  return svg;
}

/**
 * Alternative chart view: elevation vs time line plot (familiar ham-radio
 * style). Same outer dimensions as the polar chart for drop-in swap.
 */
function buildElVsTimeChart(pass, isActive) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pt-arc-svg');
  svg.setAttribute('viewBox', '0 0 400 400');

  const padL = 48, padR = 24, padT = 24, padB = 46;
  const plotW = 400 - padL - padR;
  const plotH = 400 - padT - padB;
  const color = isActive ? '#3fb950' : '#58a6ff';

  // Sample trajectory
  const sat = satellites[selectedSatIdx];
  const samples = [];
  if (sat?.satrec && groundStation) {
    const N = 80;
    const aosT = pass.aos.getTime();
    const losT = pass.los.getTime();
    for (let i = 0; i <= N; i++) {
      const tms = aosT + ((losT - aosT) * i) / N;
      const look = getLookAngles(sat.satrec, new Date(tms), groundStation);
      if (look) samples.push({ t: tms, el: Math.max(0, look.elevation), az: look.azimuth });
    }
  }

  const aosMs = pass.aos.getTime();
  const losMs = pass.los.getTime();
  const span = losMs - aosMs || 1;
  const xOf = tms => padL + ((tms - aosMs) / span) * plotW;
  const yOf = el => padT + plotH - (el / 90) * plotH;

  // Build line path
  let pathD = '';
  for (let i = 0; i < samples.length; i++) {
    const x = xOf(samples[i].t);
    const y = yOf(samples[i].el);
    pathD += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
  }
  // Filled area under the curve (for visual weight)
  const areaD = samples.length >= 2
    ? pathD + ` L${xOf(samples[samples.length-1].t).toFixed(1)} ${(padT + plotH).toFixed(1)} L${xOf(samples[0].t).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`
    : '';

  // Y-axis gridlines at 0/30/60/90
  const yGrid = [0, 30, 60, 90].map(e => {
    const y = yOf(e).toFixed(1);
    return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="#30363d" stroke-width="1" stroke-dasharray="3 4"/>
            <text x="${padL - 6}" y="${y}" font-size="12" fill="#8b949e" font-family="monospace" text-anchor="end" dominant-baseline="middle">${e}°</text>`;
  }).join('');

  // Time ticks at AOS, TCA, LOS
  const timeTick = (tms, label, col) => {
    const x = xOf(tms).toFixed(1);
    return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="${col}" stroke-width="1" stroke-dasharray="2 3" opacity="0.5"/>
            <text x="${x}" y="${padT + plotH + 18}" font-size="12" fill="${col}" font-family="monospace" text-anchor="middle">${label}</text>
            <text x="${x}" y="${padT + plotH + 33}" font-size="11" fill="#8b949e" font-family="monospace" text-anchor="middle">${fmtTime(new Date(tms))}</text>`;
  };

  svg.innerHTML = `
    <!-- Plot background -->
    <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#0d1117" stroke="#30363d" stroke-width="1"/>
    ${yGrid}
    <!-- Y axis label -->
    <text x="14" y="${padT + plotH / 2}" font-size="13" font-weight="600" fill="#8b949e" font-family="sans-serif" text-anchor="middle" transform="rotate(-90 14 ${padT + plotH / 2})">Elevasyon</text>
    <!-- Area + trajectory -->
    ${areaD ? `<path d="${areaD}" fill="${color}" opacity="0.12"/>` : ''}
    ${pathD ? `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" ${isActive ? '' : 'stroke-dasharray="6 4"'}/>` : ''}
    <!-- Time ticks -->
    ${timeTick(aosMs, 'AOS', '#58a6ff')}
    ${timeTick(pass.tca.getTime(), 'TCA', '#ffd700')}
    ${timeTick(losMs, 'LOS', '#f85149')}
    <!-- TCA dot -->
    <circle cx="${xOf(pass.tca.getTime()).toFixed(1)}" cy="${yOf(pass.maxEl).toFixed(1)}" r="6" fill="#ffd700" stroke="#0d1117" stroke-width="2"/>
    <text x="${xOf(pass.tca.getTime()).toFixed(1)}" y="${(yOf(pass.maxEl) - 12).toFixed(1)}" font-size="13" font-weight="700" fill="#ffd700" font-family="monospace" text-anchor="middle">${pass.maxEl.toFixed(1)}°</text>
    <!-- Live dot (active pass) -->
    <circle id="pt-live-dot-elvt" cx="${padL}" cy="${padT + plotH}" r="7" fill="${color}" opacity="0" stroke="#0d1117" stroke-width="2">
      ${isActive ? '<animate attributeName="r" values="7;11;7" dur="1.5s" repeatCount="indefinite"/>' : ''}
    </circle>
  `;
  return svg;
}

/**
 * Update the live AZ/EL/range readout and the moving dot on the polar chart.
 * Called once per second during an active pass.
 */
function updateLiveReadout(pass) {
  const sat = satellites[selectedSatIdx];
  if (!sat?.satrec || !groundStation) return;
  const look = getLookAngles(sat.satrec, new Date(), groundStation);
  if (!look) return;

  const azEl = document.getElementById('pt-live-az');
  const elEl = document.getElementById('pt-live-el');
  const rgEl = document.getElementById('pt-live-range');
  if (azEl) azEl.textContent = `${look.azimuth.toFixed(1)}° ${azToCompass(look.azimuth)}`;
  if (elEl) elEl.textContent = `${look.elevation.toFixed(1)}°`;
  if (rgEl) rgEl.textContent = `${look.rangeSat.toFixed(0)} km`;

  // Move the live dot on the polar chart
  const dot = document.getElementById('pt-live-dot');
  if (dot && look.elevation >= 0) {
    const [x, y] = polarProject(look.azimuth, look.elevation, 200, 200, 175);
    dot.setAttribute('cx', x.toFixed(1));
    dot.setAttribute('cy', y.toFixed(1));
    dot.setAttribute('opacity', '1');
  }

  // Move the live dot on the el-vs-time chart (same viewBox/padding as buildElVsTimeChart)
  const dotE = document.getElementById('pt-live-dot-elvt');
  if (dotE && look.elevation >= 0) {
    const padL = 48, padR = 24, padT = 24, padB = 46;
    const plotW = 400 - padL - padR;
    const plotH = 400 - padT - padB;
    const aosMs = pass.aos.getTime();
    const span = pass.los.getTime() - aosMs || 1;
    const frac = Math.max(0, Math.min(1, (Date.now() - aosMs) / span));
    const x = padL + frac * plotW;
    const y = padT + plotH - (Math.max(0, look.elevation) / 90) * plotH;
    dotE.setAttribute('cx', x.toFixed(1));
    dotE.setAttribute('cy', y.toFixed(1));
    dotE.setAttribute('opacity', '1');
  }
}

/* ───── Pass list ───── */

function saveFilter() {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(filter)); } catch {}
}

function renderListHeader(header, sat, filteredCount) {
  header.innerHTML = '';
  header.classList.add('pt-list-header-rich');

  const title = el('div', 'pt-list-title');
  const totalTxt = filteredCount === passes.length
    ? `${passes.length} geçiş`
    : `${filteredCount} / ${passes.length} geçiş`;
  title.textContent = sat ? `${sat.name} — ${totalTxt} (${ANALYSIS_DAYS} gün)` : 'Uydu seciniz';
  header.append(title);

  const controls = el('div', 'pt-list-controls');

  // Visible-only toggle
  const visBtn = el('button', 'pt-chip' + (filter.visibleOnly ? ' active' : ''));
  visBtn.innerHTML = '👁 Görünür';
  visBtn.title = 'Yalnızca optik olarak izlenebilir geçişler';
  visBtn.addEventListener('click', () => {
    filter.visibleOnly = !filter.visibleOnly;
    saveFilter();
    renderAll();
  });
  controls.append(visBtn);

  // Min elevation slider
  const elWrap = el('label', 'pt-chip pt-chip-input');
  elWrap.innerHTML = `Min <span class="pt-chip-val">${filter.minEl}°</span>`;
  const elInput = el('input');
  elInput.type = 'range';
  elInput.min = '0';
  elInput.max = '60';
  elInput.step = '5';
  elInput.value = String(filter.minEl);
  elInput.addEventListener('input', () => {
    filter.minEl = parseInt(elInput.value, 10);
    elWrap.querySelector('.pt-chip-val').textContent = filter.minEl + '°';
  });
  elInput.addEventListener('change', () => { saveFilter(); renderAll(); });
  elWrap.append(elInput);
  controls.append(elWrap);

  // Sort selector
  const sortBtn = el('button', 'pt-chip');
  const updateSortBtn = () => {
    sortBtn.textContent = filter.sortBy === 'score' ? '↓ Kalite' : '↑ Zaman';
    sortBtn.classList.toggle('active', filter.sortBy === 'score');
  };
  updateSortBtn();
  sortBtn.title = 'Sıralama: Zaman ↔ Kalite';
  sortBtn.addEventListener('click', () => {
    filter.sortBy = filter.sortBy === 'time' ? 'score' : 'time';
    saveFilter();
    updateSortBtn();
    renderAll();
  });
  controls.append(sortBtn);

  header.append(controls);
}

function renderList() {
  const header = document.getElementById('pt-list-header');
  const scroll = document.getElementById('pt-list-scroll');
  if (!header || !scroll) return;

  const sat = satellites[selectedSatIdx];
  scroll.innerHTML = '';

  // Apply filter
  const filtered = passes.filter(p =>
    p.maxEl >= filter.minEl && (!filter.visibleOnly || p.visible));

  // Header with filter controls
  renderListHeader(header, sat, filtered.length);

  if (passes.length === 0) {
    scroll.innerHTML = '<div class="pt-empty">Gecis bulunamadi</div>';
    return;
  }
  if (filtered.length === 0) {
    scroll.innerHTML = '<div class="pt-empty">Filtre ile eşleşen geçiş yok</div>';
    return;
  }

  const now = Date.now();
  const nextIdx = passes.findIndex(p => p.los.getTime() > now);
  const currentView = viewedIdx === -1 ? (nextIdx >= 0 ? nextIdx : 0) : Math.min(viewedIdx, passes.length - 1);

  // Sort
  const sorted = filter.sortBy === 'score'
    ? [...filtered].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    : filtered;

  // Group by day (only for chronological sort; score-sort is flat)
  const groups = new Map();
  if (filter.sortBy === 'time') {
    for (const p of sorted) {
      const key = fmtDate(p.aos);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
  } else {
    groups.set('Kaliteye göre sıralı', sorted);
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

      const stars = p.stars != null ? '★'.repeat(p.stars) + '☆'.repeat(5 - p.stars) : '';
      const visIcon = p.visible ? '<span class="pt-vis-icon" title="Görsel olarak izlenebilir">👁</span>' : '';

      const sunVal = p.sunElev != null ? p.sunElev.toFixed(1) : '—';
      const sunCls = p.sunElev == null ? 'pt-sun-none'
        : p.sunElev >= 50 ? 'pt-sun-high'
        : p.sunElev >= 20 ? 'pt-sun-mid'
        : p.sunElev >= 5 ? 'pt-sun-low' : 'pt-sun-dark';

      row.innerHTML = `
        <span class="pt-pass-cell">${fmtTime(p.aos)}</span>
        <span class="pt-pass-cell">${fmtTime(p.los)}</span>
        <span class="pt-pass-cell">${dm}m${ds > 0 ? ds + 's' : ''}</span>
        <span class="pt-el-badge ${elCls}">${p.maxEl.toFixed(1)}°</span>
        <span class="pt-sun-badge ${sunCls}">☀ ${sunVal}°</span>
        <span class="pt-az-cell">${fmtAzShort(p.azAos)}→${fmtAzShort(p.azLos)} ${visIcon}<span class="pt-stars">${stars}</span></span>
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

/* ───── .ics calendar export ───── */

function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function icsDate(d) {
  // Format as UTC basic form: YYYYMMDDTHHMMSSZ (RFC5545)
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function buildIcs(satName, gsName, pss) {
  const now = new Date();
  const dtstamp = icsDate(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Peyker//Pass Tracker//TR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(satName)} gecisleri`,
  ];
  for (const p of pss) {
    if (p.los.getTime() < now.getTime()) continue;  // skip past passes
    const uid = `pass-${p.aos.getTime()}-${p.los.getTime()}@peyker`;
    const dur = Math.floor((p.los - p.aos) / 60000);
    const desc = `Max el: ${p.maxEl.toFixed(1)}°\\nSüre: ${dur} dk\\nAOS az: ${p.azAos != null ? p.azAos.toFixed(0) + '° (' + azToCompass(p.azAos) + ')' : '?'}\\nLOS az: ${p.azLos != null ? p.azLos.toFixed(0) + '° (' + azToCompass(p.azLos) + ')' : '?'}\\nGS: ${gsName}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${icsDate(p.aos)}`,
      `DTEND:${icsDate(p.los)}`,
      `SUMMARY:${icsEscape(satName)} ${p.maxEl.toFixed(0)}° (${azToCompass(p.azAos)}→${azToCompass(p.azLos)})`,
      `DESCRIPTION:${desc}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(satName)} gecis`,
      'TRIGGER:-PT5M',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function downloadIcs() {
  const sat = satellites[selectedSatIdx];
  if (!sat || !passes.length) return;
  const content = buildIcs(sat.name, groundStation?.name || 'GS', passes);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sat.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_passes.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ───── Next-pass across all satellites ───── */

async function updateAllSatNextPass() {
  if (!groundStation || satellites.length === 0) { allSatNextPass = null; return; }

  // Ensure TLEs are loaded for all satellites (lazy, best-effort)
  for (const sat of satellites) {
    if (!sat.satrec) {
      try {
        const tle = await fetchTLE(sat.noradId);
        sat.satrec = parseTLE(tle.line1, tle.line2);
        sat.name = tle.name;
      } catch {
        continue;  // skip this sat if TLE fetch fails
      }
    }
  }

  const now = Date.now();
  let best = null;
  for (let i = 0; i < satellites.length; i++) {
    const s = satellites[i];
    if (!s.satrec) continue;
    // Short 3-day window for speed
    const ps = predictPasses(s.satrec, groundStation, 3, 60);
    for (const p of ps) {
      if (p.los.getTime() < now) continue;
      if (!best || p.aos.getTime() < best.aos.getTime()) {
        best = { satIdx: i, satName: s.name, aos: p.aos, los: p.los, pass: p };
      }
      break;  // only the first future pass matters for this sat
    }
  }
  allSatNextPass = best;
  renderAllSatPill();
}

function renderAllSatPill() {
  const pill = document.getElementById('pt-all-sat-pill');
  if (!pill) return;
  if (!allSatNextPass) {
    pill.style.display = 'none';
    return;
  }
  pill.style.display = '';
  const p = allSatNextPass;
  const isCurrent = p.satIdx === selectedSatIdx;
  const remMs = p.aos.getTime() - Date.now();
  const rem = remMs > 0 ? fmtCountdown(remMs) : 'AKTIF';
  pill.innerHTML = `
    <span class="pt-pill-label">Tüm uydularda sıradaki</span>
    <strong>${esc(p.satName)}</strong>
    <span class="pt-pill-cd">${rem}</span>
    <span class="pt-pill-el">${p.pass.maxEl.toFixed(0)}°</span>
  `;
  pill.classList.toggle('current', isCurrent);
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
