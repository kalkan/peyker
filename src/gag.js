/**
 * GAG — Geniş Alan Görüntüleme (Wide Area Imaging)
 *
 * User draws a polygon, picks a satellite, and the tool:
 *  1. Tiles the polygon into frame-sized squares
 *  2. For each pass in the search horizon, finds which tiles the
 *     satellite can image with roll ≤ maxRollDeg
 *  3. Sorts passes chronologically and computes cumulative coverage
 *  4. Reports the passes needed to finish imaging the whole polygon
 *
 * Overlap between passes is fine — the goal is to reach 100% tile
 * coverage as early as possible.
 */

import './styles/gag.css';
import { fetchTLE } from './sat/fetch.js';
import { parseTLE, propagateAt } from './sat/propagate.js';
import { SENSOR_PRESETS, getPreset } from './sat/sensor-presets.js';
import { getColor } from './sat/presets.js';
import { sunElevation } from './sat/sun.js';

/* global L */

// ───────── State ─────────
let map = null;
let drawnItems = null;
let polygon = null;
let polygonCoords = null;   // [[lat,lon], ...]
let satellites = [];
let selectedSatIdx = 0;
let presetId = 'custom';
let maxRollDeg = 5;
let searchDays = 14;
let running = false;
let progress = 0;
let progressLabel = '';

// Results
let tiles = [];              // [{ id, lat, lon, sizeKm }]
let passes = [];             // [{ time, altKm, sunElev, coveredTileIds, newTileIds, cumCoverage, satName, satColor, tileMinRoll: Map }]
let selectedPassIdx = -1;
let completionInfo = null;   // { totalTiles, coveredTiles, completionTime, passCount }

// Map layers
let tileLayers = [];         // All tile rectangles (always shown)
let selectedPassLayers = []; // Extra layers for the selected pass

// Palette for distinguishing passes visually on the map
const PASS_PALETTE = [
  '#58a6ff', '#7ee787', '#ff7b72', '#d2a8ff', '#ffa657',
  '#79c0ff', '#56d364', '#f85149', '#bc8cff', '#f0883e',
];

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
        <a href="./imaging.html" title="Görüntüleme Hub'ı">Hub</a>
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
  map = L.map('gagMap', { center: [39, 35], zoom: 6, zoomControl: true });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM &copy; CARTO',
    maxZoom: 19,
  }).addTo(map);

  drawnItems = new L.FeatureGroup();
  map.addLayer(drawnItems);

  const drawControl = new L.Control.Draw({
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
    clearAllResultLayers();
    const layer = e.layer;
    drawnItems.addLayer(layer);
    polygon = layer;
    polygonCoords = layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
    resetResults();
    renderLeft();
  });

  map.on(L.Draw.Event.DELETED, () => {
    polygon = null;
    polygonCoords = null;
    resetResults();
    clearAllResultLayers();
    renderLeft();
  });

  map.on(L.Draw.Event.EDITED, () => {
    if (polygon) {
      polygonCoords = polygon.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
      resetResults();
      clearAllResultLayers();
      renderLeft();
    }
  });
}

function resetResults() {
  tiles = [];
  passes = [];
  selectedPassIdx = -1;
  completionInfo = null;
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
      resetResults();
      clearAllResultLayers();
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
    const sel = el('select', 'gag-select');
    sel.style.marginTop = '8px';
    for (let i = 0; i < satellites.length; i++) {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = `${satellites[i].name} #${satellites[i].noradId}`;
      if (i === selectedSatIdx) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => { selectedSatIdx = parseInt(sel.value, 10); });
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

  const sel = el('select', 'gag-select');
  for (const p of SENSOR_PRESETS) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = `${p.name} (${p.swathKm}×${p.frameHeightKm} km)`;
    if (p.id === presetId) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => { presetId = sel.value; });
  sec.append(sel);

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

  const dayRow = el('div', 'gag-slider-row');
  dayRow.innerHTML = `<label>Arama Süresi</label>`;
  const daySlider = document.createElement('input');
  daySlider.type = 'range';
  daySlider.min = 1; daySlider.max = 60; daySlider.step = 1;
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
      <div class="gag-progress-text">${progressLabel} %${(progress * 100).toFixed(0)}</div>
    `;
    sec.append(prog);
  }

  return sec;
}

function buildResultsSection() {
  const sec = el('div', 'gag-section');
  if (passes.length === 0 && !completionInfo) return sec;

  if (completionInfo) {
    const summary = el('div', 'gag-polygon-info');
    const pct = (completionInfo.coveredTiles / completionInfo.totalTiles * 100).toFixed(0);
    const complete = completionInfo.completionTime;
    summary.innerHTML = `
      <div><span class="label">Toplam fayans:</span> <span class="value">${completionInfo.totalTiles}</span></div>
      <div><span class="label">Kapsanan:</span> <span class="value">${completionInfo.coveredTiles} (%${pct})</span></div>
      <div><span class="label">Gerekli geçiş:</span> <span class="value">${completionInfo.passCount}</span></div>
      ${complete ? `<div><span class="label">Tamamlanma:</span> <span class="value">${fmtDate(complete)} ${fmtTime(complete)}</span></div>` : ''}
    `;
    sec.append(summary);
  }

  if (passes.length === 0) return sec;

  const title = el('div', 'gag-results-title');
  title.textContent = `${passes.length} geçiş (kümülatif sıralı)`;
  sec.append(title);

  for (let i = 0; i < passes.length; i++) {
    const p = passes[i];
    const card = el('div', 'gag-result-card' + (i === selectedPassIdx ? ' selected' : ''));
    const color = PASS_PALETTE[i % PASS_PALETTE.length];
    card.innerHTML = `
      <div class="gag-result-date" style="display:flex;align-items:center;gap:8px;">
        <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>
        ${fmtDate(p.time)} ${fmtTime(p.time)}
      </div>
      <div class="gag-result-meta">
        <span>Roll ${p.minRollDeg.toFixed(1)}–${p.maxRollDeg.toFixed(1)}°</span>
        <span>Alt ${p.altKm.toFixed(0)} km</span>
        <span>Güneş ${p.sunElev.toFixed(0)}°</span>
      </div>
      <div class="gag-result-meta">
        <span>Yeni fayans: <b style="color:${color};">${p.newTileIds.length}</b></span>
        <span>Kümülatif: %${(p.cumCoverage * 100).toFixed(0)}</span>
      </div>
      <div class="gag-result-coverage">
        <div class="gag-result-coverage-fill" style="width:${(p.cumCoverage * 100).toFixed(0)}%"></div>
      </div>
    `;
    card.addEventListener('click', () => selectPass(i));
    sec.append(card);
  }

  return sec;
}

// ───────── Analysis ─────────
async function runAnalysis() {
  if (!polygonCoords || satellites.length === 0) return;
  running = true;
  progress = 0;
  progressLabel = 'Hazırlanıyor';
  resetResults();
  clearAllResultLayers();
  renderLeft();

  try {
    const sat = satellites[selectedSatIdx];
    if (!sat) { running = false; renderLeft(); return; }

    const preset = getPreset(presetId);
    const swathKm = preset.swathKm;

    // ─── Adım 1: Polygon'u karola ───
    tiles = tilePolygon(polygonCoords, swathKm);
    if (tiles.length === 0) {
      showToast(`Alan çok küçük (şerit: ${swathKm} km)`, 'warning');
      running = false; renderLeft(); return;
    }
    drawTiles();
    setProgress(0.05, `${tiles.length} karo oluşturuldu`);
    await yieldToUI();

    // ─── Adım 2: Verilen sürede ROI'yi kesen orbit'leri bul ───
    const orbitTracks = await findOrbitsIntersectingROI(sat, maxRollDeg, swathKm, searchDays);
    if (orbitTracks.length === 0) {
      showToast(`${searchDays} gün içinde ROI'yi kesen orbit bulunamadı`, 'warning');
      running = false; renderLeft(); return;
    }
    setProgress(0.55, `${orbitTracks.length} orbit ROI'yi kesiyor`);
    await yieldToUI();

    // ─── Adım 3: Orbit şeritleri ile karolar arasındaki ilişkiyi kur ───
    const allPasses = computeStripTileCoverage(orbitTracks, tiles, swathKm, maxRollDeg);
    setProgress(0.9, `${allPasses.length} geçişte kapsama hesaplandı`);
    await yieldToUI();

    // ─── Sırala ve kümülatif kapsama hesapla ───
    allPasses.sort((a, b) => a.time.getTime() - b.time.getTime());

    const covered = new Set();
    passes = [];
    for (const p of allPasses) {
      const newIds = p.coveredTileIds.filter(id => !covered.has(id));
      if (newIds.length === 0) continue;
      newIds.forEach(id => covered.add(id));
      p.newTileIds = newIds;
      p.cumCoverage = covered.size / tiles.length;
      p.satName = sat.name;
      p.satColor = sat.color;
      passes.push(p);
      if (covered.size === tiles.length) break;
    }

    completionInfo = {
      totalTiles: tiles.length,
      coveredTiles: covered.size,
      completionTime: covered.size === tiles.length && passes.length > 0 ? passes[passes.length - 1].time : null,
      passCount: passes.length,
    };

    running = false;
    progress = 1;
    renderLeft();
    drawTiles();

    if (passes.length === 0) {
      showToast(`Kapsama bulunamadı — roll açısını artırın`, 'warning');
    } else {
      const pct = (covered.size / tiles.length * 100).toFixed(0);
      showToast(`${passes.length} geçişte %${pct} kapsama`, 'success');
      selectPass(0);
    }
  } catch (err) {
    console.error('GAG analysis error:', err);
    showToast(`Hata: ${err.message}`, 'error');
    running = false;
    renderLeft();
  }
}

function setProgress(val, label) {
  progress = val;
  progressLabel = label;
  updateProgress();
}

/**
 * Adım 2: Verilen sürede tüm orbit yer izlerini hesapla ve
 * ROI poligonunu (roll genişletmesiyle) kesen orbit'leri döndür.
 *
 * Returns: Array of orbit tracks, where each track is
 *   [{lat, lon, alt, time}, ...] — ground track points for that pass.
 */
async function findOrbitsIntersectingROI(sat, maxRoll, swathKm, days) {
  const now = new Date();
  const endMs = now.getTime() + days * 86400_000;

  // Roll ile ulaşılabilir maksimum yer mesafesi
  const reachKm = 600 * Math.tan(maxRoll * Math.PI / 180) + swathKm / 2;

  // Coarse scan: 30s step ile tüm geçişleri topla
  // (bir LEO uydusu ~7km/s, 30s = 210km adım)
  const STEP_MS = 30_000;
  const totalSteps = Math.ceil((endMs - now.getTime()) / STEP_MS);

  // Tüm orbit'leri topla (proximity box yerine doğrudan ROI kesişimi kontrol et)
  const orbits = [];
  let currentOrbit = [];
  let wasNear = false;

  for (let step = 0; step < totalSteps; step++) {
    if (step % 200 === 0) {
      setProgress(0.05 + (step / totalSteps) * 0.45, `Yörünge taranıyor... (${orbits.length} kesişim)`);
      await yieldToUI();
    }

    const tMs = now.getTime() + step * STEP_MS;
    const t = new Date(tMs);
    const pos = propagateAt(sat.satrec, t);
    if (!pos) continue;

    // Bu nokta ROI'ye yeterince yakın mı?
    // Kontrol: yer izi noktası, polygon'un herhangi bir kenarına/köşesine
    // reachKm mesafesi içinde mi?
    const nearROI = isPointNearPolygon(pos.lat, pos.lon, polygonCoords, reachKm);

    if (nearROI) {
      currentOrbit.push({ lat: pos.lat, lon: pos.lon, alt: pos.alt, time: t });
      wasNear = true;
    } else if (wasNear) {
      if (currentOrbit.length >= 2) {
        orbits.push(currentOrbit);
      }
      currentOrbit = [];
      wasNear = false;
    }
  }
  if (wasNear && currentOrbit.length >= 2) {
    orbits.push(currentOrbit);
  }

  return orbits;
}

/**
 * Bir noktanın polygon'a (veya polygon kenarına) belirli bir
 * mesafe içinde olup olmadığını kontrol eder.
 */
function isPointNearPolygon(lat, lon, polyCoords, radiusKm) {
  // 1. Nokta polygon içinde mi?
  if (pointInPolygon([lat, lon], polyCoords)) return true;

  // 2. Polygon köşelerine mesafe kontrolü (hızlı yaklaşım)
  const radiusDeg = radiusKm / 111;
  for (const [vLat, vLon] of polyCoords) {
    // Hızlı dikdörtgen filtre
    if (Math.abs(lat - vLat) > radiusDeg) continue;
    if (Math.abs(normalizeLonDiff(lon, vLon)) > radiusDeg) continue;
    // Gerçek mesafe
    if (haversineKm(lat, lon, vLat, vLon) <= radiusKm) return true;
  }

  // 3. Polygon kenarlarına mesafe (her kenar segmenti için en yakın nokta)
  for (let i = 0; i < polyCoords.length; i++) {
    const j = (i + 1) % polyCoords.length;
    const [lat1, lon1] = polyCoords[i];
    const [lat2, lon2] = polyCoords[j];
    const dist = pointToSegmentDistKm(lat, lon, lat1, lon1, lat2, lon2);
    if (dist <= radiusKm) return true;
  }

  return false;
}

/**
 * Bir noktadan bir çizgi segmentine olan minimum mesafe (km).
 * Basitleştirilmiş düzlem yaklaşımı — kısa mesafeler için yeterli.
 */
function pointToSegmentDistKm(pLat, pLon, aLat, aLon, bLat, bLon) {
  // Segment vektörü (derece cinsinden)
  const dx = bLon - aLon;
  const dy = bLat - aLat;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return haversineKm(pLat, pLon, aLat, aLon);

  // Segment üzerindeki en yakın nokta parametresi (0-1 arası clamp)
  let t = ((pLon - aLon) * dx + (pLat - aLat) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestLat = aLat + t * dy;
  const closestLon = aLon + t * dx;

  return haversineKm(pLat, pLon, closestLat, closestLon);
}

/**
 * Adım 3: Her orbit track'i için, hangi karoları kapsadığını hesapla.
 *
 * Şerit modeli: fayans merkezi, yer izine (ground track'e)
 * alt×tan(maxRoll) + swathKm/2 mesafesi içindeyse o fayans kapsanır.
 */
function computeStripTileCoverage(orbitTracks, tiles, swathKm, maxRoll) {
  const results = [];

  for (const track of orbitTracks) {
    const avgAlt = track.reduce((s, p) => s + p.alt, 0) / track.length;
    const maxReachKm = avgAlt * Math.tan(maxRoll * Math.PI / 180) + swathKm / 2;

    const coveredIds = [];
    const distMap = new Map();

    for (const tile of tiles) {
      // Fayans merkezinin ground track'e en yakın mesafesi
      let minDist = Infinity;
      for (let i = 0; i < track.length - 1; i++) {
        const d = pointToSegmentDistKm(
          tile.lat, tile.lon,
          track[i].lat, track[i].lon,
          track[i + 1].lat, track[i + 1].lon
        );
        if (d < minDist) minDist = d;
      }

      if (minDist <= maxReachKm) {
        coveredIds.push(tile.id);
        distMap.set(tile.id, minDist);
      }
    }

    if (coveredIds.length === 0) continue;

    // En yakın zaman noktası (polygon merkezine)
    const centerLat = tiles.reduce((s, t) => s + t.lat, 0) / tiles.length;
    const centerLon = tiles.reduce((s, t) => s + t.lon, 0) / tiles.length;
    let bestPt = track[0];
    let bestD = Infinity;
    for (const pt of track) {
      const d = haversineKm(pt.lat, pt.lon, centerLat, centerLon);
      if (d < bestD) { bestD = d; bestPt = pt; }
    }

    const rolls = coveredIds.map(id => {
      const dist = distMap.get(id);
      return Math.atan(dist / avgAlt) * 180 / Math.PI;
    });

    results.push({
      time: bestPt.time,
      altKm: avgAlt,
      sunElev: sunElevation(centerLat, centerLon, bestPt.time),
      coveredTileIds: coveredIds,
      tileMinRoll: distMap,
      minRollDeg: Math.min(...rolls),
      maxRollDeg: Math.max(...rolls),
      newTileIds: [],
      cumCoverage: 0,
    });
  }

  return results;
}

// ───────── Tile generation ─────────
function tilePolygon(coords, sideKm) {
  const bbox = polygonBBox(coords);
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const latStep = sideKm / 111.0;
  const lonStep = sideKm / (111.0 * Math.max(0.01, Math.cos(centerLat * Math.PI / 180)));

  const out = [];
  let id = 0;
  // Offset half a step so tiles are centered within the polygon
  for (let lat = bbox.minLat + latStep / 2; lat < bbox.maxLat; lat += latStep) {
    for (let lon = bbox.minLon + lonStep / 2; lon < bbox.maxLon; lon += lonStep) {
      if (pointInPolygon([lat, lon], coords)) {
        out.push({ id: id++, lat, lon, latStep, lonStep, sizeKm: sideKm });
      }
    }
  }
  return out;
}

function tilesBBox(tiles) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const t of tiles) {
    if (t.lat < minLat) minLat = t.lat;
    if (t.lat > maxLat) maxLat = t.lat;
    if (t.lon < minLon) minLon = t.lon;
    if (t.lon > maxLon) maxLon = t.lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

// ───────── Map visualization ─────────
function drawTiles() {
  clearTileLayers();
  if (tiles.length === 0) return;

  // Which pass first covers each tile?
  const tileToPassIdx = new Map();
  for (let i = 0; i < passes.length; i++) {
    for (const id of passes[i].newTileIds) tileToPassIdx.set(id, i);
  }

  for (const tile of tiles) {
    const half_lat = tile.latStep / 2;
    const half_lon = tile.lonStep / 2;
    const bounds = [
      [tile.lat - half_lat, tile.lon - half_lon],
      [tile.lat + half_lat, tile.lon + half_lon],
    ];
    const passIdx = tileToPassIdx.get(tile.id);
    const covered = passIdx !== undefined;
    const color = covered ? PASS_PALETTE[passIdx % PASS_PALETTE.length] : '#30363d';
    const rect = L.rectangle(bounds, {
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: covered ? 0.25 : 0.08,
    });
    rect.addTo(map);
    tileLayers.push(rect);
  }
}

function selectPass(idx) {
  if (idx < 0 || idx >= passes.length) return;
  selectedPassIdx = idx;
  clearSelectedPassLayers();

  const pass = passes[idx];
  const color = PASS_PALETTE[idx % PASS_PALETTE.length];

  // Highlight this pass's newly-covered tiles
  for (const tile of tiles) {
    if (!pass.newTileIds.includes(tile.id)) continue;
    const half_lat = tile.latStep / 2;
    const half_lon = tile.lonStep / 2;
    const bounds = [
      [tile.lat - half_lat, tile.lon - half_lon],
      [tile.lat + half_lat, tile.lon + half_lon],
    ];
    const rect = L.rectangle(bounds, {
      color: '#fff',
      weight: 2,
      fillColor: color,
      fillOpacity: 0.55,
    });
    rect.addTo(map);
    selectedPassLayers.push(rect);
  }

  // Popup with pass info at polygon center
  const bbox = polygonBBox(polygonCoords);
  const cLat = (bbox.minLat + bbox.maxLat) / 2;
  const cLon = (bbox.minLon + bbox.maxLon) / 2;
  const popup = L.popup({ className: 'gag-pass-popup' })
    .setLatLng([cLat, cLon])
    .setContent(`
      <div style="font-size:12px;font-weight:600;color:${color};">
        Geçiş ${idx + 1}: ${fmtDate(pass.time)} ${fmtTime(pass.time)}
      </div>
      <div style="font-size:11px;color:#c9d1d9;margin-top:2px;">
        Yeni fayans: ${pass.newTileIds.length} · Kümülatif: %${(pass.cumCoverage * 100).toFixed(0)}
      </div>
    `);
  popup.openOn(map);
  selectedPassLayers.push(popup);

  renderLeft();
}

function clearTileLayers() {
  for (const l of tileLayers) map.removeLayer(l);
  tileLayers.length = 0;
}
function clearSelectedPassLayers() {
  for (const l of selectedPassLayers) {
    try { map.removeLayer(l); } catch { /* popup.close */ }
  }
  selectedPassLayers.length = 0;
}
function clearAllResultLayers() {
  clearTileLayers();
  clearSelectedPassLayers();
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
  return Math.abs(area * 6371 * 6371 / 2);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeLonDiff(lon1, lon2) {
  let d = lon1 - lon2;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
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
  if (text) text.textContent = `${progressLabel} %${(progress * 100).toFixed(0)}`;
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
