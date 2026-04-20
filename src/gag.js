/**
 * GAG — Geniş Alan Görüntüleme (Wide Area Imaging) Beta
 *
 * User draws a polygon on a Leaflet map, picks a satellite, and the tool
 * finds dates when the satellite's swath can fully cover the polygon
 * with ≤5° roll (nadir-like passes).
 *
 * Algorithm:
 *  1. Propagate satellite for N days at coarse steps.
 *  2. For each pass near the polygon's bounding box, compute the swath
 *     corridor (using computeFootprintRect at each timestep).
 *  3. Check whether the polygon is fully inside the corridor.
 *  4. Report qualifying passes with roll, date/time, and coverage %.
 */

import './styles/gag.css';
import { fetchTLE } from './sat/fetch.js';
import { parseTLE, propagateAt, computeFootprintRect } from './sat/propagate.js';
import { SENSOR_PRESETS, getPreset } from './sat/sensor-presets.js';
import { getColor } from './sat/presets.js';
import { sunElevation } from './sat/sun.js';

/* global L */

// ───────── State ─────────
let map = null;
let drawnItems = null;
let drawControl = null;
let polygon = null;        // L.Polygon or null
let polygonCoords = null;  // [[lat,lon], ...] or null
let satellites = [];       // { noradId, name, color, satrec, tle }
let selectedSatIdx = 0;
let presetId = 'custom';
let maxRollDeg = 5;
let searchDays = 14;
let running = false;
let progress = 0;
let results = [];          // { time, rollDeg, altKm, sunElev, coverage, swathCoords }
let selectedResultIdx = -1;
let resultLayers = [];     // Leaflet layers for the selected result

// ───────── Init ─────────
function init() {
  const app = document.getElementById('gag-app');
  if (!app) return;

  const panel = document.createElement('div');
  panel.className = 'gag-panel';
  panel.innerHTML = `
    <div class="gag-header">
      <div style="display:flex;align-items:center;gap:8px;">
        <h1>Geniş Alan Görüntüleme</h1>
        <span class="gag-badge">Beta</span>
      </div>
      <div class="gag-nav">
        <a href="./imaging-planner.html" title="Görüntüleme Planlayıcı">2D</a>
        <a href="./imaging-planner-3d.html" title="3D Planlayıcı">3D</a>
        <a href="./index.html" title="Ana Sayfa">Ana</a>
      </div>
    </div>
    <div id="gag-sections"></div>
  `;
  app.append(panel);

  const mapWrap = document.createElement('div');
  mapWrap.className = 'gag-map-wrap';
  mapWrap.innerHTML = '<div id="gagMap"></div>';
  app.append(mapWrap);

  if (typeof L === 'undefined') {
    showToast('Leaflet yüklenemedi', 'error');
    return;
  }

  initMap();
  renderLeft();
  importMainAppSatellites();
}

function initMap() {
  map = L.map('gagMap', {
    center: [39, 35],
    zoom: 6,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM &copy; CARTO',
    maxZoom: 19,
  }).addTo(map);

  drawnItems = new L.FeatureGroup();
  map.addLayer(drawnItems);

  drawControl = new L.Control.Draw({
    draw: {
      polygon: { shapeOptions: { color: '#58a6ff', weight: 2 } },
      polyline: false,
      circle: false,
      circlemarker: false,
      marker: false,
      rectangle: { shapeOptions: { color: '#58a6ff', weight: 2 } },
    },
    edit: { featureGroup: drawnItems },
  });
  map.addControl(drawControl);

  map.on(L.Draw.Event.CREATED, (e) => {
    drawnItems.clearLayers();
    clearResultLayers();
    const layer = e.layer;
    drawnItems.addLayer(layer);
    polygon = layer;
    polygonCoords = layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
    results = [];
    selectedResultIdx = -1;
    renderLeft();
  });

  map.on(L.Draw.Event.DELETED, () => {
    polygon = null;
    polygonCoords = null;
    results = [];
    selectedResultIdx = -1;
    clearResultLayers();
    renderLeft();
  });

  map.on(L.Draw.Event.EDITED, () => {
    if (polygon) {
      polygonCoords = polygon.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
      results = [];
      selectedResultIdx = -1;
      clearResultLayers();
      renderLeft();
    }
  });
}

// ───────── Auto-import satellites ─────────
async function importMainAppSatellites() {
  try {
    const saved = localStorage.getItem('sat-groundtrack-state');
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.satellites) || parsed.satellites.length === 0) return;

    const toImport = parsed.satellites.filter(
      s => s.noradId && !satellites.find(x => x.noradId === s.noradId)
    );
    if (toImport.length === 0) return;

    showToast(`Ana ekrandan ${toImport.length} uydu aktarılıyor...`, 'info');
    const settled = await Promise.allSettled(
      toImport.map(async (s) => {
        const tle = await fetchTLE(s.noradId);
        const satrec = parseTLE(tle.line1, tle.line2);
        return {
          noradId: s.noradId,
          name: tle.name || s.name,
          color: s.color || getColor(satellites.length),
          satrec,
          tle: { line1: tle.line1, line2: tle.line2 },
        };
      })
    );

    let count = 0;
    for (const r of settled) {
      if (r.status === 'fulfilled' && !satellites.find(x => x.noradId === r.value.noradId)) {
        satellites.push(r.value);
        count++;
      }
    }
    if (count > 0) {
      renderLeft();
      showToast(`${count} uydu aktarıldı`, 'success');
    }
  } catch (err) {
    console.warn('Main app import failed:', err);
  }
}

// ───────── Left panel ─────────
function renderLeft() {
  const c = document.getElementById('gag-sections');
  c.innerHTML = '';
  c.append(buildPolygonSection());
  c.append(buildSatSection());
  c.append(buildSettingsSection());
  c.append(buildRunSection());
  c.append(buildResultsSection());
}

function buildPolygonSection() {
  const sec = el('div', 'gag-section');
  sec.innerHTML = '<div class="gag-section-title">Hedef Alan</div>';

  if (!polygonCoords) {
    const hint = el('div', 'gag-empty');
    hint.textContent = 'Haritada poligon veya dikdörtgen çizerek hedef alanı belirleyin.';
    sec.append(hint);
  } else {
    const info = el('div', 'gag-polygon-info');
    const bbox = polygonBBox(polygonCoords);
    const areaKm2 = approxPolygonAreaKm2(polygonCoords);
    info.innerHTML = `
      <div><span class="label">Köşe sayısı:</span> <span class="value">${polygonCoords.length}</span></div>
      <div><span class="label">Alan:</span> <span class="value">~${areaKm2.toFixed(0)} km²</span></div>
      <div><span class="label">BBox:</span> <span class="value">${bbox.minLat.toFixed(2)}°–${bbox.maxLat.toFixed(2)}° / ${bbox.minLon.toFixed(2)}°–${bbox.maxLon.toFixed(2)}°</span></div>
    `;
    sec.append(info);

    const clearBtn = el('button', 'gag-btn');
    clearBtn.textContent = 'Alanı Temizle';
    clearBtn.style.width = '100%';
    clearBtn.style.marginTop = '8px';
    clearBtn.addEventListener('click', () => {
      drawnItems.clearLayers();
      polygon = null;
      polygonCoords = null;
      results = [];
      selectedResultIdx = -1;
      clearResultLayers();
      renderLeft();
    });
    sec.append(clearBtn);
  }
  return sec;
}

function buildSatSection() {
  const sec = el('div', 'gag-section');
  sec.innerHTML = '<div class="gag-section-title">Uydu</div>';

  const row = el('div', 'gag-input-row');
  const input = el('input', 'gag-input');
  input.type = 'number';
  input.placeholder = 'NORAD ID';
  const addBtn = el('button', 'gag-btn');
  addBtn.textContent = 'Ekle';
  const doAdd = async () => {
    const id = parseInt(input.value, 10);
    if (!Number.isFinite(id) || id <= 0) { showToast('Geçersiz NORAD ID', 'warning'); return; }
    if (satellites.find(s => s.noradId === id)) { showToast('Zaten ekli', 'warning'); return; }
    addBtn.disabled = true;
    try {
      const tle = await fetchTLE(id);
      const satrec = parseTLE(tle.line1, tle.line2);
      satellites.push({
        noradId: id, name: tle.name,
        color: getColor(satellites.length), satrec,
        tle: { line1: tle.line1, line2: tle.line2 },
      });
      input.value = '';
      renderLeft();
      showToast(`${tle.name} eklendi`, 'success');
    } catch (err) {
      showToast(`TLE alınamadı: ${err.message}`, 'error');
    }
    addBtn.disabled = false;
  };
  addBtn.addEventListener('click', doAdd);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  row.append(input, addBtn);
  sec.append(row);

  if (satellites.length === 0) {
    const empty = el('div', 'gag-empty');
    empty.textContent = 'Henüz uydu eklenmedi';
    sec.append(empty);
  } else {
    // Satellite selector
    const sel = el('select', 'gag-select');
    sel.style.marginTop = '8px';
    for (let i = 0; i < satellites.length; i++) {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = `${satellites[i].name} #${satellites[i].noradId}`;
      if (i === selectedSatIdx) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => {
      selectedSatIdx = parseInt(sel.value, 10);
    });
    sec.append(sel);

    for (const sat of satellites) {
      const r = el('div', 'gag-sat-row');
      const chip = el('div', 'gag-sat-chip');
      chip.style.background = sat.color;
      const name = el('div', 'gag-sat-name');
      name.textContent = `${sat.name} #${sat.noradId}`;
      const rm = el('button', 'gag-sat-remove');
      rm.textContent = '×';
      rm.addEventListener('click', () => {
        satellites = satellites.filter(s => s.noradId !== sat.noradId);
        if (selectedSatIdx >= satellites.length) selectedSatIdx = Math.max(0, satellites.length - 1);
        renderLeft();
      });
      r.append(chip, name, rm);
      sec.append(r);
    }
  }

  return sec;
}

function buildSettingsSection() {
  const sec = el('div', 'gag-section');
  sec.innerHTML = '<div class="gag-section-title">Ayarlar</div>';

  // Sensor preset
  const sel = el('select', 'gag-select');
  for (const p of SENSOR_PRESETS) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = `${p.name} (${p.swathKm} km)`;
    if (p.id === presetId) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => { presetId = sel.value; });
  sec.append(sel);

  // Max roll slider
  const rollRow = el('div', 'gag-slider-row');
  rollRow.innerHTML = `<label>Max Roll</label>`;
  const rollSlider = document.createElement('input');
  rollSlider.type = 'range';
  rollSlider.min = 1; rollSlider.max = 30; rollSlider.step = 1;
  rollSlider.value = maxRollDeg;
  const rollVal = el('span', 'gag-slider-val');
  rollVal.textContent = `${maxRollDeg}°`;
  rollSlider.addEventListener('input', () => {
    maxRollDeg = parseInt(rollSlider.value, 10);
    rollVal.textContent = `${maxRollDeg}°`;
  });
  rollRow.append(rollSlider, rollVal);
  sec.append(rollRow);

  // Search days slider
  const dayRow = el('div', 'gag-slider-row');
  dayRow.innerHTML = `<label>Arama Süresi</label>`;
  const daySlider = document.createElement('input');
  daySlider.type = 'range';
  daySlider.min = 1; daySlider.max = 30; daySlider.step = 1;
  daySlider.value = searchDays;
  const dayVal = el('span', 'gag-slider-val');
  dayVal.textContent = `${searchDays}g`;
  daySlider.addEventListener('input', () => {
    searchDays = parseInt(daySlider.value, 10);
    dayVal.textContent = `${searchDays}g`;
  });
  dayRow.append(daySlider, dayVal);
  sec.append(dayRow);

  return sec;
}

function buildRunSection() {
  const sec = el('div', 'gag-section');

  const btn = el('button', 'gag-btn-primary');
  btn.textContent = running ? 'Analiz Ediliyor...' : 'Kapsama Analizi Yap';
  btn.disabled = running || !polygonCoords || satellites.length === 0;
  btn.addEventListener('click', () => runAnalysis());
  sec.append(btn);

  if (running) {
    const prog = el('div', 'gag-progress');
    prog.innerHTML = `
      <div class="gag-progress-bar"><div class="gag-progress-fill" style="width:${(progress * 100).toFixed(0)}%"></div></div>
      <div class="gag-progress-text">%${(progress * 100).toFixed(0)} tamamlandı</div>
    `;
    sec.append(prog);
  }

  return sec;
}

function buildResultsSection() {
  const sec = el('div', 'gag-section');
  if (results.length === 0) return sec;

  const title = el('div', 'gag-results-title');
  title.textContent = `${results.length} kapsama fırsatı bulundu`;
  sec.append(title);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const card = el('div', 'gag-result-card' + (i === selectedResultIdx ? ' selected' : ''));
    card.innerHTML = `
      <div class="gag-result-date">${fmtDate(r.time)} ${fmtTime(r.time)}</div>
      <div class="gag-result-meta">
        <span>Roll ${r.rollDeg.toFixed(1)}°</span>
        <span>Alt ${r.altKm.toFixed(0)} km</span>
        <span>Güneş ${r.sunElev.toFixed(0)}°</span>
      </div>
      <div class="gag-result-meta">
        <span>Kapsama: %${(r.coverage * 100).toFixed(0)}</span>
      </div>
      <div class="gag-result-coverage">
        <div class="gag-result-coverage-fill" style="width:${(r.coverage * 100).toFixed(0)}%"></div>
      </div>
    `;
    card.addEventListener('click', () => selectResult(i));
    sec.append(card);
  }

  return sec;
}

// ───────── Analysis ─────────
async function runAnalysis() {
  if (!polygonCoords || satellites.length === 0) return;
  running = true;
  progress = 0;
  results = [];
  selectedResultIdx = -1;
  clearResultLayers();
  renderLeft();

  const sat = satellites[selectedSatIdx];
  if (!sat) { running = false; renderLeft(); return; }

  const preset = getPreset(presetId);
  const bbox = polygonBBox(polygonCoords);
  const now = new Date();
  const endMs = now.getTime() + searchDays * 86400_000;
  const coarseStepMs = 10_000; // 10s steps
  const totalSteps = (endMs - now.getTime()) / coarseStepMs;

  const candidatePasses = [];
  let inWindow = false;
  let windowBest = null;

  for (let tMs = now.getTime(); tMs <= endMs; tMs += coarseStepMs) {
    const t = new Date(tMs);
    const pos = propagateAt(sat.satrec, t);
    if (!pos) continue;

    // Quick check: is the sub-sat point within an expanded bbox?
    const margin = 15; // degrees — generous for off-nadir
    const nearPoly = pos.lat >= bbox.minLat - margin && pos.lat <= bbox.maxLat + margin &&
                     pos.lon >= bbox.minLon - margin && pos.lon <= bbox.maxLon + margin;

    if (nearPoly) {
      // Compute off-nadir to polygon center
      const cLat = (bbox.minLat + bbox.maxLat) / 2;
      const cLon = (bbox.minLon + bbox.maxLon) / 2;
      const dist = haversineKm(pos.lat, pos.lon, cLat, cLon);
      const offNadir = Math.atan2(dist, pos.alt) * 180 / Math.PI;

      if (offNadir <= maxRollDeg + 10) {
        if (!inWindow) {
          inWindow = true;
          windowBest = { t, pos, offNadir };
        } else if (offNadir < windowBest.offNadir) {
          windowBest = { t, pos, offNadir };
        }
      } else if (inWindow) {
        if (windowBest.offNadir <= maxRollDeg + 5) {
          candidatePasses.push(windowBest);
        }
        inWindow = false;
        windowBest = null;
      }
    } else if (inWindow) {
      if (windowBest.offNadir <= maxRollDeg + 5) {
        candidatePasses.push(windowBest);
      }
      inWindow = false;
      windowBest = null;
    }

    // Progress
    const stepIdx = (tMs - now.getTime()) / coarseStepMs;
    if (stepIdx % 500 === 0) {
      progress = stepIdx / totalSteps * 0.6;
      updateProgress();
      await yieldToUI();
    }
  }

  if (inWindow && windowBest && windowBest.offNadir <= maxRollDeg + 5) {
    candidatePasses.push(windowBest);
  }

  // Deduplicate passes within 10 min
  const dedupPasses = [];
  for (const p of candidatePasses) {
    const isDup = dedupPasses.some(
      d => Math.abs(d.t.getTime() - p.t.getTime()) < 600_000
    );
    if (!isDup) dedupPasses.push(p);
  }

  // Evaluate each pass: compute swath corridor coverage over the polygon
  for (let pi = 0; pi < dedupPasses.length; pi++) {
    const pass = dedupPasses[pi];
    progress = 0.6 + (pi / dedupPasses.length) * 0.4;
    updateProgress();
    await yieldToUI();

    const result = evaluatePassCoverage(sat, pass, preset);
    if (result && result.coverage >= 0.5) {
      results.push(result);
    }
  }

  results.sort((a, b) => b.coverage - a.coverage);
  if (results.length > 30) results.length = 30;

  running = false;
  progress = 1;
  renderLeft();

  if (results.length === 0) {
    showToast(`${searchDays} gün içinde kapsama bulunamadı — roll açısını artırın`, 'warning');
  } else {
    showToast(`${results.length} kapsama fırsatı bulundu`, 'success');
    selectResult(0);
  }
}

function evaluatePassCoverage(sat, pass, preset) {
  const windowSec = 120; // ±2 min around closest approach
  const stepSec = 2;
  const swathCoords = []; // for visualization: [[lat,lon],...]
  const leftEdge = [];
  const rightEdge = [];

  // Determine roll sign: which side of the track is the polygon center?
  const cLat = (polygonBBox(polygonCoords).minLat + polygonBBox(polygonCoords).maxLat) / 2;
  const cLon = (polygonBBox(polygonCoords).minLon + polygonBBox(polygonCoords).maxLon) / 2;
  const heading = satHeadingAt(sat.satrec, pass.t);
  const pos0 = propagateAt(sat.satrec, pass.t);
  if (!pos0) return null;

  const cosLat = Math.cos(pos0.lat * Math.PI / 180);
  const dN = (cLat - pos0.lat) * 111.0;
  const dE = (cLon - pos0.lon) * 111.0 * cosLat;
  const crossTrack = dE * Math.cos(heading) - dN * Math.sin(heading);
  const rollSign = crossTrack >= 0 ? 1 : -1;

  // Compute the off-nadir to center
  const dist = haversineKm(pos0.lat, pos0.lon, cLat, cLon);
  const rollDeg = Math.atan2(dist, pos0.alt) * 180 / Math.PI;
  if (rollDeg > maxRollDeg) return null;

  const signedRoll = rollSign * rollDeg;

  for (let dt = -windowSec; dt <= windowSec; dt += stepSec) {
    const t = new Date(pass.t.getTime() + dt * 1000);
    const pre = propagateAt(sat.satrec, new Date(t.getTime() - 1000));
    const cur = propagateAt(sat.satrec, t);
    const post = propagateAt(sat.satrec, new Date(t.getTime() + 1000));
    if (!pre || !cur || !post) continue;

    const trackPts = [
      { time: new Date(t.getTime() - 1000), lat: pre.lat, lon: pre.lon, alt: pre.alt },
      { time: t, lat: cur.lat, lon: cur.lon, alt: cur.alt },
      { time: new Date(t.getTime() + 1000), lat: post.lat, lon: post.lon, alt: post.alt },
    ];
    const rect = computeFootprintRect(
      trackPts, 1, preset.swathKm, preset.frameHeightKm, signedRoll, 0
    );
    if (!rect || !rect.corners || rect.corners.length < 4) continue;

    leftEdge.push(rect.corners[0]);
    rightEdge.push(rect.corners[1]);
  }

  if (leftEdge.length < 3) return null;

  // Build corridor polygon
  const corridor = [];
  for (const c of leftEdge) corridor.push(c);
  for (let i = rightEdge.length - 1; i >= 0; i--) corridor.push(rightEdge[i]);

  // Check coverage: what fraction of polygon vertices are inside the corridor?
  let inside = 0;
  for (const pt of polygonCoords) {
    if (pointInPolygon(pt, corridor)) inside++;
  }

  // Also check a grid of sample points within the polygon's bbox
  const bbox = polygonBBox(polygonCoords);
  const gridStep = Math.max(0.02, Math.min(0.2, (bbox.maxLat - bbox.minLat) / 10));
  let gridTotal = 0;
  let gridInside = 0;
  for (let lat = bbox.minLat; lat <= bbox.maxLat; lat += gridStep) {
    for (let lon = bbox.minLon; lon <= bbox.maxLon; lon += gridStep) {
      if (!pointInPolygon([lat, lon], polygonCoords)) continue;
      gridTotal++;
      if (pointInPolygon([lat, lon], corridor)) gridInside++;
    }
  }

  const coverage = gridTotal > 0 ? gridInside / gridTotal : (inside / polygonCoords.length);

  const sunElev = sunElevation(cLat, cLon, pass.t);

  return {
    time: pass.t,
    rollDeg,
    altKm: pos0.alt,
    sunElev,
    coverage,
    corridorCoords: corridor,
    satName: sat.name,
    satColor: sat.color,
  };
}

// ───────── Result selection + visualization ─────────
function selectResult(idx) {
  if (idx < 0 || idx >= results.length) return;
  selectedResultIdx = idx;
  clearResultLayers();

  const r = results[idx];

  // Draw corridor on map
  if (r.corridorCoords && r.corridorCoords.length > 2) {
    const latLngs = r.corridorCoords.map(c => [c[0], c[1]]);
    const corridorPoly = L.polygon(latLngs, {
      color: r.satColor || '#58a6ff',
      weight: 2,
      fillColor: r.satColor || '#58a6ff',
      fillOpacity: 0.15,
      dashArray: '6 4',
    });
    corridorPoly.addTo(map);
    resultLayers.push(corridorPoly);

    // Fit map to show both polygon and corridor
    const group = L.featureGroup([corridorPoly, ...drawnItems.getLayers()]);
    map.fitBounds(group.getBounds().pad(0.2));
  }

  renderLeft();
}

function clearResultLayers() {
  for (const l of resultLayers) map.removeLayer(l);
  resultLayers.length = 0;
}

// ───────── Helpers ─────────
function el(tag, cls) {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  return x;
}

function fmtDate(d) {
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtTime(d) {
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function polygonBBox(coords) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const [lat, lon] of coords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

function approxPolygonAreaKm2(coords) {
  const n = coords.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const lat1 = coords[i][0] * Math.PI / 180;
    const lat2 = coords[j][0] * Math.PI / 180;
    const dLon = (coords[j][1] - coords[i][1]) * Math.PI / 180;
    area += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  area = Math.abs(area * 6371 * 6371 / 2);
  return area;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function satHeadingAt(satrec, t) {
  const now = propagateAt(satrec, t);
  const ahead = propagateAt(satrec, new Date(t.getTime() + 1000));
  if (!now || !ahead) return 0;
  const phi1 = now.lat * Math.PI / 180;
  const phi2 = ahead.lat * Math.PI / 180;
  const dLam = (ahead.lon - now.lon) * Math.PI / 180;
  const y = Math.sin(dLam) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
  return Math.atan2(y, x);
}

function pointInPolygon(pt, poly) {
  const [py, px] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function updateProgress() {
  const fill = document.querySelector('.gag-progress-fill');
  const text = document.querySelector('.gag-progress-text');
  if (fill) fill.style.width = `${(progress * 100).toFixed(0)}%`;
  if (text) text.textContent = `%${(progress * 100).toFixed(0)} tamamlandı`;
}

function showToast(message, type = 'info') {
  document.querySelectorAll('.gag-toast').forEach(t => t.remove());
  const t = el('div', `gag-toast ${type}`);
  t.textContent = message;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

// ───────── Start ─────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
