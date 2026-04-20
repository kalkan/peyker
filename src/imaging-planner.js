/**
 * Imaging Planner — target-based satellite imaging opportunity finder.
 *
 * Pick a target on the map (or enter coords), select satellites,
 * and find all imaging windows where roll ≤ threshold AND daylight.
 *
 * Ported analysis engine from Sezen; UI built fresh for Peyker.
 */

import 'leaflet/dist/leaflet.css';
import './styles/imaging-planner.css';
import L from 'leaflet';

import markerIcon from 'leaflet/dist/images/marker-icon.png?url';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png?url';
import markerShadow from 'leaflet/dist/images/marker-shadow.png?url';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

import { fetchTLE, searchSatellitesByName } from './sat/fetch.js';
import { parseTLE, propagateAt, computeFootprintRect } from './sat/propagate.js';
import { PRESETS, TRACK_COLORS } from './sat/presets.js';
import { SENSOR_PRESETS, getPreset } from './sat/sensor-presets.js';
import { computeOpportunityScore } from './sat/opportunity-score.js';
import { analyzeAllInPool } from './sat/opportunity-worker-client.js';
import { describeTleAge } from './sat/tle-meta.js';
import { idbGet, idbSet, idbCleanupExpired } from './sat/idb-cache.js';
import { buildIcs, downloadIcs } from './util/ics-export.js';
import { installKeyboardShortcuts, bind, openHelp } from './util/keyboard-shortcuts.js';
import './styles/shared.css';

/* ───── State ───── */

const STORAGE_KEY = 'sat-groundtrack-state';
const PREFS_KEY = 'ip-prefs-v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h: TLE may shift; keep cache short

let map = null;
let targetMarker = null;
let targetLat = null;
let targetLon = null;
let targetName = '';
let satellites = [];          // { noradId, name, color, satrec, tle, enabled }
let analysisResults = null;
let running = false;
let analysisGeneration = 0;  // stale-run guard
let analysisAbort = null;     // AbortController for current run
const analysisProgress = new Map(); // noradId -> 0..1
let selectedOpp = null;
let oppLayers = L.layerGroup();
let geomCanvas = null;

// Settings (persisted in PREFS_KEY)
let maxRollDeg = 5;
let horizonDays = 7;
let pitchDeg = 0;
let presetId = 'custom';
let sortBy = 'time';          // 'time' | 'score' | 'roll' | 'sun'
let filterMinSun = -2;        // sun elevation threshold for displayed opps
let filterRollPct = 100;      // % of maxRollDeg accepted (display filter)
let timezone = 'Europe/Istanbul';

const TIMEZONES = [
  { id: 'Europe/Istanbul', label: 'TRT (UTC+3)' },
  { id: 'UTC', label: 'UTC' },
  { id: 'browser', label: 'Tarayıcı' },
];

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (typeof p.maxRollDeg === 'number') maxRollDeg = p.maxRollDeg;
    if (typeof p.horizonDays === 'number') horizonDays = p.horizonDays;
    if (typeof p.pitchDeg === 'number') pitchDeg = p.pitchDeg;
    if (typeof p.presetId === 'string') presetId = p.presetId;
    if (typeof p.sortBy === 'string') sortBy = p.sortBy;
    if (typeof p.filterMinSun === 'number') filterMinSun = p.filterMinSun;
    if (typeof p.filterRollPct === 'number') filterRollPct = p.filterRollPct;
    if (typeof p.timezone === 'string') timezone = p.timezone;
  } catch {}
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      maxRollDeg, horizonDays, pitchDeg, presetId, sortBy, filterMinSun, filterRollPct, timezone,
    }));
  } catch {}
}

function applyPreset(id) {
  const p = getPreset(id);
  presetId = p.id;
  if (p.id !== 'custom') {
    maxRollDeg = p.maxRollDeg;
    pitchDeg = Math.min(Math.abs(pitchDeg), p.maxPitchDeg) * Math.sign(pitchDeg || 1);
    if (p.maxPitchDeg === 0) pitchDeg = 0;
  }
  savePrefs();
}

/* ───── Bootstrap ───── */

function init() {
  loadPrefs();
  // Best-effort cleanup of stale opportunity cache entries.
  idbCleanupExpired().catch(() => {});

  const app = document.getElementById('imaging-planner-app');
  app.innerHTML = '';

  // Left panel
  const panel = el('div', 'ip-panel');
  panel.append(buildHeader(), buildContent());
  app.append(panel);

  // Map
  const mapWrap = el('div', 'ip-map-container');
  mapWrap.innerHTML = '<div id="ip-map"></div>';
  app.append(mapWrap);

  // Right panel
  const right = el('div', 'ip-right-panel');
  right.append(buildRightHeader(), buildRightContent());
  app.append(right);

  initMap();
  loadSatellitesFromMainApp();
  applyUrlTarget();
  setupShortcuts();
}

function setupShortcuts() {
  installKeyboardShortcuts();
  bind({ key: 'r', label: 'Analizi yeniden çalıştır', run: () => runAnalysis(true) });
  bind({ key: 'e', label: 'ICS olarak indir', run: () => exportIcs() });
  bind({ key: 'c', label: 'CSV olarak indir', run: () => exportCsv() });
  bind({ key: 'Escape', label: 'Çalışan analizi iptal et', run: () => cancelAnalysis() });
  bind({ key: '?', label: 'Yardımı göster', run: () => openHelp() });
}

/* ───── Map ───── */

function initMap() {
  map = L.map('ip-map', { center: [39, 35], zoom: 5, zoomControl: true, worldCopyJump: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OSM', maxZoom: 19,
  }).addTo(map);
  const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri', maxZoom: 18 });
  L.control.layers({ 'OSM': map._layers[Object.keys(map._layers)[0]], 'Uydu': satLayer }, {}, { collapsed: true }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
  oppLayers.addTo(map);

  // Click to pick target — auto-run analysis
  map.on('click', (e) => {
    setTarget(e.latlng.lat, e.latlng.lng, '');
    renderLeftContent();
    autoAnalyze();
  });

  setTimeout(() => map.invalidateSize(), 100);
}

function setTarget(lat, lon, name) {
  targetLat = lat;
  targetLon = lon;
  targetName = name || '';
  analysisResults = null;
  selectedOpp = null;
  oppLayers.clearLayers();

  if (targetMarker) map.removeLayer(targetMarker);
  targetMarker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;background:#ff6b35;border:2px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.5)"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7],
    }),
  }).addTo(map);
  targetMarker.bindPopup(`<b>${esc(name) || 'Hedef'}</b><br>${lat.toFixed(5)}°, ${lon.toFixed(5)}°`);

  renderRightContent();
}

/** Auto-run analysis whenever target changes — cancels stale runs. */
function autoAnalyze() {
  const ready = satellites.filter(s => s.enabled && s.satrec && s.tle);
  if (ready.length === 0 || targetLat == null) return;
  if (running) {
    // Bumping the generation flags the current run as stale; the in-flight
    // run will requeue itself when it finishes.
    analysisGeneration++;
  } else {
    runAnalysis();
  }
}

function applyUrlTarget() {
  try {
    const p = new URLSearchParams(window.location.search);
    let lat, lon, name;
    const t = p.get('target');
    if (t) { const parts = t.split(',').map(Number); if (parts.length === 2 && isFinite(parts[0]) && isFinite(parts[1])) { lat = parts[0]; lon = parts[1]; } }
    else if (p.has('lat') && p.has('lon')) { lat = parseFloat(p.get('lat')); lon = parseFloat(p.get('lon')); }
    name = p.get('name') || p.get('label') || '';
    if (lat != null && lon != null && isFinite(lat) && isFinite(lon)) {
      setTarget(lat, lon, name);
      map.flyTo([lat, lon], 6, { duration: 1 });
      renderLeftContent();
      // Wait a tick for TLEs to load, then auto-analyze
      setTimeout(() => autoAnalyze(), 2000);
    }
  } catch { /* ignore */ }
}

/* ───── Satellite management ───── */

function loadSatellitesFromMainApp() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    if (Array.isArray(state.satellites)) {
      for (const s of state.satellites) {
        if (s.noradId && !satellites.find(x => x.noradId === s.noradId)) {
          satellites.push({ noradId: s.noradId, name: s.name || `SAT-${s.noradId}`, color: s.color || TRACK_COLORS[satellites.length % TRACK_COLORS.length], satrec: null, tle: null, enabled: true });
        }
      }
    }
  } catch { /* ignore */ }
  for (const sat of satellites) fetchSatTLE(sat);
  renderLeftContent();
}

async function fetchSatTLE(sat) {
  if (sat.satrec && sat.tle) return;
  try {
    const tle = await fetchTLE(sat.noradId);
    sat.name = tle.name || sat.name;
    sat.tle = { line1: tle.line1, line2: tle.line2, source: tle.source };
    sat.satrec = parseTLE(tle.line1, tle.line2);
  } catch (err) {
    console.warn(`TLE failed for ${sat.noradId}:`, err.message);
  }
  renderLeftContent();
}

async function addSatellite(noradId, name) {
  if (satellites.find(s => s.noradId === noradId)) { toast(`#${noradId} zaten ekli`, 'error'); return; }
  const sat = { noradId, name: name || `SAT-${noradId}`, color: TRACK_COLORS[satellites.length % TRACK_COLORS.length], satrec: null, tle: null, enabled: true };
  satellites.push(sat);
  renderLeftContent();
  await fetchSatTLE(sat);
}

function removeSatellite(noradId) {
  satellites = satellites.filter(s => s.noradId !== noradId);
  analysisResults = null;
  renderLeftContent();
  renderRightContent();
}

/* ───── Analysis ───── */

function cacheKey(sat, settings) {
  // TLE epoch is the dominant freshness signal — bake it in along with the
  // tuning parameters so a settings tweak invalidates the entry.
  const epoch = sat.tle?.line1?.slice(18, 32) || '';
  return `opp:${sat.noradId}:${targetLat.toFixed(4)}:${targetLon.toFixed(4)}:r${settings.MAX_ROLL_DEG}:d${settings.SEARCH_HORIZON_DAYS}:e${epoch}`;
}

async function tryCachedResult(sat, settings) {
  try {
    const v = await idbGet(cacheKey(sat, settings));
    if (!v || v.expiresAt < Date.now()) return null;
    return v.opportunities.map(o => ({ ...o, time: new Date(o.time) }));
  } catch { return null; }
}

async function cacheResult(sat, settings, opps) {
  try {
    await idbSet(cacheKey(sat, settings), {
      expiresAt: Date.now() + CACHE_TTL_MS,
      opportunities: opps.map(o => ({ ...o, time: o.time.toISOString() })),
    });
  } catch {}
}

function cancelAnalysis() {
  if (!running) return;
  if (analysisAbort) {
    try { analysisAbort.abort(); } catch {}
  }
  toast('Analiz iptal edildi', 'error');
}

async function runAnalysis(forceRefresh = false) {
  if (running) {
    // Bump generation so a follow-up run is queued after the current finishes.
    analysisGeneration++;
    return;
  }
  if (targetLat == null || targetLon == null) return;
  const enabled = satellites.filter(s => s.enabled && s.satrec && s.tle);
  if (enabled.length === 0) return;

  running = true;
  const myGen = ++analysisGeneration;
  analysisResults = null;
  selectedOpp = null;
  oppLayers.clearLayers();
  analysisProgress.clear();
  for (const s of enabled) analysisProgress.set(s.noradId, 0);
  renderRightContent();
  renderLeftContent();

  const settings = { MAX_ROLL_DEG: maxRollDeg, SEARCH_HORIZON_DAYS: horizonDays };
  const partials = new Map();
  const tasks = [];

  // Cache lookup first — replay hits immediately so the UI doesn't wait
  // for the worker pool to spin up when the user just toggles a setting.
  const toCompute = [];
  for (const sat of enabled) {
    if (!forceRefresh) {
      const cached = await tryCachedResult(sat, settings);
      if (cached) {
        const result = {
          noradId: sat.noradId, name: sat.name, color: sat.color, satrec: sat.satrec,
          status: cached.length ? 'available' : 'no_opportunity',
          opportunities: cached, fromCache: true,
        };
        partials.set(sat.noradId, result);
        analysisProgress.set(sat.noradId, 1);
        continue;
      }
    }
    toCompute.push(sat);
  }
  renderRightContent();

  analysisAbort = new AbortController();
  try {
    if (toCompute.length > 0) {
      const fresh = await analyzeAllInPool(
        toCompute, targetLat, targetLon, settings,
        {
          signal: analysisAbort.signal,
          onProgress: (id, fraction) => {
            analysisProgress.set(id, fraction);
            if (myGen === analysisGeneration) renderRightContent();
          },
          onOneComplete: (result) => {
            partials.set(result.noradId, result);
            // Cache only successful runs.
            const sat = enabled.find(s => s.noradId === result.noradId);
            if (sat && (result.status === 'available' || result.status === 'no_opportunity')) {
              cacheResult(sat, settings, result.opportunities).catch(() => {});
            }
            if (myGen === analysisGeneration) renderRightContent();
          },
        },
      );
      // Merge fresh into partials (worker results already streamed via callback,
      // but use the sorted batch as the canonical ordering source).
      for (const r of fresh) partials.set(r.noradId, r);
    }
    if (myGen === analysisGeneration) {
      // Reorder by satellite list, then sort: any-opps first then by first time.
      const ordered = enabled
        .map(s => partials.get(s.noradId))
        .filter(Boolean)
        .sort((a, b) => {
          const ah = a.opportunities?.length > 0;
          const bh = b.opportunities?.length > 0;
          if (ah !== bh) return ah ? -1 : 1;
          if (ah && bh) return a.opportunities[0].time.getTime() - b.opportunities[0].time.getTime();
          return 0;
        });
      analysisResults = ordered;
    }
  } catch (err) {
    if (err && err.name !== 'AbortError' && myGen === analysisGeneration) {
      toast(`Analiz hatası: ${err.message}`, 'error');
    }
  }

  running = false;
  analysisAbort = null;
  renderRightContent();
  renderLeftContent();

  // Coalesce — if another generation was requested mid-run, run again.
  if (myGen !== analysisGeneration) runAnalysis();
}

/* ───── Map visualization ───── */

function showOppOnMap(opp, sat) {
  oppLayers.clearLayers();
  selectedOpp = opp;
  selectedOpp._sat = sat;

  // Sub-satellite marker
  L.circleMarker([opp.subSatLat, opp.subSatLon], {
    radius: 6, color: sat.color || '#58a6ff', fillOpacity: 0.8, weight: 2, fillColor: sat.color || '#58a6ff',
  }).addTo(oppLayers).bindPopup(`<b>${esc(sat.name)}</b><br>Alt: ${opp.altKm.toFixed(0)} km`);

  // Line from satellite to target
  L.polyline([[opp.subSatLat, opp.subSatLon], [targetLat, targetLon]], {
    color: '#ff6b35', weight: 2, dashArray: '6 4', opacity: 0.7,
  }).addTo(oppLayers);

  // Ground track ±5 min
  if (sat.satrec) {
    const pts = [];
    const cMs = opp.time.getTime();
    for (let t = cMs - 300000; t <= cMs + 300000; t += 5000) {
      const pos = propagateAt(sat.satrec, new Date(t));
      if (pos) pts.push([pos.lat, pos.lon]);
    }
    if (pts.length > 1) {
      L.polyline(pts, { color: sat.color || '#58a6ff', weight: 2, opacity: 0.6 }).addTo(oppLayers);
    }
  }

  // Sensor frame footprint, oriented by current preset's swath/roll/pitch.
  renderSensorFrame();

  // Draw geometry diagram
  drawGeometryDiagram(opp);

  // Fit view
  const bounds = L.latLngBounds([[opp.subSatLat, opp.subSatLon], [targetLat, targetLon]]);
  map.flyToBounds(bounds.pad(0.5), { maxZoom: 8, duration: 0.8 });
}

/**
 * Draw the sensor footprint rectangle on the map for the currently
 * selected opportunity, using the active sensor preset's swath / frame
 * height and the user's pitch slider. Re-rendered on pitch change.
 */
function renderSensorFrame() {
  if (!selectedOpp || !selectedOpp._sat?.satrec) return;
  // Build a tiny 3-point track around the opportunity time so we can
  // reuse the existing computeFootprintRect helper without duplicating
  // its bearing math.
  const sat = selectedOpp._sat;
  const t = selectedOpp.time.getTime();
  const sample = (ms) => {
    const p = propagateAt(sat.satrec, new Date(ms));
    return p ? { lat: p.lat, lon: p.lon, alt: p.alt, time: new Date(ms) } : null;
  };
  const before = sample(t - 5000);
  const at = sample(t);
  const after = sample(t + 5000);
  if (!before || !at || !after) return;
  const preset = getPreset(presetId);
  const w = preset.swathKm, h = preset.frameHeightKm;
  const rect = computeFootprintRect([before, at, after], 1, w, h, selectedOpp.rollDeg, pitchDeg);
  if (!rect) return;
  // Strip any prior frame layer
  if (oppLayers._frame) {
    oppLayers.removeLayer(oppLayers._frame);
    oppLayers._frame = null;
  }
  const poly = L.polygon(rect.corners, {
    color: '#7ee787', weight: 1.5, fillColor: '#7ee787', fillOpacity: 0.12, dashArray: '4 4',
  }).bindTooltip(`${preset.name} — ${w}×${h} km`, { sticky: true });
  poly.addTo(oppLayers);
  oppLayers._frame = poly;
}

/* ───── 2D Geometry diagram ───── */

function drawGeometryDiagram(opp) {
  if (!geomCanvas) return;
  const canvas = geomCanvas;
  const W = 320, H = 180;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const earthR = W * 0.55;
  const eCX = W / 2, eCY = H + earthR * 0.45;
  const satAltPx = Math.min(H * 0.42, 130);
  const nX = eCX, nY = eCY - earthR;
  const satX = nX, satY = nY - satAltPx;

  const side = opp.rollDeg >= 0 ? 1 : -1;
  const vAngle = Math.min(Math.abs(opp.offNadirDeg) * 6, 55) * (Math.PI / 180);
  const tX = eCX + side * earthR * Math.sin(vAngle);
  const tY = eCY - earthR * Math.cos(vAngle);

  // Earth arc
  ctx.beginPath();
  ctx.arc(eCX, eCY, earthR, Math.PI + 0.6, 2 * Math.PI - 0.6);
  ctx.strokeStyle = '#4a9eff44'; ctx.lineWidth = 2; ctx.stroke();

  // Nadir line
  ctx.beginPath(); ctx.setLineDash([4, 4]); ctx.moveTo(satX, satY); ctx.lineTo(nX, nY);
  ctx.strokeStyle = '#ffffff44'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);

  // Look direction
  ctx.beginPath(); ctx.moveTo(satX, satY); ctx.lineTo(tX, tY);
  ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2; ctx.stroke();

  // Ground arc
  ctx.beginPath(); ctx.arc(eCX, eCY, earthR, -Math.PI / 2, -Math.PI / 2 + vAngle * side);
  ctx.strokeStyle = '#ff6b35'; ctx.lineWidth = 2.5; ctx.stroke();

  // Angle arc
  const arcR = satAltPx * 0.35;
  const nadirA = Math.PI / 2;
  const lookA = Math.atan2(tY - satY, tX - satX);
  ctx.beginPath(); ctx.arc(satX, satY, arcR, nadirA, lookA, lookA < nadirA);
  ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1.5; ctx.stroke();

  // Dots
  ctx.beginPath(); ctx.arc(satX, satY, 6, 0, Math.PI * 2); ctx.fillStyle = '#00d4ff'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(nX, nY, 3, 0, Math.PI * 2); ctx.fillStyle = '#ffffff88'; ctx.fill();
  ctx.beginPath(); ctx.arc(tX, tY, 5, 0, Math.PI * 2); ctx.fillStyle = '#ff6b35'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();

  // Labels
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = '#00d4ff'; ctx.fillText('Uydu', satX, satY - 14);
  ctx.fillStyle = '#ffffffaa'; ctx.font = '10px system-ui'; ctx.fillText(`${opp.altKm.toFixed(0)} km`, satX, satY - 3);
  ctx.fillStyle = '#ff6b35'; ctx.font = '11px system-ui'; ctx.fillText('Hedef', tX + (side > 0 ? 25 : -25), tY - 8);
  const angLX = satX + arcR * 1.3 * Math.cos((nadirA + lookA) / 2);
  const angLY = satY + arcR * 1.3 * Math.sin((nadirA + lookA) / 2);
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(`${opp.offNadirDeg.toFixed(2)}°`, angLX + 4, angLY);
  ctx.fillStyle = '#ff6b35'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
  const gdA = -Math.PI / 2 + vAngle * side / 2;
  const gdX = eCX + (earthR + 16) * Math.cos(gdA);
  const gdY = eCY + (earthR + 16) * Math.sin(gdA);
  ctx.fillText(`${opp.groundDistKm.toFixed(0)} km`, gdX, gdY);
}

/* ───── Left panel build ───── */

function buildHeader() {
  const hdr = el('div', 'ip-header');
  hdr.innerHTML = `<div class="ip-header-row">
    <h1>Goruntuleme Planlayici</h1>
    <div style="display:flex;gap:10px;align-items:center;">
      <a href="./imaging-planner-3d.html" class="ip-back-link" title="3D Beta surumune gec" style="border-color:rgba(210,153,34,0.35);color:#d29922;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        3D <span style="background:rgba(210,153,34,0.25);font-size:8px;padding:1px 4px;border-radius:4px;font-weight:700;letter-spacing:0.3px;">BETA</span>
      </a>
      <a href="./gag.html" class="ip-back-link" title="Genis Alan Goruntuleme" style="border-color:rgba(210,153,34,0.35);color:#d29922;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
        GAG <span style="background:rgba(210,153,34,0.25);font-size:8px;padding:1px 4px;border-radius:4px;font-weight:700;letter-spacing:0.3px;">BETA</span>
      </a>
      <a href="./index.html" class="ip-back-link">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        Ana Sayfa
      </a>
    </div>
  </div>`;
  return hdr;
}

function buildContent() {
  const wrap = el('div', 'ip-content');
  wrap.id = 'ip-left-content';
  return wrap;
}

function renderLeftContent() {
  const c = document.getElementById('ip-left-content');
  if (!c) return;
  c.innerHTML = '';

  // Target section
  c.append(buildTargetSection());
  // Settings section
  c.append(buildSettingsSection());
  // Satellites section
  c.append(buildSatSection());
  // Run button
  c.append(buildRunButton());
}

function buildTargetSection() {
  const sec = el('div', 'ip-section');
  sec.innerHTML = '<div class="ip-section-title">Hedef Nokta</div>';

  // Location search (Nominatim)
  sec.append(buildLocationSearch());

  // Manual coordinate inputs
  sec.append(buildTargetInputs());

  if (targetLat != null && targetLon != null) {
    const card = el('div', 'ip-target-card');
    card.innerHTML = `<div class="ip-target-label">Secili Hedef</div>
      <div class="ip-target-coords">${targetLat.toFixed(5)}°, ${targetLon.toFixed(5)}°</div>
      ${targetName ? `<div class="ip-target-name">${esc(targetName)}</div>` : ''}`;
    sec.append(card);
  } else {
    const hint = el('div', 'ip-hint');
    hint.textContent = 'Arama yapin, haritaya tiklayin veya koordinat girin';
    sec.append(hint);
  }
  return sec;
}

let searchTimeout = null;
let lastSearchTime = 0;

function buildLocationSearch() {
  const wrap = el('div', 'ip-search-wrap');

  const input = el('input', 'ip-input');
  input.type = 'text';
  input.placeholder = 'Konum ara (sehir, adres, yer...)';
  input.autocomplete = 'off';
  input.id = 'ip-search';

  const results = el('div', 'ip-search-results');
  results.style.display = 'none';

  function hide() { results.style.display = 'none'; results.innerHTML = ''; }

  async function search(q) {
    if (q.length < 2) { hide(); return; }
    const now = Date.now();
    const wait = Math.max(0, 1000 - (now - lastSearchTime));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastSearchTime = Date.now();

    results.innerHTML = '<div class="ip-search-item ip-search-loading">Araniyor...</div>';
    results.style.display = 'block';

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'tr' } });
      const data = await res.json();
      results.innerHTML = '';

      if (data.length === 0) {
        results.innerHTML = '<div class="ip-search-item ip-search-loading">Sonuc bulunamadi</div>';
        setTimeout(hide, 2000);
        return;
      }

      for (const place of data) {
        const item = el('div', 'ip-search-item');
        item.textContent = place.display_name;
        item.addEventListener('click', () => {
          const lat = parseFloat(place.lat);
          const lon = parseFloat(place.lon);
          const name = place.display_name.split(',')[0];
          setTarget(lat, lon, name);
          if (place.boundingbox) {
            const bb = place.boundingbox.map(Number);
            map.flyToBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { maxZoom: 10, duration: 1 });
          } else {
            map.flyTo([lat, lon], 10, { duration: 1 });
          }
          input.value = name;
          hide();
          renderLeftContent();
          autoAnalyze();
        });
        results.append(item);
      }
    } catch {
      results.innerHTML = '<div class="ip-search-item ip-search-loading">Arama hatasi</div>';
      setTimeout(hide, 2000);
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const val = input.value.trim();
    if (val) searchTimeout = setTimeout(() => search(val), 600);
    else hide();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hide(); input.blur(); } });

  // Close results when clicking outside
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) hide();
  });

  wrap.append(input, results);
  return wrap;
}

function buildTargetInputs() {
  const row = el('div', 'ip-field-row');

  const latIn = el('input', 'ip-input');
  latIn.type = 'number'; latIn.placeholder = 'Enlem'; latIn.step = '0.0001'; latIn.id = 'ip-lat';
  if (targetLat != null) latIn.value = targetLat.toFixed(5);

  const lonIn = el('input', 'ip-input');
  lonIn.type = 'number'; lonIn.placeholder = 'Boylam'; lonIn.step = '0.0001'; lonIn.id = 'ip-lon';
  if (targetLon != null) lonIn.value = targetLon.toFixed(5);

  const btn = el('button', 'ip-btn ip-btn-sm');
  btn.textContent = 'Ayarla';
  btn.addEventListener('click', () => {
    const la = parseFloat(document.getElementById('ip-lat').value);
    const lo = parseFloat(document.getElementById('ip-lon').value);
    if (!isFinite(la) || !isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) { toast('Gecersiz koordinat', 'error'); return; }
    setTarget(la, lo, '');
    map.flyTo([la, lo], Math.max(map.getZoom(), 6), { duration: 0.8 });
    renderLeftContent();
    autoAnalyze();
  });

  row.append(latIn, lonIn, btn);
  return row;
}

function buildSettingsSection() {
  const sec = el('div', 'ip-section');
  sec.innerHTML = '<div class="ip-section-title">Sensör Profili & Ayarlar</div>';

  // Sensor preset dropdown
  const presetWrap = el('div', 'ip-field');
  const presetLbl = el('label');
  presetLbl.innerHTML = 'Sensör <span class="ip-help" title="Hazır uydu kameraları için tipik açıklık ve roll değerleri. Özel: kendi değerini gir.">?</span>';
  presetWrap.append(presetLbl);
  const presetSel = el('select', 'ip-select');
  for (const p of SENSOR_PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} — ${p.description}`;
    if (p.id === presetId) opt.selected = true;
    presetSel.append(opt);
  }
  presetSel.addEventListener('change', () => {
    applyPreset(presetSel.value);
    renderLeftContent();
    autoAnalyze();
  });
  presetWrap.append(presetSel);
  sec.append(presetWrap);

  // Roll + horizon row
  const r1 = el('div', 'ip-field-row');
  const rollField = el('div', 'ip-field');
  const rollLbl = el('label');
  rollLbl.innerHTML = 'Max Roll (°) <span class="ip-help" title="Uydunun nadirden ne kadar yana eğilebileceği. Yüksek roll = daha çok fırsat ama daha düşük çözünürlük.">?</span>';
  rollField.append(rollLbl);
  const rollIn = el('input', 'ip-input');
  rollIn.type = 'number'; rollIn.value = maxRollDeg; rollIn.min = 1; rollIn.max = 45; rollIn.step = 0.5;
  rollIn.addEventListener('change', () => { maxRollDeg = parseFloat(rollIn.value) || 5; savePrefs(); autoAnalyze(); });
  rollField.append(rollIn);
  r1.append(rollField);

  const dayField = el('div', 'ip-field');
  const dayLbl = el('label');
  dayLbl.textContent = 'Arama (gün)';
  dayField.append(dayLbl);
  const dayIn = el('input', 'ip-input');
  dayIn.type = 'number'; dayIn.value = horizonDays; dayIn.min = 1; dayIn.max = 30; dayIn.step = 1;
  dayIn.addEventListener('change', () => { horizonDays = parseInt(dayIn.value) || 7; savePrefs(); autoAnalyze(); });
  dayField.append(dayIn);
  r1.append(dayField);
  sec.append(r1);

  // Pitch slider — shown only when the active preset supports it.
  const preset = getPreset(presetId);
  if (preset.maxPitchDeg > 0) {
    const pitchField = el('div', 'ip-field');
    const lbl = el('label');
    lbl.innerHTML = `Pitch (°) <span class="ip-pitch-val">${pitchDeg.toFixed(1)}</span>` +
      ` <span class="ip-help" title="İleri/geri eğim. Çoğu sun-sync uydu pitch yapamaz; agile platformlarda time-delayed imaging için kullanılır.">?</span>`;
    pitchField.append(lbl);
    const sl = el('input', 'ip-slider');
    sl.type = 'range';
    sl.min = -preset.maxPitchDeg; sl.max = preset.maxPitchDeg; sl.step = 0.5; sl.value = pitchDeg;
    sl.addEventListener('input', () => {
      pitchDeg = parseFloat(sl.value);
      lbl.querySelector('.ip-pitch-val').textContent = pitchDeg.toFixed(1);
    });
    sl.addEventListener('change', () => { savePrefs(); if (selectedOpp) renderSensorFrame(); });
    pitchField.append(sl);
    sec.append(pitchField);
  }

  // Filter row
  const filterField = el('div', 'ip-field');
  const filterLbl = el('label');
  filterLbl.innerHTML = `Görünür filtre — Min güneş açısı: <span id="ip-sun-val">${filterMinSun}°</span>`;
  filterField.append(filterLbl);
  const sunSlider = el('input', 'ip-slider');
  sunSlider.type = 'range'; sunSlider.min = -18; sunSlider.max = 60; sunSlider.step = 1; sunSlider.value = filterMinSun;
  sunSlider.addEventListener('input', () => {
    filterMinSun = parseInt(sunSlider.value);
    document.getElementById('ip-sun-val').textContent = `${filterMinSun}°`;
  });
  sunSlider.addEventListener('change', () => { savePrefs(); renderRightContent(); });
  filterField.append(sunSlider);
  sec.append(filterField);

  // Sort + timezone row
  const r2 = el('div', 'ip-field-row');
  const sortField = el('div', 'ip-field');
  const sortLbl = el('label');
  sortLbl.textContent = 'Sıralama';
  sortField.append(sortLbl);
  const sortSel = el('select', 'ip-select');
  for (const [val, label] of [['time', 'Zamana göre'], ['score', 'Kaliteye göre'], ['roll', 'Roll (artan)'], ['sun', 'Güneş (azalan)']]) {
    const o = document.createElement('option');
    o.value = val; o.textContent = label;
    if (val === sortBy) o.selected = true;
    sortSel.append(o);
  }
  sortSel.addEventListener('change', () => { sortBy = sortSel.value; savePrefs(); renderRightContent(); });
  sortField.append(sortSel);
  r2.append(sortField);

  const tzField = el('div', 'ip-field');
  const tzLbl = el('label');
  tzLbl.textContent = 'Saat dilimi';
  tzField.append(tzLbl);
  const tzSel = el('select', 'ip-select');
  for (const tz of TIMEZONES) {
    const o = document.createElement('option');
    o.value = tz.id; o.textContent = tz.label;
    if (tz.id === timezone) o.selected = true;
    tzSel.append(o);
  }
  tzSel.addEventListener('change', () => { timezone = tzSel.value; savePrefs(); renderRightContent(); });
  tzField.append(tzSel);
  r2.append(tzField);
  sec.append(r2);

  return sec;
}

function buildSatSection() {
  const sec = el('div', 'ip-section');
  sec.innerHTML = '<div class="ip-section-title">Uydular</div>';

  // Quick add
  const quickRow = el('div', 'ip-field-row');
  quickRow.style.marginBottom = '6px';
  for (const p of PRESETS) {
    const b = el('button', 'ip-btn ip-btn-ghost ip-btn-sm');
    b.textContent = p.name;
    b.addEventListener('click', () => addSatellite(p.noradId, p.name));
    quickRow.append(b);
  }
  sec.append(quickRow);

  // Add by ID
  const addRow = el('div', 'ip-target-row');
  const addIn = el('input', 'ip-input');
  addIn.placeholder = 'NORAD ID veya isim...';
  addIn.id = 'ip-sat-input';
  addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });
  const addBtn = el('button', 'ip-btn ip-btn-sm');
  addBtn.textContent = 'Ekle';
  addBtn.addEventListener('click', async () => {
    const val = addIn.value.trim();
    if (!val) return;
    const num = parseInt(val, 10);
    if (!isNaN(num) && String(num) === val) {
      await addSatellite(num);
    } else {
      // Search by name
      const results = await searchSatellitesByName(val);
      if (results.length > 0) {
        await addSatellite(results[0].noradId, results[0].name);
      } else {
        toast('Uydu bulunamadi', 'error');
      }
    }
    addIn.value = '';
  });
  addRow.append(addIn, addBtn);
  sec.append(addRow);

  // Satellite list
  for (const sat of satellites) {
    const row = el('div', 'ip-sat-item');

    const chk = el('input', 'ip-sat-check');
    chk.type = 'checkbox'; chk.checked = sat.enabled;
    chk.addEventListener('change', () => { sat.enabled = chk.checked; });

    const chip = el('span', 'ip-sat-chip');
    chip.style.background = sat.color;

    const nameEl = el('span', 'ip-sat-name');
    nameEl.textContent = sat.name;
    nameEl.title = sat.name;

    const idEl = el('span', 'ip-sat-id');
    idEl.textContent = `#${sat.noradId}`;

    // TLE freshness badge — surfaces stale data before the user wastes a
    // 30-day worker run on a TLE that's months old.
    const ageWrap = el('span', 'ip-sat-age');
    if (sat.satrec) {
      const age = describeTleAge(sat.satrec);
      ageWrap.classList.add('tle-age-badge', age.level);
      ageWrap.textContent = age.label;
      ageWrap.title = `TLE epoch yaşı: ${age.label}. SGP4 doğruluğu zamanla düşer.`;
    } else {
      ageWrap.textContent = '...';
      ageWrap.style.color = 'var(--ip-warning)';
      ageWrap.style.fontSize = '10px';
    }

    const rmBtn = el('button', 'ip-sat-remove');
    rmBtn.innerHTML = '&times;';
    rmBtn.addEventListener('click', (e) => { e.stopPropagation(); removeSatellite(sat.noradId); });

    row.append(chk, chip, nameEl, idEl, ageWrap, rmBtn);
    sec.append(row);
  }

  if (satellites.length === 0) {
    const hint = el('div', 'ip-hint');
    hint.textContent = 'Analiz icin en az 1 uydu ekleyin';
    sec.append(hint);
  }

  return sec;
}

function buildRunButton() {
  if (running) {
    const btn = el('button', 'ip-btn ip-btn-full ip-btn-danger');
    btn.style.marginTop = '4px';
    btn.textContent = 'Analizi İptal Et (Esc)';
    btn.addEventListener('click', () => cancelAnalysis());
    return btn;
  }
  const btn = el('button', 'ip-btn ip-btn-full');
  btn.style.marginTop = '4px';
  btn.textContent = 'Analizi Yenile (R)';
  btn.disabled = targetLat == null || satellites.filter(s => s.enabled && s.satrec && s.tle).length === 0;
  btn.title = 'Önbelleği yok say ve yeniden çalıştır';
  btn.addEventListener('click', () => runAnalysis(true));
  return btn;
}

/* ───── Right panel ───── */

function buildRightHeader() {
  const hdr = el('div', 'ip-right-header');
  const title = el('h2');
  title.textContent = 'Görüntüleme Fırsatları';
  hdr.append(title);

  const actions = el('div', 'ip-right-actions');

  const helpBtn = el('button', 'ip-btn ip-btn-ghost ip-btn-sm');
  helpBtn.textContent = '?';
  helpBtn.title = 'Klavye kısayolları';
  helpBtn.addEventListener('click', () => openHelp());
  actions.append(helpBtn);

  const icsBtn = el('button', 'ip-btn ip-btn-ghost ip-btn-sm');
  icsBtn.textContent = 'ICS';
  icsBtn.title = 'Takvim olarak indir (.ics) — kısayol: E';
  icsBtn.addEventListener('click', () => exportIcs());
  actions.append(icsBtn);

  const csvBtn = el('button', 'ip-btn ip-btn-ghost ip-btn-sm');
  csvBtn.textContent = 'CSV';
  csvBtn.title = 'CSV olarak indir — kısayol: C';
  csvBtn.addEventListener('click', () => exportCsv());
  actions.append(csvBtn);

  hdr.append(actions);
  return hdr;
}

function buildRightContent() {
  const wrap = el('div', 'ip-right-content');
  wrap.id = 'ip-right-content';
  return wrap;
}

function applyFilters(opps) {
  return opps.filter(o => o.sunElevation >= filterMinSun && Math.abs(o.offNadirDeg) <= maxRollDeg * (filterRollPct / 100));
}

function sortOpps(opps) {
  const arr = opps.slice();
  if (sortBy === 'time') arr.sort((a, b) => a.time - b.time);
  else if (sortBy === 'roll') arr.sort((a, b) => Math.abs(a.offNadirDeg) - Math.abs(b.offNadirDeg));
  else if (sortBy === 'sun') arr.sort((a, b) => b.sunElevation - a.sunElevation);
  else if (sortBy === 'score') {
    arr.forEach(o => { if (!o._score) o._score = computeOpportunityScore(o, { maxRollDeg }); });
    arr.sort((a, b) => b._score.score - a._score.score);
  }
  return arr;
}

function renderRightContent() {
  const c = document.getElementById('ip-right-content');
  if (!c) return;
  c.innerHTML = '';

  if (targetLat == null) {
    c.innerHTML = '<div class="ip-empty">Haritadan hedef seçin veya konum arayın. Ayar değişiklikleri otomatik tetikler.</div>';
    return;
  }

  // Progress + cancel — visible while a run is in flight, even if some
  // satellites have already streamed partial results.
  if (running) {
    c.append(buildProgressUI());
  }

  if (!analysisResults && !running) {
    c.innerHTML = '<div class="ip-empty">Uydu eklendiğinde analiz otomatik başlar. Esc: iptal.</div>';
    return;
  }

  if (running && !analysisResults) {
    return; // progress UI already shown
  }

  // Geometry diagram (reactive to selected opp)
  const geomCard = el('div', 'ip-geom-card');
  geomCard.innerHTML = '<div class="ip-geom-title">Görüntüleme Geometrisi</div>';
  geomCanvas = document.createElement('canvas');
  geomCanvas.width = 320; geomCanvas.height = 180;
  geomCard.append(geomCanvas);
  c.append(geomCard);

  // Summary
  const totalRaw = analysisResults.reduce((s, r) => s + r.opportunities.length, 0);
  const filteredCount = analysisResults.reduce((s, r) => s + applyFilters(r.opportunities).length, 0);
  const avail = analysisResults.filter(r => applyFilters(r.opportunities).length > 0).length;
  const summary = el('div', 'ip-section');
  summary.style.marginBottom = '10px';
  const filterNote = filteredCount !== totalRaw ? ` (${totalRaw - filteredCount} filtrede gizlendi)` : '';
  summary.innerHTML = `<b>${filteredCount}</b> fırsat${filterNote} · <b>${avail}</b>/${analysisResults.length} uydu · <b>${horizonDays}</b> gün · roll ≤ <b>${maxRollDeg}°</b>`;
  summary.style.fontSize = '12px'; summary.style.color = 'var(--ip-text-dim)';
  c.append(summary);

  for (const result of analysisResults) {
    const group = el('div', 'ip-opp-group');

    const header = el('div', 'ip-opp-group-header');
    const chip = el('span', 'ip-opp-group-chip');
    chip.style.background = result.color || '#58a6ff';
    const nameEl = el('span', 'ip-opp-group-name');
    nameEl.textContent = result.name;
    if (result.fromCache) {
      const cachedTag = el('span', 'ip-opp-cached');
      cachedTag.textContent = '(önbellek)';
      cachedTag.title = 'Sonuçlar IndexedDB önbelleğinden geldi';
      nameEl.append(' ', cachedTag);
    }
    const countEl = el('span', 'ip-opp-group-count');
    const filtered = applyFilters(result.opportunities);
    countEl.textContent = result.status === 'no_tle' ? 'TLE yok'
      : filtered.length === result.opportunities.length
        ? `${filtered.length} fırsat`
        : `${filtered.length}/${result.opportunities.length} fırsat`;
    header.append(chip, nameEl, countEl);
    group.append(header);

    if (filtered.length === 0) {
      const empty = el('div', 'ip-opp-noops');
      if (result.status === 'error') empty.textContent = `Hata: ${result.error}`;
      else if (result.opportunities.length > 0) empty.textContent = 'Aktif filtreyle uygun fırsat yok';
      else empty.textContent = 'Bu uydu için fırsat bulunamadı';
      group.append(empty);
    } else {
      for (const opp of sortOpps(filtered)) {
        group.append(buildOppCard(opp, result));
      }
    }

    c.append(group);
  }

  const firstOpp = analysisResults.flatMap(r => applyFilters(r.opportunities))[0];
  if (firstOpp) drawGeometryDiagram(firstOpp);
}

function buildProgressUI() {
  const wrap = el('div', 'ip-progress-wrap');
  const overall = Array.from(analysisProgress.values());
  const avg = overall.length ? overall.reduce((s, x) => s + x, 0) / overall.length : 0;
  const head = el('div', 'ip-progress-head');
  head.innerHTML = `<span>Analiz ediliyor… ${Math.round(avg * 100)}%</span>`;
  const cancelBtn = el('button', 'ip-btn ip-btn-ghost ip-btn-sm');
  cancelBtn.textContent = 'İptal (Esc)';
  cancelBtn.addEventListener('click', () => cancelAnalysis());
  head.append(cancelBtn);
  wrap.append(head);

  const bar = el('div', 'peyker-progress');
  const fill = el('div', 'peyker-progress-bar');
  fill.style.width = `${(avg * 100).toFixed(1)}%`;
  bar.append(fill);
  wrap.append(bar);

  // Per-sat mini lines so the user can see which satellite is lagging.
  const list = el('div', 'ip-progress-list');
  for (const [id, frac] of analysisProgress) {
    const sat = satellites.find(s => s.noradId === id);
    if (!sat) continue;
    const row = el('div', 'ip-progress-row');
    row.innerHTML = `<span class="ip-progress-name">${esc(sat.name)}</span>` +
      `<span class="ip-progress-frac">${Math.round(frac * 100)}%</span>`;
    list.append(row);
  }
  wrap.append(list);
  return wrap;
}

function fmtDate(d) {
  const tz = timezone === 'browser' ? undefined : timezone;
  return d.toLocaleString('tr-TR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtTime(d) {
  const tz = timezone === 'browser' ? undefined : timezone;
  return d.toLocaleString('tr-TR', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function buildOppCard(opp, satResult) {
  const card = el('div', 'ip-opp-card');
  if (selectedOpp === opp) card.classList.add('active');

  if (!opp._score) opp._score = computeOpportunityScore(opp, { maxRollDeg });
  const stars = '★'.repeat(opp._score.stars) + '☆'.repeat(5 - opp._score.stars);

  const rollClass = Math.abs(opp.offNadirDeg) > maxRollDeg * 0.8 ? 'ip-opp-roll high' : 'ip-opp-roll';

  card.innerHTML = `
    <div class="ip-opp-top">
      <span class="ip-opp-time">${fmtTime(opp.time)}</span>
      <span class="ip-opp-stars" title="Kalite skoru ${opp._score.score.toFixed(0)}/100">${stars}</span>
      <span class="ip-opp-date">${fmtDate(opp.time)}</span>
    </div>
    <div class="ip-opp-meta">
      <span title="Sensör roll açısı (işaret yönü)">Roll: <span class="${rollClass}">${opp.rollDeg > 0 ? '+' : ''}${opp.rollDeg.toFixed(2)}°</span></span>
      <span title="Off-nadir: hedefin nadirden açısal sapması">ON: <strong>${opp.offNadirDeg.toFixed(2)}°</strong></span>
      <span>Alt: <strong>${opp.altKm.toFixed(0)} km</strong></span>
      <span>Mesafe: <strong>${opp.groundDistKm.toFixed(0)} km</strong></span>
      <span class="ip-opp-sun" title="Güneş yükseklik açısı">☀ ${opp.sunElevation.toFixed(1)}°</span>
    </div>`;

  card.addEventListener('click', () => {
    showOppOnMap(opp, satResult);
    document.querySelectorAll('.ip-opp-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
  });

  return card;
}

/* ───── Exports ───── */

function tzLabel() {
  if (timezone === 'UTC') return 'UTC';
  if (timezone === 'browser') return 'Local';
  return 'TRT';
}

function exportCsv() {
  if (!analysisResults) { toast('Önce analiz çalıştırın', 'error'); return; }
  const tz = tzLabel();
  const header = `Satellite,NORAD ID,Date (${tz}),Time (${tz}),Roll (deg),Off-Nadir (deg),Score,Altitude (km),Ground Dist (km),Sun Elev (deg),Sub-Sat Lat,Sub-Sat Lon,Target Lat,Target Lon`;
  const rows = [];
  for (const r of analysisResults) {
    for (const o of applyFilters(r.opportunities)) {
      if (!o._score) o._score = computeOpportunityScore(o, { maxRollDeg });
      rows.push([
        `"${r.name}"`, r.noradId, fmtDate(o.time), fmtTime(o.time),
        o.rollDeg.toFixed(2), o.offNadirDeg.toFixed(2), o._score.score.toFixed(0),
        o.altKm.toFixed(0), o.groundDistKm.toFixed(0), o.sunElevation.toFixed(1),
        o.subSatLat.toFixed(4), o.subSatLon.toFixed(4),
        targetLat.toFixed(5), targetLon.toFixed(5),
      ].join(','));
    }
  }
  if (rows.length === 0) { toast('Dışa aktarılacak fırsat yok', 'error'); return; }
  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `imaging_opportunities_${targetLat.toFixed(2)}_${targetLon.toFixed(2)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV indirildi', 'success');
}

function exportIcs() {
  if (!analysisResults) { toast('Önce analiz çalıştırın', 'error'); return; }
  const events = [];
  for (const r of analysisResults) {
    for (const o of applyFilters(r.opportunities)) {
      if (!o._score) o._score = computeOpportunityScore(o, { maxRollDeg });
      const start = o.time;
      const end = new Date(start.getTime() + 60_000); // 1 min nominal window
      const rollSign = o.rollDeg > 0 ? '+' : '';
      const desc = [
        `Hedef: ${targetName || ''} (${targetLat.toFixed(4)}°, ${targetLon.toFixed(4)}°)`,
        `Roll: ${rollSign}${o.rollDeg.toFixed(2)}° (off-nadir ${o.offNadirDeg.toFixed(2)}°)`,
        `Pitch: ${pitchDeg.toFixed(1)}°`,
        `Yükseklik: ${o.altKm.toFixed(0)} km, mesafe ${o.groundDistKm.toFixed(0)} km`,
        `Güneş: ${o.sunElevation.toFixed(1)}°`,
        `Sensör: ${getPreset(presetId).name}`,
        `Skor: ${o._score.score.toFixed(0)}/100 (${o._score.stars}★)`,
      ].join('\n');
      events.push({
        uid: `peyker-opp-${r.noradId}-${start.getTime()}@peyker`,
        start, end,
        summary: `📷 ${r.name} — ${targetName || 'hedef'}`,
        description: desc,
        location: `${targetLat.toFixed(5)}, ${targetLon.toFixed(5)}`,
        alarmMinutes: 10,
      });
    }
  }
  if (events.length === 0) { toast('Dışa aktarılacak fırsat yok', 'error'); return; }
  const ics = buildIcs(events, { calendarName: `Peyker — Görüntüleme (${targetName || 'hedef'})` });
  downloadIcs(`imaging_opportunities_${targetLat.toFixed(2)}_${targetLon.toFixed(2)}.ics`, ics);
  toast(`${events.length} fırsat ICS olarak indirildi`, 'success');
}

/* ───── Helpers ───── */

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, type) {
  document.querySelectorAll('.ip-toast').forEach(t => t.remove());
  const t = el('div', `ip-toast ${type || ''}`);
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

/* ───── Start ───── */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
