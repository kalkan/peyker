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
import { parseTLE, propagateAt } from './sat/propagate.js';
import { analyzeAll } from './sat/opportunity.js';
import { PRESETS, TRACK_COLORS } from './sat/presets.js';

/* ───── State ───── */

const STORAGE_KEY = 'sat-groundtrack-state';
let map = null;
let targetMarker = null;
let targetLat = null;
let targetLon = null;
let targetName = '';
let satellites = [];          // { noradId, name, color, satrec, enabled }
let analysisResults = null;   // from analyzeAll()
let running = false;
let selectedOpp = null;       // currently highlighted opportunity
let oppLayers = L.layerGroup();
let geomCanvas = null;

// Settings
let maxRollDeg = 5;
let horizonDays = 7;

/* ───── Bootstrap ───── */

function init() {
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

/** Auto-run analysis if there are enabled satellites with TLE loaded. */
function autoAnalyze() {
  const ready = satellites.filter(s => s.enabled && s.satrec);
  if (ready.length > 0 && targetLat != null && !running) {
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
          satellites.push({ noradId: s.noradId, name: s.name || `SAT-${s.noradId}`, color: s.color || TRACK_COLORS[satellites.length % TRACK_COLORS.length], satrec: null, enabled: true });
        }
      }
    }
  } catch { /* ignore */ }
  // Auto-fetch TLEs
  for (const sat of satellites) fetchSatTLE(sat);
  renderLeftContent();
}

async function fetchSatTLE(sat) {
  if (sat.satrec) return;
  try {
    const tle = await fetchTLE(sat.noradId);
    sat.name = tle.name || sat.name;
    sat.satrec = parseTLE(tle.line1, tle.line2);
  } catch (err) {
    console.warn(`TLE failed for ${sat.noradId}:`, err.message);
  }
  renderLeftContent();
}

async function addSatellite(noradId, name) {
  if (satellites.find(s => s.noradId === noradId)) { toast(`#${noradId} zaten ekli`, 'error'); return; }
  const sat = { noradId, name: name || `SAT-${noradId}`, color: TRACK_COLORS[satellites.length % TRACK_COLORS.length], satrec: null, enabled: true };
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

async function runAnalysis() {
  if (running) return;
  if (targetLat == null || targetLon == null) { toast('Haritaya tiklayarak hedef secin', 'error'); return; }
  const enabled = satellites.filter(s => s.enabled && s.satrec);
  if (enabled.length === 0) { toast('TLE yuklenmis en az 1 uydu secin', 'error'); return; }

  running = true;
  analysisResults = null;
  selectedOpp = null;
  oppLayers.clearLayers();
  renderRightContent();

  try {
    const settings = { MAX_ROLL_DEG: maxRollDeg, SEARCH_HORIZON_DAYS: horizonDays };
    analysisResults = await analyzeAll(enabled, targetLat, targetLon, settings, (result) => {
      // Progressive render: update right panel as each satellite completes
      renderRightContent();
    });
  } catch (err) {
    toast(`Analiz hatasi: ${err.message}`, 'error');
  }

  running = false;
  renderRightContent();
  renderLeftContent();
}

/* ───── Map visualization ───── */

function showOppOnMap(opp, sat) {
  oppLayers.clearLayers();
  selectedOpp = opp;

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

  // Draw geometry diagram
  drawGeometryDiagram(opp);

  // Fit view
  const bounds = L.latLngBounds([[opp.subSatLat, opp.subSatLon], [targetLat, targetLon]]);
  map.flyToBounds(bounds.pad(0.5), { maxZoom: 8, duration: 0.8 });
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
    <a href="./index.html" class="ip-back-link">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      Ana Sayfa
    </a>
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
  sec.append(buildTargetInputs());

  if (targetLat != null && targetLon != null) {
    const card = el('div', 'ip-target-card');
    card.innerHTML = `<div class="ip-target-label">Secili Hedef</div>
      <div class="ip-target-coords">${targetLat.toFixed(5)}°, ${targetLon.toFixed(5)}°</div>
      ${targetName ? `<div class="ip-target-name">${esc(targetName)}</div>` : ''}`;
    sec.append(card);
  } else {
    const hint = el('div', 'ip-hint');
    hint.textContent = 'Haritaya tiklayarak veya koordinat girerek hedef secin';
    sec.append(hint);
  }
  return sec;
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
  sec.innerHTML = '<div class="ip-section-title">Ayarlar</div>';

  const r1 = el('div', 'ip-field-row');
  r1.innerHTML = `<div class="ip-field"><label>Max Roll (°)</label></div><div class="ip-field"><label>Arama (gun)</label></div>`;
  const rollIn = el('input', 'ip-input');
  rollIn.type = 'number'; rollIn.value = maxRollDeg; rollIn.min = 1; rollIn.max = 45; rollIn.step = 0.5;
  rollIn.addEventListener('change', () => { maxRollDeg = parseFloat(rollIn.value) || 5; });
  r1.children[0].append(rollIn);

  const dayIn = el('input', 'ip-input');
  dayIn.type = 'number'; dayIn.value = horizonDays; dayIn.min = 1; dayIn.max = 30; dayIn.step = 1;
  dayIn.addEventListener('change', () => { horizonDays = parseInt(dayIn.value) || 7; });
  r1.children[1].append(dayIn);

  sec.append(r1);
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

    const status = el('span', 'ip-sat-id');
    status.textContent = sat.satrec ? '' : '...';
    status.style.color = sat.satrec ? 'var(--ip-success)' : 'var(--ip-warning)';

    const rmBtn = el('button', 'ip-sat-remove');
    rmBtn.innerHTML = '&times;';
    rmBtn.addEventListener('click', (e) => { e.stopPropagation(); removeSatellite(sat.noradId); });

    row.append(chk, chip, nameEl, idEl, status, rmBtn);
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
  const btn = el('button', 'ip-btn ip-btn-full');
  btn.style.marginTop = '4px';
  btn.textContent = running ? 'Analiz ediliyor...' : 'Analiz Baslat';
  btn.disabled = running || targetLat == null || satellites.filter(s => s.enabled && s.satrec).length === 0;
  btn.addEventListener('click', () => runAnalysis());
  return btn;
}

/* ───── Right panel ───── */

function buildRightHeader() {
  const hdr = el('div', 'ip-right-header');
  hdr.innerHTML = '<h2>Goruntuleme Firsatlari</h2>';

  const csvBtn = el('button', 'ip-btn ip-btn-ghost ip-btn-sm');
  csvBtn.textContent = 'CSV';
  csvBtn.addEventListener('click', () => exportCsv());
  hdr.append(csvBtn);
  return hdr;
}

function buildRightContent() {
  const wrap = el('div', 'ip-right-content');
  wrap.id = 'ip-right-content';
  return wrap;
}

function renderRightContent() {
  const c = document.getElementById('ip-right-content');
  if (!c) return;
  c.innerHTML = '';

  if (targetLat == null) {
    c.innerHTML = '<div class="ip-empty">Haritadan hedef secin, ardindan Analiz Baslat butonuna basin</div>';
    return;
  }

  if (running && !analysisResults) {
    c.innerHTML = '<div class="ip-loading"><div class="ip-spinner"></div><span>Analiz ediliyor...</span></div>';
    return;
  }

  if (!analysisResults) {
    c.innerHTML = '<div class="ip-empty">Hedef secildi. Analiz icin "Analiz Baslat" butonuna basin.</div>';
    return;
  }

  // Geometry diagram
  const geomCard = el('div', 'ip-geom-card');
  geomCard.innerHTML = '<div class="ip-geom-title">Goruntuleme Geometrisi</div>';
  geomCanvas = document.createElement('canvas');
  geomCanvas.width = 320; geomCanvas.height = 180;
  geomCard.append(geomCanvas);
  c.append(geomCard);

  // Summary
  const total = analysisResults.reduce((s, r) => s + r.opportunities.length, 0);
  const avail = analysisResults.filter(r => r.opportunities.length > 0).length;
  const summary = el('div', 'ip-section');
  summary.style.marginBottom = '10px';
  summary.innerHTML = `<b>${total}</b> firsat bulundu &middot; <b>${avail}</b>/${analysisResults.length} uydu &middot; <b>${horizonDays}</b> gun &middot; roll &le; <b>${maxRollDeg}°</b>`;
  summary.style.fontSize = '12px'; summary.style.color = 'var(--ip-text-dim)';
  c.append(summary);

  // Group by satellite
  for (const result of analysisResults) {
    const group = el('div', 'ip-opp-group');

    const header = el('div', 'ip-opp-group-header');
    const chip = el('span', 'ip-opp-group-chip');
    chip.style.background = result.color || '#58a6ff';
    const nameEl = el('span', 'ip-opp-group-name');
    nameEl.textContent = result.name;
    const countEl = el('span', 'ip-opp-group-count');
    countEl.textContent = result.status === 'no_tle' ? 'TLE yok' : `${result.opportunities.length} firsat`;
    header.append(chip, nameEl, countEl);
    group.append(header);

    if (result.opportunities.length === 0) {
      const empty = el('div', 'ip-opp-noops');
      empty.textContent = result.status === 'error' ? `Hata: ${result.error}` : 'Bu uydu icin uygun firsat bulunamadi';
      group.append(empty);
    } else {
      for (const opp of result.opportunities) {
        group.append(buildOppCard(opp, result));
      }
    }

    c.append(group);
  }

  // Draw first available opportunity on canvas
  const firstOpp = analysisResults.find(r => r.opportunities.length > 0);
  if (firstOpp && firstOpp.opportunities[0]) {
    drawGeometryDiagram(firstOpp.opportunities[0]);
  }
}

function buildOppCard(opp, satResult) {
  const card = el('div', 'ip-opp-card');
  if (selectedOpp === opp) card.classList.add('active');

  const timeStr = opp.time.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const dateStr = opp.time.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' });

  const rollClass = Math.abs(opp.offNadirDeg) > maxRollDeg * 0.8 ? 'ip-opp-roll high' : 'ip-opp-roll';

  card.innerHTML = `
    <div class="ip-opp-top">
      <span class="ip-opp-time">${timeStr}</span>
      <span class="ip-opp-date">${dateStr}</span>
    </div>
    <div class="ip-opp-meta">
      <span>Roll: <span class="${rollClass}">${opp.rollDeg > 0 ? '+' : ''}${opp.rollDeg.toFixed(2)}°</span></span>
      <span>Alt: <strong>${opp.altKm.toFixed(0)} km</strong></span>
      <span>Mesafe: <strong>${opp.groundDistKm.toFixed(0)} km</strong></span>
      <span class="ip-opp-sun">☀ ${opp.sunElevation.toFixed(1)}°</span>
    </div>`;

  card.addEventListener('click', () => {
    showOppOnMap(opp, satResult);
    // Update active state
    document.querySelectorAll('.ip-opp-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
  });

  return card;
}

/* ───── CSV Export ───── */

function exportCsv() {
  if (!analysisResults) { toast('Once analiz calistirin', 'error'); return; }
  const header = 'Satellite,NORAD ID,Date (UTC+3),Time (UTC+3),Roll (deg),Off-Nadir (deg),Altitude (km),Ground Dist (km),Sun Elev (deg),Sub-Sat Lat,Sub-Sat Lon,Target Lat,Target Lon';
  const rows = [];
  for (const r of analysisResults) {
    for (const o of r.opportunities) {
      const d = o.time.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' });
      const t = o.time.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      rows.push([`"${r.name}"`, r.noradId, d, t, o.rollDeg.toFixed(2), o.offNadirDeg.toFixed(2), o.altKm.toFixed(0), o.groundDistKm.toFixed(0), o.sunElevation.toFixed(1), o.subSatLat.toFixed(4), o.subSatLon.toFixed(4), targetLat.toFixed(5), targetLon.toFixed(5)].join(','));
    }
  }
  if (rows.length === 0) { toast('Disa aktarilacak firsat yok', 'error'); return; }
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
