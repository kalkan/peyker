/**
 * Imaging Planner 3D (Beta) — Cesium-based 3D visualization of
 * imaging opportunities.
 *
 * Reuses the existing opportunity-finding engine (propagate.js,
 * opportunity.js, sensor-presets, opportunity-score) but renders
 * everything on a 3D globe with:
 *   - target pin
 *   - per-satellite orbital ground tracks
 *   - opportunity markers at sub-satellite points
 *   - selected opportunity: 3D satellite, sensor footprint polygon,
 *     satellite-to-target pointing line, animated time scrub via
 *     Cesium's built-in clock
 *
 * Cesium is loaded from CDN (declared in imaging-planner-3d-src.html)
 * so the main bundle stays small. This is a beta companion to the 2D
 * planner; the 2D version remains the primary tool.
 */

import './styles/imaging-planner-3d.css';
import { fetchTLE } from './sat/fetch.js';
import { parseTLE, propagateAt, computeFootprintRect } from './sat/propagate.js';
import { findOpportunities, DEFAULT_OPPORTUNITY_CONFIG } from './sat/opportunity.js';
import { SENSOR_PRESETS, getPreset } from './sat/sensor-presets.js';
import { computeOpportunityScore } from './sat/opportunity-score.js';
import { getColor } from './sat/presets.js';

/* global Cesium */

// ───────── State ─────────
let viewer = null;
let targetLat = null, targetLon = null, targetName = null;
let satellites = []; // { noradId, name, color, satrec, tle }
let presetId = 'sentinel-2';
let rollDeg = 10;
let pitchDeg = 0;
let opportunities = []; // flattened across all satellites
let selectedOppIdx = -1;
let running = false;
let progress = 0;

// Cesium entities we manage
let targetEntity = null;
const orbitEntities = new Map(); // noradId -> Entity (polyline)
const oppMarkerEntities = []; // Entity[]
let satEntity = null;
let footprintEntity = null;
let pointingLineEntity = null;

// ───────── Init ─────────
function init() {
  const app = document.getElementById('imaging-planner-3d-app');
  if (!app) return;

  // Build left panel
  const panel = document.createElement('div');
  panel.className = 'ip3-panel';
  panel.innerHTML = `
    <div class="ip3-header">
      <div style="display:flex;align-items:center;gap:8px;">
        <h1>Planlayıcı 3D</h1>
        <span class="ip3-badge-beta">Beta</span>
      </div>
      <div class="ip3-nav">
        <a href="./imaging-planner.html" title="2D Görünüme Dön">2D</a>
        <a href="./index.html" title="Ana Sayfa">Ana</a>
      </div>
    </div>
    <div id="ip3-sections"></div>
  `;
  app.append(panel);

  // Viewer container
  const viewerWrap = document.createElement('div');
  viewerWrap.className = 'ip3-viewer';
  viewerWrap.innerHTML = '<div id="cesiumContainer"></div><div id="ip3-opp-strip" class="ip3-opp-strip"></div>';
  app.append(viewerWrap);

  if (typeof Cesium === 'undefined') {
    showToast('Cesium yüklenemedi (ağ bağlantısını kontrol edin)', 'error');
    document.getElementById('cesiumContainer').innerHTML =
      '<div style="padding:40px;color:#f85149;">Cesium yüklenemedi — internet bağlantısını kontrol edin.</div>';
    return;
  }

  initCesium();
  renderLeft();
  applyUrlTarget();
}

function initCesium() {
  // Suppress Ion token warnings; use OpenStreetMap for imagery (no token needed).
  Cesium.Ion.defaultAccessToken = '';

  viewer = new Cesium.Viewer('cesiumContainer', {
    baseLayer: new Cesium.ImageryLayer(
      new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })
    ),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: true,
    sceneModePicker: true,
    navigationHelpButton: false,
    animation: true,
    timeline: true,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: true,
    shouldAnimate: false,
  });

  viewer.scene.globe.enableLighting = true;
  viewer.scene.skyAtmosphere.show = true;

  // Default camera view over Turkey
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(35, 39, 10_000_000),
    duration: 0,
  });

  // Click map to set target
  viewer.screenSpaceEventHandler.setInputAction((click) => {
    const cart = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
    if (!cart) return;
    const carto = Cesium.Cartographic.fromCartesian(cart);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    const lon = Cesium.Math.toDegrees(carto.longitude);
    setTarget(lat, lon, 'Harita noktası');
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

// ───────── URL target ─────────
function applyUrlTarget() {
  try {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('target');
    if (t) {
      const [lat, lon] = t.split(',').map(s => parseFloat(s.trim()));
      if (isFinite(lat) && isFinite(lon)) {
        setTarget(lat, lon, params.get('name') || null);
      }
    }
  } catch { /* ignore */ }
}

// ───────── Left panel ─────────
function renderLeft() {
  const c = document.getElementById('ip3-sections');
  c.innerHTML = '';

  c.append(buildTargetSection());
  c.append(buildSatSection());
  c.append(buildSettingsSection());
  c.append(buildRunSection());
}

function buildTargetSection() {
  const sec = el('div', 'ip3-section');
  sec.innerHTML = '<div class="ip3-section-title">Hedef Nokta</div>';

  const wrap = el('div', 'ip3-search-wrap');
  const input = el('input', 'ip3-input');
  input.type = 'text';
  input.placeholder = 'Konum ara (şehir, yer...)';
  const results = el('div', 'ip3-search-results');
  results.style.display = 'none';

  let searchT = null;
  input.addEventListener('input', () => {
    clearTimeout(searchT);
    const q = input.value.trim();
    if (!q) { results.style.display = 'none'; return; }
    searchT = setTimeout(() => nominatimSearch(q, results, input), 500);
  });
  wrap.append(input, results);
  sec.append(wrap);

  // Manual coords
  const row = el('div', 'ip3-input-row');
  const latInp = el('input', 'ip3-input');
  latInp.type = 'number'; latInp.step = '0.0001'; latInp.placeholder = 'Enlem';
  latInp.value = targetLat != null ? targetLat.toFixed(4) : '';
  const lonInp = el('input', 'ip3-input');
  lonInp.type = 'number'; lonInp.step = '0.0001'; lonInp.placeholder = 'Boylam';
  lonInp.value = targetLon != null ? targetLon.toFixed(4) : '';
  const setBtn = el('button', 'ip3-btn');
  setBtn.textContent = 'Ayarla';
  setBtn.addEventListener('click', () => {
    const la = parseFloat(latInp.value), lo = parseFloat(lonInp.value);
    if (isFinite(la) && isFinite(lo) && la >= -90 && la <= 90 && lo >= -180 && lo <= 180) {
      setTarget(la, lo, 'Manuel koordinat');
    } else {
      showToast('Geçersiz koordinat', 'warning');
    }
  });
  row.append(latInp, lonInp, setBtn);
  sec.append(row);

  if (targetLat != null) {
    const card = el('div', 'ip3-target-card');
    card.innerHTML = `
      <div class="ip3-target-coords">${targetLat.toFixed(5)}°, ${targetLon.toFixed(5)}°</div>
      ${targetName ? `<div class="ip3-target-name">${esc(targetName)}</div>` : ''}
    `;
    sec.append(card);
  } else {
    const hint = el('div', 'ip3-empty');
    hint.textContent = '3D haritada bir noktaya tıklayarak da hedef seçebilirsiniz';
    sec.append(hint);
  }

  return sec;
}

async function nominatimSearch(query, results, input) {
  results.innerHTML = '<div class="ip3-search-item ip3-search-loading">Aranıyor...</div>';
  results.style.display = 'block';
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'tr' } });
    const data = await res.json();
    results.innerHTML = '';
    if (data.length === 0) {
      results.innerHTML = '<div class="ip3-search-item ip3-search-loading">Sonuç yok</div>';
      return;
    }
    for (const p of data) {
      const item = el('div', 'ip3-search-item');
      item.textContent = p.display_name;
      item.addEventListener('click', () => {
        setTarget(parseFloat(p.lat), parseFloat(p.lon), p.display_name.split(',')[0]);
        input.value = '';
        results.style.display = 'none';
      });
      results.append(item);
    }
  } catch {
    results.innerHTML = '<div class="ip3-search-item ip3-search-loading">Arama hatası</div>';
  }
}

function buildSatSection() {
  const sec = el('div', 'ip3-section');
  sec.innerHTML = '<div class="ip3-section-title">Uydular</div>';

  // Add satellite by NORAD ID
  const row = el('div', 'ip3-input-row');
  const input = el('input', 'ip3-input');
  input.type = 'number';
  input.placeholder = 'NORAD ID (örn. 25544)';
  const addBtn = el('button', 'ip3-btn');
  addBtn.textContent = 'Ekle';
  const doAdd = async () => {
    const id = parseInt(input.value, 10);
    if (!Number.isFinite(id) || id <= 0) { showToast('Geçersiz NORAD ID', 'warning'); return; }
    if (satellites.find(s => s.noradId === id)) { showToast('Bu uydu zaten eklenmiş', 'warning'); return; }
    addBtn.disabled = true; addBtn.textContent = '...';
    try {
      const tle = await fetchTLE(id);
      const satrec = parseTLE(tle.line1, tle.line2);
      satellites.push({
        noradId: id, name: tle.name,
        color: getColor(satellites.length),
        satrec,
        tle: { line1: tle.line1, line2: tle.line2 },
      });
      input.value = '';
      renderLeft();
      showToast(`${tle.name} eklendi`, 'success');
    } catch (err) {
      showToast(`TLE alınamadı: ${err.message}`, 'error');
    }
    addBtn.disabled = false; addBtn.textContent = 'Ekle';
  };
  addBtn.addEventListener('click', doAdd);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  row.append(input, addBtn);
  sec.append(row);

  // Presets (quick-add)
  const presets = [
    { id: 25544, name: 'ISS' },
    { id: 43013, name: 'NOAA 20' },
    { id: 40069, name: 'METEOR-M 2' },
    { id: 39084, name: 'Landsat-8' },
  ];
  const chipsRow = el('div', 'ip3-input-row');
  chipsRow.style.flexWrap = 'wrap';
  chipsRow.style.marginTop = '6px';
  for (const p of presets) {
    const btn = el('button', 'ip3-btn');
    btn.textContent = p.name;
    btn.style.fontSize = '11px';
    btn.style.padding = '4px 9px';
    btn.addEventListener('click', async () => {
      if (satellites.find(s => s.noradId === p.id)) return;
      input.value = p.id;
      await doAdd();
    });
    chipsRow.append(btn);
  }
  sec.append(chipsRow);

  // List
  if (satellites.length === 0) {
    const empty = el('div', 'ip3-empty');
    empty.textContent = 'Henüz uydu eklenmedi';
    sec.append(empty);
  } else {
    for (const sat of satellites) {
      const row = el('div', 'ip3-sat-row');
      const chip = el('div', 'ip3-sat-chip');
      chip.style.background = sat.color;
      const name = el('div', 'ip3-sat-name');
      name.textContent = `${sat.name} #${sat.noradId}`;
      const rm = el('button', 'ip3-sat-remove');
      rm.textContent = '×';
      rm.title = 'Kaldır';
      rm.addEventListener('click', () => {
        satellites = satellites.filter(s => s.noradId !== sat.noradId);
        renderLeft();
      });
      row.append(chip, name, rm);
      sec.append(row);
    }
  }

  return sec;
}

function buildSettingsSection() {
  const sec = el('div', 'ip3-section');
  sec.innerHTML = '<div class="ip3-section-title">Sensör Ayarları</div>';

  const preset = getPreset(presetId);

  const sel = el('select', 'ip3-select');
  for (const p of SENSOR_PRESETS) {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = `${p.name} (${p.swathKm} km)`;
    if (p.id === presetId) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => {
    presetId = sel.value;
    const p = getPreset(presetId);
    rollDeg = Math.min(rollDeg, p.maxRollDeg);
    pitchDeg = p.maxPitchDeg === 0 ? 0 : Math.min(pitchDeg, p.maxPitchDeg);
    renderLeft();
  });
  sec.append(sel);

  // Roll slider
  const rollRow = el('div', 'ip3-slider-row');
  rollRow.innerHTML = `<label>Roll ±</label>`;
  const rollSlider = document.createElement('input');
  rollSlider.type = 'range';
  rollSlider.min = 0; rollSlider.max = preset.maxRollDeg; rollSlider.step = 1;
  rollSlider.value = rollDeg;
  const rollVal = el('span', 'ip3-slider-val');
  rollVal.textContent = `${rollDeg}°`;
  rollSlider.addEventListener('input', () => {
    rollDeg = parseInt(rollSlider.value, 10);
    rollVal.textContent = `${rollDeg}°`;
  });
  rollRow.append(rollSlider, rollVal);
  sec.append(rollRow);

  // Pitch slider (only if preset supports it)
  if (preset.maxPitchDeg > 0) {
    const pitchRow = el('div', 'ip3-slider-row');
    pitchRow.innerHTML = `<label>Pitch ±</label>`;
    const pitchSlider = document.createElement('input');
    pitchSlider.type = 'range';
    pitchSlider.min = 0; pitchSlider.max = preset.maxPitchDeg; pitchSlider.step = 1;
    pitchSlider.value = pitchDeg;
    const pitchVal = el('span', 'ip3-slider-val');
    pitchVal.textContent = `${pitchDeg}°`;
    pitchSlider.addEventListener('input', () => {
      pitchDeg = parseInt(pitchSlider.value, 10);
      pitchVal.textContent = `${pitchDeg}°`;
    });
    pitchRow.append(pitchSlider, pitchVal);
    sec.append(pitchRow);
  }

  return sec;
}

function buildRunSection() {
  const sec = el('div', 'ip3-section');

  const btn = el('button', 'ip3-btn-primary');
  btn.textContent = running ? 'Analiz Ediliyor...' : 'Fırsatları Bul';
  btn.disabled = running || targetLat == null || satellites.length === 0;
  btn.addEventListener('click', () => runAnalysis());
  sec.append(btn);

  if (running) {
    const prog = el('div', 'ip3-progress');
    prog.innerHTML = `
      <div class="ip3-progress-bar"><div class="ip3-progress-fill" style="width:${(progress * 100).toFixed(0)}%"></div></div>
      <div class="ip3-progress-text">%${(progress * 100).toFixed(0)} tamamlandı</div>
    `;
    sec.append(prog);
  }

  if (opportunities.length > 0) {
    const summary = el('div', 'ip3-empty');
    summary.style.color = '#7ee787';
    summary.textContent = `${opportunities.length} fırsat bulundu`;
    sec.append(summary);
  }

  return sec;
}

// ───────── Target setter ─────────
function setTarget(lat, lon, name) {
  targetLat = lat;
  targetLon = lon;
  targetName = name || null;

  if (targetEntity) viewer.entities.remove(targetEntity);
  targetEntity = viewer.entities.add({
    name: name || 'Hedef',
    position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
    billboard: {
      image: targetPinDataUrl(),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      scale: 1,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
    label: {
      text: name || `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`,
      font: '12px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -46),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, 1_500_000),
    duration: 1.5,
  });

  renderLeft();
}

function targetPinDataUrl() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 32 44">
    <path d="M16 0C7.2 0 0 7.2 0 16c0 10 16 28 16 28s16-18 16-28C32 7.2 24.8 0 16 0z" fill="#e04040"/>
    <circle cx="16" cy="16" r="6" fill="#fff"/>
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

// ───────── Analysis ─────────
async function runAnalysis() {
  if (targetLat == null || satellites.length === 0) return;
  running = true;
  progress = 0;
  selectedOppIdx = -1;
  opportunities = [];
  clearOppVisuals();
  renderLeft();
  updateOppStrip();

  const settings = {
    ...DEFAULT_OPPORTUNITY_CONFIG,
    MAX_ROLL_DEG: rollDeg,
    SEARCH_HORIZON_DAYS: 7,
  };

  const totalSats = satellites.length;

  for (let i = 0; i < satellites.length; i++) {
    const sat = satellites[i];
    try {
      const opps = await findOpportunities(
        sat.satrec, targetLat, targetLon, settings,
        (p) => {
          progress = (i + p) / totalSats;
          updateProgress();
        }
      );
      for (const o of opps) {
        const { score, stars } = computeOpportunityScore(o, { maxRollDeg: rollDeg });
        opportunities.push({ ...o, sat, score, stars });
      }
    } catch (err) {
      console.warn(`Analiz hatası ${sat.name}:`, err);
    }
  }

  opportunities.sort((a, b) => a.time.getTime() - b.time.getTime());
  running = false;
  progress = 1;

  drawOrbitTracks();
  drawOppMarkers();
  renderLeft();
  updateOppStrip();

  if (opportunities.length > 0) {
    selectOpp(0);
  } else {
    showToast('Hiç fırsat bulunamadı — roll açısını artırmayı deneyin', 'warning');
  }
}

function updateProgress() {
  const fill = document.querySelector('.ip3-progress-fill');
  const text = document.querySelector('.ip3-progress-text');
  if (fill) fill.style.width = `${(progress * 100).toFixed(0)}%`;
  if (text) text.textContent = `%${(progress * 100).toFixed(0)} tamamlandı`;
}

// ───────── Drawing ─────────
function drawOrbitTracks() {
  // Remove previous
  for (const e of orbitEntities.values()) viewer.entities.remove(e);
  orbitEntities.clear();

  // For each sat, draw 24h track
  const start = new Date();
  const durationH = 24;
  const stepS = 120;

  for (const sat of satellites) {
    const points = [];
    for (let t = 0; t <= durationH * 3600; t += stepS) {
      const date = new Date(start.getTime() + t * 1000);
      const pos = propagateAt(sat.satrec, date);
      if (pos) points.push(pos.lon, pos.lat, pos.alt * 1000);
    }
    if (points.length < 6) continue;

    const color = cesiumColor(sat.color, 0.7);
    const entity = viewer.entities.add({
      name: sat.name + ' yörüngesi',
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights(points),
        width: 2,
        material: color,
        clampToGround: false,
      },
    });
    orbitEntities.set(sat.noradId, entity);
  }
}

function drawOppMarkers() {
  for (const e of oppMarkerEntities) viewer.entities.remove(e);
  oppMarkerEntities.length = 0;

  for (let i = 0; i < opportunities.length; i++) {
    const o = opportunities[i];
    const e = viewer.entities.add({
      name: `Fırsat ${i + 1}`,
      position: Cesium.Cartesian3.fromDegrees(o.subSatLon, o.subSatLat, 0),
      point: {
        pixelSize: 10,
        color: cesiumColor(o.sat.color, 0.9),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      description: oppDescription(o, i),
    });
    oppMarkerEntities.push(e);
  }
}

function clearOppVisuals() {
  for (const e of orbitEntities.values()) viewer.entities.remove(e);
  orbitEntities.clear();
  for (const e of oppMarkerEntities) viewer.entities.remove(e);
  oppMarkerEntities.length = 0;
  if (satEntity) { viewer.entities.remove(satEntity); satEntity = null; }
  if (footprintEntity) { viewer.entities.remove(footprintEntity); footprintEntity = null; }
  if (pointingLineEntity) { viewer.entities.remove(pointingLineEntity); pointingLineEntity = null; }
}

// ───────── Opportunity selection + 3D scene ─────────
function selectOpp(idx) {
  if (idx < 0 || idx >= opportunities.length) return;
  selectedOppIdx = idx;
  const opp = opportunities[idx];

  renderOppOnGlobe(opp);
  updateOppStrip();
  animateAroundOpp(opp);
}

function renderOppOnGlobe(opp) {
  // Remove previous selection visuals
  if (satEntity) { viewer.entities.remove(satEntity); satEntity = null; }
  if (footprintEntity) { viewer.entities.remove(footprintEntity); footprintEntity = null; }
  if (pointingLineEntity) { viewer.entities.remove(pointingLineEntity); pointingLineEntity = null; }

  const satPos = propagateAt(opp.sat.satrec, opp.time);
  if (!satPos) return;

  const satCart = Cesium.Cartesian3.fromDegrees(satPos.lon, satPos.lat, satPos.alt * 1000);
  const tgtCart = Cesium.Cartesian3.fromDegrees(targetLon, targetLat, 0);

  // Satellite 3D marker
  satEntity = viewer.entities.add({
    name: opp.sat.name,
    position: satCart,
    point: {
      pixelSize: 14,
      color: cesiumColor(opp.sat.color, 1.0),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
    },
    label: {
      text: `${opp.sat.name}\n${satPos.alt.toFixed(0)} km`,
      font: '11px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -26),
    },
  });

  // Pointing line: satellite → target
  pointingLineEntity = viewer.entities.add({
    name: 'Görüş çizgisi',
    polyline: {
      positions: [satCart, tgtCart],
      width: 2,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString('#ffd33d'),
      }),
      arcType: Cesium.ArcType.NONE,
    },
  });

  // Footprint polygon: reuse computeFootprintRect with a 3-point synthetic track
  const pre = propagateAt(opp.sat.satrec, new Date(opp.time.getTime() - 1000));
  const post = propagateAt(opp.sat.satrec, new Date(opp.time.getTime() + 1000));
  if (pre && post) {
    const trackPoints = [
      { time: new Date(opp.time.getTime() - 1000), lat: pre.lat, lon: pre.lon, alt: pre.alt },
      { time: opp.time, lat: satPos.lat, lon: satPos.lon, alt: satPos.alt },
      { time: new Date(opp.time.getTime() + 1000), lat: post.lat, lon: post.lon, alt: post.alt },
    ];
    const preset = getPreset(presetId);
    const rect = computeFootprintRect(
      trackPoints, 1, preset.swathKm, preset.frameHeightKm, opp.rollDeg, pitchDeg
    );
    if (rect && rect.corners) {
      const coords = [];
      for (const c of rect.corners) {
        coords.push(c[1], c[0]); // lon, lat
      }
      footprintEntity = viewer.entities.add({
        name: 'Sensör karesi',
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(coords),
          material: Cesium.Color.fromCssColorString(opp.sat.color).withAlpha(0.3),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(opp.sat.color),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
    }
  }
}

function animateAroundOpp(opp) {
  const windowMin = 15;
  const start = new Date(opp.time.getTime() - windowMin * 60 * 1000);
  const stop = new Date(opp.time.getTime() + windowMin * 60 * 1000);

  viewer.clock.startTime = Cesium.JulianDate.fromDate(start);
  viewer.clock.stopTime = Cesium.JulianDate.fromDate(stop);
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(opp.time);
  viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
  viewer.clock.multiplier = 30;
  viewer.timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);

  // Fly camera to look at satellite from slightly behind/above
  const satPos = propagateAt(opp.sat.satrec, opp.time);
  if (!satPos) return;

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      (targetLon + satPos.lon) / 2,
      (targetLat + satPos.lat) / 2 - 8,
      satPos.alt * 1000 * 1.8
    ),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-40),
      roll: 0,
    },
    duration: 1.8,
  });
}

// ───────── Opportunity strip ─────────
function updateOppStrip() {
  const strip = document.getElementById('ip3-opp-strip');
  if (!strip) return;
  strip.innerHTML = '';
  if (opportunities.length === 0) return;

  for (let i = 0; i < opportunities.length; i++) {
    const o = opportunities[i];
    const card = el('div', 'ip3-opp-card' + (i === selectedOppIdx ? ' selected' : ''));
    const stars = '★'.repeat(o.stars) + '☆'.repeat(5 - o.stars);
    card.innerHTML = `
      <div class="ip3-opp-time">${fmtTime(o.time)}</div>
      <div class="ip3-opp-date">${fmtDate(o.time)}</div>
      <div class="ip3-opp-stars">${stars}</div>
      <div class="ip3-opp-meta">
        <span>Roll ${o.rollDeg.toFixed(1)}°</span>
        <span>Güneş ${o.sunElevation.toFixed(0)}°</span>
      </div>
      <div class="ip3-opp-sat" style="color:${o.sat.color};">● ${esc(o.sat.name)}</div>
    `;
    card.addEventListener('click', () => selectOpp(i));
    strip.append(card);
  }
}

function oppDescription(o, idx) {
  return `
    <div style="font-size:12px;">
      <div><b>${esc(o.sat.name)}</b> #${o.sat.noradId}</div>
      <div>${fmtDate(o.time)} ${fmtTime(o.time)}</div>
      <div>Roll: ${o.rollDeg.toFixed(1)}°</div>
      <div>Off-Nadir: ${o.offNadirDeg.toFixed(1)}°</div>
      <div>Güneş: ${o.sunElevation.toFixed(1)}°</div>
      <div>Puan: ${o.score.toFixed(0)}/100 (${o.stars}/5)</div>
    </div>
  `;
}

// ───────── Helpers ─────────
function el(tag, cls) {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  return x;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function fmtDate(d) {
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtTime(d) {
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function cesiumColor(cssColor, alpha) {
  return Cesium.Color.fromCssColorString(cssColor).withAlpha(alpha);
}

function showToast(message, type = 'info') {
  document.querySelectorAll('.ip3-toast').forEach(t => t.remove());
  const t = el('div', `ip3-toast ${type}`);
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
