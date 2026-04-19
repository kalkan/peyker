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
let presetId = 'custom';
let rollDeg = 20;
let pitchDeg = 0;
let opportunities = []; // flattened across all satellites
let selectedOppIdx = -1;
let running = false;
let progress = 0;

// Cesium entities we manage
let targetEntity = null;
const oppMarkerEntities = []; // Entity[]
const selectionEntities = []; // all entities for selected-opp 3D viz

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
  importMainAppSatellites();
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

// ───────── Auto-import from main app ─────────
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

    const results = await Promise.allSettled(
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
    for (const r of results) {
      if (r.status === 'fulfilled' && !satellites.find(x => x.noradId === r.value.noradId)) {
        satellites.push(r.value);
        count++;
      }
    }

    if (count > 0) {
      renderLeft();
      showToast(`${count} uydu ana ekrandan aktarıldı`, 'success');
    }
  } catch (err) {
    console.warn('Main app import failed:', err);
  }
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

  // Re-import button
  const reimportBtn = el('button', 'ip3-btn');
  reimportBtn.textContent = 'Ana Ekrandan Aktar';
  reimportBtn.style.fontSize = '11px';
  reimportBtn.style.marginTop = '6px';
  reimportBtn.style.width = '100%';
  reimportBtn.addEventListener('click', () => importMainAppSatellites());
  sec.append(reimportBtn);

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

/** Draw just the selected opportunity's orbital pass (±25 min around opp time). */
function drawSelectedPassArc(opp) {
  const windowMin = 25;
  const stepS = 20;
  const points = [];

  for (let dt = -windowMin * 60; dt <= windowMin * 60; dt += stepS) {
    const date = new Date(opp.time.getTime() + dt * 1000);
    const pos = propagateAt(opp.sat.satrec, date);
    if (pos) points.push(pos.lon, pos.lat, pos.alt * 1000);
  }
  if (points.length < 6) return;

  const color = Cesium.Color.fromCssColorString(opp.sat.color);

  // In-space arc (at altitude)
  addSel({
    name: opp.sat.name + ' geçiş',
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArrayHeights(points),
      width: 3,
      material: color.withAlpha(0.85),
      clampToGround: false,
    },
  });

  // Ground projection of the same arc
  const groundPts = [];
  for (let i = 0; i < points.length; i += 3) {
    groundPts.push(points[i], points[i + 1]);
  }
  addSel({
    name: opp.sat.name + ' yer izi',
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(groundPts),
      width: 2,
      material: color.withAlpha(0.5),
      clampToGround: true,
    },
  });
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
  for (const e of oppMarkerEntities) viewer.entities.remove(e);
  oppMarkerEntities.length = 0;
  clearSelectionEntities();
}

function clearSelectionEntities() {
  for (const e of selectionEntities) {
    try { viewer.entities.remove(e); } catch { /* ignore */ }
  }
  selectionEntities.length = 0;
}

function addSel(entity) {
  selectionEntities.push(viewer.entities.add(entity));
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
  clearSelectionEntities();

  const satPos = propagateAt(opp.sat.satrec, opp.time);
  if (!satPos) return;

  // ──── 0. Pass arc for the selected opportunity ────
  drawSelectedPassArc(opp);

  const altM = satPos.alt * 1000;
  const satCart = Cesium.Cartesian3.fromDegrees(satPos.lon, satPos.lat, altM);
  const subSatCart = Cesium.Cartesian3.fromDegrees(satPos.lon, satPos.lat, 0);
  const tgtCart = Cesium.Cartesian3.fromDegrees(targetLon, targetLat, 0);
  const satColor = Cesium.Color.fromCssColorString(opp.sat.color);

  // ──── 1. Satellite 3D model marker ────
  addSel({
    name: opp.sat.name,
    position: satCart,
    point: {
      pixelSize: 16,
      color: satColor,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
    },
    label: {
      text: `${opp.sat.name}\n${satPos.alt.toFixed(0)} km`,
      font: 'bold 12px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -28),
    },
  });

  // ──── 2. Nadir line (satellite → sub-satellite point) ────
  addSel({
    name: 'Nadir',
    polyline: {
      positions: [satCart, subSatCart],
      width: 1,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.CYAN.withAlpha(0.5),
        dashLength: 12,
      }),
      arcType: Cesium.ArcType.NONE,
    },
  });

  // Sub-satellite ground ring
  addSel({
    name: 'Alt-uydu noktası',
    position: subSatCart,
    ellipse: {
      semiMajorAxis: 15_000,
      semiMinorAxis: 15_000,
      material: Cesium.Color.CYAN.withAlpha(0.15),
      outline: true,
      outlineColor: Cesium.Color.CYAN.withAlpha(0.6),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });

  // ──── 3. Pointing line (satellite → target) ────
  // Wide yellow glow underneath + solid bright line on top so the beam
  // reads cleanly against the globe and other geometry.
  addSel({
    name: 'Görüş çizgisi (gölge)',
    polyline: {
      positions: [satCart, tgtCart],
      width: 10,
      material: Cesium.Color.fromCssColorString('#ffd33d').withAlpha(0.18),
      arcType: Cesium.ArcType.NONE,
    },
  });
  addSel({
    name: 'Görüş çizgisi',
    polyline: {
      positions: [satCart, tgtCart],
      width: 3,
      material: Cesium.Color.fromCssColorString('#ffd33d'),
      depthFailMaterial: Cesium.Color.fromCssColorString('#ffd33d').withAlpha(0.6),
      arcType: Cesium.ArcType.NONE,
    },
  });

  // Prominent target end-cap (so the beam endpoint is unambiguous)
  addSel({
    name: 'Hedef vuruşu',
    position: tgtCart,
    point: {
      pixelSize: 14,
      color: Cesium.Color.fromCssColorString('#ffd33d'),
      outlineColor: Cesium.Color.fromCssColorString('#c53030'),
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  // ──── 4. Footprint + sensor cone (centered on target) ────
  const preset = getPreset(presetId);
  const heading = satHeadingAt(opp.sat.satrec, opp.time); // radians from north
  const corners = cornersAroundTarget(
    targetLat, targetLon, heading, preset.swathKm, preset.frameHeightKm
  );
  const cornerCarts = corners.map(c => Cesium.Cartesian3.fromDegrees(c[1], c[0], 0));

  // Ground footprint polygon (filled) — centered on the target
  const fpCoords = [];
  for (const c of corners) fpCoords.push(c[1], c[0]);
  addSel({
    name: 'Sensör karesi',
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(fpCoords),
      material: satColor.withAlpha(0.25),
      outline: true,
      outlineColor: satColor.withAlpha(0.9),
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });

  // ── Sensor cone: 4 edge lines from sat to each footprint corner ──
  for (let ci = 0; ci < 4; ci++) {
    addSel({
      polyline: {
        positions: [satCart, cornerCarts[ci]],
        width: 1.5,
        material: satColor.withAlpha(0.6),
        arcType: Cesium.ArcType.NONE,
      },
    });
  }

  // ── FOV wall polygons (4 triangular faces) ──
  for (let ci = 0; ci < 4; ci++) {
    const next = (ci + 1) % 4;
    addSel({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy([
          satCart, cornerCarts[ci], cornerCarts[next],
        ]),
        material: satColor.withAlpha(0.08),
        outline: false,
        perPositionHeight: true,
      },
    });
  }

  // ──── 5. Ground swath strip (±5 min around opp time) ────
  drawSwathStrip(opp);
}

function drawSwathStrip(opp) {
  const preset = getPreset(presetId);
  const halfWindowMs = 5 * 60 * 1000;
  const stepMs = 10_000;
  const satColor = Cesium.Color.fromCssColorString(opp.sat.color);

  const leftEdge = [];
  const rightEdge = [];

  for (let dt = -halfWindowMs; dt <= halfWindowMs; dt += stepMs) {
    const t = new Date(opp.time.getTime() + dt);
    const pre = propagateAt(opp.sat.satrec, new Date(t.getTime() - 1000));
    const cur = propagateAt(opp.sat.satrec, t);
    const post = propagateAt(opp.sat.satrec, new Date(t.getTime() + 1000));
    if (!pre || !cur || !post) continue;

    const trackPts = [
      { time: new Date(t.getTime() - 1000), lat: pre.lat, lon: pre.lon, alt: pre.alt },
      { time: t, lat: cur.lat, lon: cur.lon, alt: cur.alt },
      { time: new Date(t.getTime() + 1000), lat: post.lat, lon: post.lon, alt: post.alt },
    ];
    const rect = computeFootprintRect(
      trackPts, 1, preset.swathKm, preset.frameHeightKm, opp.rollDeg, 0
    );
    if (!rect || !rect.corners || rect.corners.length < 4) continue;

    // corners: [tl, tr, br, bl] — left edge = [tl, bl], right edge = [tr, br]
    leftEdge.push(rect.corners[0]);
    leftEdge.push(rect.corners[3]);
    rightEdge.push(rect.corners[1]);
    rightEdge.push(rect.corners[2]);
  }

  if (leftEdge.length < 4) return;

  // Build a closed polygon from left edge forward + right edge reversed
  const stripCoords = [];
  const uniqueLeft = leftEdge.filter((_, i) => i % 2 === 0); // take tl only
  const uniqueRight = rightEdge.filter((_, i) => i % 2 === 0); // take tr only

  for (const c of uniqueLeft) stripCoords.push(c[1], c[0]);
  for (let i = uniqueRight.length - 1; i >= 0; i--) {
    stripCoords.push(uniqueRight[i][1], uniqueRight[i][0]);
  }

  if (stripCoords.length < 6) return;

  addSel({
    name: 'Tarama şeridi',
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(stripCoords),
      material: satColor.withAlpha(0.1),
      outline: true,
      outlineColor: satColor.withAlpha(0.4),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });
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

/**
 * Satellite heading at time `t` (radians, measured clockwise from north),
 * derived from the ground projection of the orbit 1s ahead.
 */
function satHeadingAt(satrec, t) {
  const now = propagateAt(satrec, t);
  const ahead = propagateAt(satrec, new Date(t.getTime() + 1000));
  if (!now || !ahead) return 0;
  const φ1 = now.lat * Math.PI / 180;
  const φ2 = ahead.lat * Math.PI / 180;
  const Δλ = (ahead.lon - now.lon) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return Math.atan2(y, x);
}

/**
 * 4 corners [lat, lon] of a rectangle centered on (tgtLat, tgtLon),
 * with along-track length = frameKm aligned with `headingRad`, and
 * cross-track width = swathKm. Uses small-angle flat-earth math which
 * is accurate enough for sensor footprints up to a few hundred km.
 *
 * Returns corners in order: [tl, tr, br, bl] where "t"op is forward
 * along the satellite heading.
 */
function cornersAroundTarget(tgtLat, tgtLon, headingRad, swathKm, frameKm) {
  const cosLat = Math.cos(tgtLat * Math.PI / 180);
  const degPerKmLat = 1 / 111.0;
  const degPerKmLon = 1 / (111.0 * Math.max(cosLat, 0.01));

  // Unit vectors in (north, east) coords
  const alongN = Math.cos(headingRad);
  const alongE = Math.sin(headingRad);
  const crossN = Math.cos(headingRad + Math.PI / 2); // = -sin(h)
  const crossE = Math.sin(headingRad + Math.PI / 2); // =  cos(h)

  const a = frameKm / 2;
  const c = swathKm / 2;

  // [along, cross] offsets for tl, tr, br, bl
  const offsets = [
    [+a, -c],
    [+a, +c],
    [-a, +c],
    [-a, -c],
  ];

  return offsets.map(([oa, oc]) => {
    const dN = alongN * oa + crossN * oc;
    const dE = alongE * oa + crossE * oc;
    const dLat = dN * degPerKmLat;
    const dLon = dE * degPerKmLon;
    return [tgtLat + dLat, tgtLon + dLon];
  });
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
