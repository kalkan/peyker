/**
 * Ground Station Coverage Planner
 *
 * Displays all ground stations on a map with coverage circles.
 * Highlights intersection areas in a distinct color.
 * Shares ground station data with the main app via localStorage.
 */

import 'leaflet/dist/leaflet.css';
import './styles/gs-planner.css';
import L from 'leaflet';

// Fix Leaflet default marker icon path issue with Vite bundler.
import markerIcon from 'leaflet/dist/images/marker-icon.png?url';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png?url';
import markerShadow from 'leaflet/dist/images/marker-shadow.png?url';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const STORAGE_KEY = 'sat-groundtrack-state';
const DEG2RAD = Math.PI / 180;
const R_EARTH = 6371; // km

const GS_COLORS = [
  '#58a6ff', '#f0883e', '#3fb950', '#bc8cff',
  '#f778ba', '#ffd33d', '#79c0ff', '#56d364',
  '#e3b341', '#ff7b72',
];
const INTERSECTION_COLOR = '#ff4040';
const INTERSECTION_FILL = '#ff4040';

let map = null;
let coverageGroup = null;
let intersectionGroup = null;
let markerGroup = null;
let groundStations = [];
let selectedIdx = 0;
let pickingMode = false;
let pickCallback = null;

// ===== State persistence =====

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.groundStations) && parsed.groundStations.length > 0) {
      groundStations = parsed.groundStations;
    }
    if (typeof parsed.activeGsIndex === 'number') {
      selectedIdx = parsed.activeGsIndex;
    }
  } catch { /* ignore */ }

  if (groundStations.length === 0) {
    groundStations = [{ name: 'Ankara', lat: 39.8911, lon: 32.7787, alt: 925, minEl: 5 }];
  }
  selectedIdx = Math.min(selectedIdx, groundStations.length - 1);
}

function saveState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const state = raw ? JSON.parse(raw) : {};
    state.groundStations = groundStations;
    state.activeGsIndex = selectedIdx;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

// ===== Coverage math =====

function computeCoverageRadius(minElDeg, satAltKm = 550) {
  const el = minElDeg * DEG2RAD;
  const centralAngle = Math.acos((R_EARTH * Math.cos(el)) / (R_EARTH + satAltKm)) - el;
  return R_EARTH * centralAngle; // km
}

/**
 * Generate circle points on a sphere.
 * Returns array of [lat, lon] around center with given radius in km.
 */
function circlePoints(lat, lon, radiusKm, n = 72) {
  const points = [];
  const angDist = radiusKm / R_EARTH;
  const lat1 = lat * DEG2RAD;
  const lon1 = lon * DEG2RAD;

  for (let i = 0; i <= n; i++) {
    const brng = (2 * Math.PI * i) / n;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angDist) +
      Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
    );
    points.push([lat2 / DEG2RAD, lon2 / DEG2RAD]);
  }
  return points;
}

/**
 * Compute great-circle distance between two points (km).
 */
function gcDist(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

/**
 * Compute intersection polygon of two spherical circles.
 * Returns array of [lat, lon] points forming the intersection lens, or null.
 */
function circleIntersection(gs1, r1, gs2, r2) {
  const d = gcDist(gs1.lat, gs1.lon, gs2.lat, gs2.lon);
  if (d >= r1 + r2) return null;     // too far apart
  if (d + r2 <= r1) return 'contained_in_1'; // gs2 inside gs1
  if (d + r1 <= r2) return 'contained_in_2'; // gs1 inside gs2

  // Sample points from both circles and collect those inside both
  const pts1 = circlePoints(gs1.lat, gs1.lon, r1, 120);
  const pts2 = circlePoints(gs2.lat, gs2.lon, r2, 120);

  // Points from circle 1 that are inside circle 2
  const inBoth1 = pts1.filter(p => gcDist(p[0], p[1], gs2.lat, gs2.lon) <= r2);
  // Points from circle 2 that are inside circle 1
  const inBoth2 = pts2.filter(p => gcDist(p[0], p[1], gs1.lat, gs1.lon) <= r1);

  if (inBoth1.length === 0 && inBoth2.length === 0) return null;

  // Combine and sort by angle from centroid to form a polygon
  const allPts = [...inBoth1, ...inBoth2];
  const cLat = allPts.reduce((s, p) => s + p[0], 0) / allPts.length;
  const cLon = allPts.reduce((s, p) => s + p[1], 0) / allPts.length;

  allPts.sort((a, b) => {
    const angA = Math.atan2(a[0] - cLat, a[1] - cLon);
    const angB = Math.atan2(b[0] - cLat, b[1] - cLon);
    return angA - angB;
  });

  return allPts;
}

// ===== Map rendering =====

function initMap() {
  map = L.map('gsp-map', {
    center: [39, 35],
    zoom: 5,
    zoomControl: true,
    worldCopyJump: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OSM',
    maxZoom: 19,
  }).addTo(map);

  // Add satellite imagery option
  const satLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: '&copy; Esri', maxZoom: 18 }
  );
  L.control.layers({ 'OpenStreetMap': map._layers[Object.keys(map._layers)[0]], 'Satellite': satLayer }, {}, { collapsed: true }).addTo(map);

  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

  coverageGroup = L.layerGroup().addTo(map);
  intersectionGroup = L.layerGroup().addTo(map);
  markerGroup = L.layerGroup().addTo(map);

  setTimeout(() => map.invalidateSize(), 100);
}

function getGsColor(index) {
  return GS_COLORS[index % GS_COLORS.length];
}

function renderMap() {
  coverageGroup.clearLayers();
  intersectionGroup.clearLayers();
  markerGroup.clearLayers();

  // Draw coverage circles
  const radii = [];
  for (let i = 0; i < groundStations.length; i++) {
    const gs = groundStations[i];
    const minEl = gs.minEl || 5;
    const radiusKm = computeCoverageRadius(minEl);
    radii.push(radiusKm);
    const color = getGsColor(i);

    L.circle([gs.lat, gs.lon], {
      radius: radiusKm * 1000,
      color: color,
      weight: 2,
      fillColor: color,
      fillOpacity: 0.08,
      dashArray: '6 4',
    }).addTo(coverageGroup);

    // Marker
    const icon = L.divIcon({
      className: '',
      html: `<div style="
        width:24px; height:24px; border-radius:50%;
        background:${color}; border:2px solid #fff;
        display:flex; align-items:center; justify-content:center;
        font-size:11px; font-weight:700; color:#fff;
        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      ">${i + 1}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    const marker = L.marker([gs.lat, gs.lon], { icon }).addTo(markerGroup);
    marker.bindPopup(`<b>${gs.name}</b><br>${gs.lat.toFixed(4)}°, ${gs.lon.toFixed(4)}°<br>Alt: ${gs.alt || 0}m, Min El: ${minEl}°<br>Coverage: ${Math.round(radiusKm)} km`);
  }

  // Compute and draw intersections
  for (let i = 0; i < groundStations.length; i++) {
    for (let j = i + 1; j < groundStations.length; j++) {
      const gs1 = groundStations[i];
      const gs2 = groundStations[j];
      const result = circleIntersection(gs1, radii[i], gs2, radii[j]);

      if (result === 'contained_in_1') {
        // gs2's entire circle is inside gs1 — draw gs2's circle as intersection
        const pts = circlePoints(gs2.lat, gs2.lon, radii[j], 72);
        drawIntersectionPolygon(pts, gs1.name, gs2.name);
      } else if (result === 'contained_in_2') {
        const pts = circlePoints(gs1.lat, gs1.lon, radii[i], 72);
        drawIntersectionPolygon(pts, gs1.name, gs2.name);
      } else if (Array.isArray(result) && result.length >= 3) {
        drawIntersectionPolygon(result, gs1.name, gs2.name);
      }
    }
  }

  // Fit bounds
  if (groundStations.length > 0) {
    const allPts = groundStations.map(gs => [gs.lat, gs.lon]);
    map.fitBounds(L.latLngBounds(allPts).pad(0.5), { maxZoom: 8 });
  }
}

function drawIntersectionPolygon(points, name1, name2) {
  L.polygon(points, {
    color: INTERSECTION_COLOR,
    weight: 2,
    fillColor: INTERSECTION_FILL,
    fillOpacity: 0.25,
    dashArray: '4 2',
  }).addTo(intersectionGroup)
    .bindPopup(`<b>Intersection</b><br>${name1} & ${name2}`);
}

// ===== UI =====

function buildUI() {
  const app = document.getElementById('gs-planner-app');
  app.innerHTML = '';

  // Side panel
  const panel = document.createElement('div');
  panel.className = 'gsp-panel';
  app.append(panel);

  // Header
  const header = document.createElement('div');
  header.className = 'gsp-header';
  header.innerHTML = `
    <div class="gsp-header-row">
      <h1>Yer Istasyonu Planlama</h1>
      <a href="./index.html" class="gsp-back-link">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        Ana Sayfa
      </a>
    </div>
  `;
  panel.append(header);

  // Scrollable content
  const content = document.createElement('div');
  content.className = 'gsp-content';
  content.id = 'gsp-content';
  panel.append(content);

  // Map container
  const mapContainer = document.createElement('div');
  mapContainer.className = 'gsp-map-container';
  mapContainer.innerHTML = '<div id="gsp-map"></div>';
  app.append(mapContainer);

  renderPanel();
}

function renderPanel() {
  const content = document.getElementById('gsp-content');
  content.innerHTML = '';

  // Stats section
  content.append(buildStatsSection());

  // GS list section
  content.append(buildGsListSection());

  // Add new GS section
  content.append(buildAddSection());

  // Legend
  content.append(buildLegendSection());
}

function buildStatsSection() {
  const section = document.createElement('div');
  section.className = 'gsp-section';

  // Count intersections
  let intersectCount = 0;
  const radii = groundStations.map(gs => computeCoverageRadius(gs.minEl || 5));
  for (let i = 0; i < groundStations.length; i++) {
    for (let j = i + 1; j < groundStations.length; j++) {
      const d = gcDist(groundStations[i].lat, groundStations[i].lon, groundStations[j].lat, groundStations[j].lon);
      if (d < radii[i] + radii[j]) intersectCount++;
    }
  }

  section.innerHTML = `
    <div class="gsp-stats">
      <div class="gsp-stat">
        <div class="gsp-stat-value">${groundStations.length}</div>
        <div class="gsp-stat-label">Yer Istasyonu</div>
      </div>
      <div class="gsp-stat">
        <div class="gsp-stat-value">${intersectCount}</div>
        <div class="gsp-stat-label">Kesisim</div>
      </div>
    </div>
  `;
  return section;
}

function buildGsListSection() {
  const section = document.createElement('div');
  section.className = 'gsp-section';

  const title = document.createElement('div');
  title.className = 'gsp-section-title';
  title.textContent = 'Yer Istasyonlari';
  section.append(title);

  for (let i = 0; i < groundStations.length; i++) {
    const gs = groundStations[i];
    const radiusKm = Math.round(computeCoverageRadius(gs.minEl || 5));
    const color = getGsColor(i);

    const item = document.createElement('div');
    item.className = 'gsp-gs-item' + (i === selectedIdx ? ' active' : '');

    const swatch = document.createElement('div');
    swatch.className = 'gsp-gs-color';
    swatch.style.background = color;

    const info = document.createElement('div');
    info.className = 'gsp-gs-info';
    info.innerHTML = `
      <div class="gsp-gs-name">${gs.name}</div>
      <div class="gsp-gs-coords">${gs.lat.toFixed(4)}°, ${gs.lon.toFixed(4)}° | ${gs.minEl || 5}° el | ${radiusKm} km</div>
    `;

    item.append(swatch, info);

    // Click to select/zoom
    item.addEventListener('click', () => {
      selectedIdx = i;
      saveState();
      renderPanel();
      map.flyTo([gs.lat, gs.lon], 7, { duration: 0.5 });
    });

    // Remove button (don't allow removing last station)
    if (groundStations.length > 1) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'gsp-gs-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = 'Kaldir';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        groundStations.splice(i, 1);
        if (selectedIdx >= groundStations.length) selectedIdx = groundStations.length - 1;
        saveState();
        renderPanel();
        renderMap();
      });
      item.append(removeBtn);
    }

    section.append(item);
  }

  return section;
}

function buildAddSection() {
  const section = document.createElement('div');
  section.className = 'gsp-section';

  const title = document.createElement('div');
  title.className = 'gsp-section-title';
  title.textContent = 'Yeni Yer Istasyonu Ekle';
  section.append(title);

  const form = document.createElement('div');
  form.className = 'gsp-add-form';

  const nameInput = createInput('Isim', 'text', 'gsp-input-full');
  const latInput = createInput('Enlem', 'number');
  const lonInput = createInput('Boylam', 'number');
  const altInput = createInput('Yukseklik (m)', 'number');
  const elInput = createInput('Min El (°)', 'number');
  elInput.querySelector('input').value = '5';

  form.append(nameInput, latInput, lonInput, altInput, elInput);

  const btnRow = document.createElement('div');
  btnRow.className = 'gsp-input-full';
  btnRow.style.display = 'flex';
  btnRow.style.gap = '6px';
  btnRow.style.marginTop = '4px';

  const addBtn = document.createElement('button');
  addBtn.className = 'gsp-btn';
  addBtn.textContent = 'Ekle';
  addBtn.addEventListener('click', () => {
    const name = nameInput.querySelector('input').value.trim();
    const lat = parseFloat(latInput.querySelector('input').value);
    const lon = parseFloat(lonInput.querySelector('input').value);
    const alt = parseInt(altInput.querySelector('input').value, 10) || 0;
    const minEl = parseFloat(elInput.querySelector('input').value) || 5;

    if (!name) { showToast('Isim gerekli'); return; }
    if (isNaN(lat) || lat < -90 || lat > 90) { showToast('Gecersiz enlem'); return; }
    if (isNaN(lon) || lon < -180 || lon > 180) { showToast('Gecersiz boylam'); return; }

    groundStations.push({ name, lat, lon, alt, minEl });
    selectedIdx = groundStations.length - 1;
    saveState();
    renderPanel();
    renderMap();
    showToast(`${name} eklendi`);
  });

  // Map click to fill coords
  const pickBtn = document.createElement('button');
  pickBtn.className = 'gsp-btn gsp-btn-sm';
  pickBtn.style.background = '#30363d';
  pickBtn.textContent = 'Haritadan Sec';

  pickBtn.addEventListener('click', () => {
    if (pickingMode) {
      // Cancel picking
      pickingMode = false;
      pickCallback = null;
      pickBtn.textContent = 'Haritadan Sec';
      pickBtn.style.background = '#30363d';
      if (map) map.getContainer().style.cursor = '';
    } else {
      // Start picking
      pickingMode = true;
      pickBtn.textContent = 'Iptal';
      pickBtn.style.background = '#f85149';
      if (map) map.getContainer().style.cursor = 'crosshair';
      pickCallback = (latlng) => {
        latInput.querySelector('input').value = latlng.lat.toFixed(6);
        lonInput.querySelector('input').value = latlng.lng.toFixed(6);
        pickBtn.textContent = 'Haritadan Sec';
        pickBtn.style.background = '#30363d';
        showToast('Koordinatlar dolduruldu');
      };
    }
  });

  btnRow.append(addBtn, pickBtn);
  form.append(btnRow);
  section.append(form);

  return section;
}

function buildLegendSection() {
  const section = document.createElement('div');
  section.className = 'gsp-section';

  const title = document.createElement('div');
  title.className = 'gsp-section-title';
  title.textContent = 'Gosterge';
  section.append(title);

  const legend = document.createElement('div');
  legend.className = 'gsp-legend';

  for (let i = 0; i < groundStations.length; i++) {
    const item = document.createElement('div');
    item.className = 'gsp-legend-item';
    item.innerHTML = `<div class="gsp-legend-swatch" style="background:${getGsColor(i)}; opacity:0.5;"></div>${groundStations[i].name}`;
    legend.append(item);
  }

  // Intersection legend
  const intItem = document.createElement('div');
  intItem.className = 'gsp-legend-item';
  intItem.innerHTML = `<div class="gsp-legend-swatch" style="background:${INTERSECTION_FILL}; opacity:0.5;"></div>Kesisim`;
  legend.append(intItem);

  section.append(legend);
  return section;
}

function createInput(placeholder, type, extraClass = '') {
  const wrapper = document.createElement('div');
  if (extraClass) wrapper.className = extraClass;
  const input = document.createElement('input');
  input.type = type;
  input.placeholder = placeholder;
  input.className = 'gsp-input';
  if (type === 'number') input.step = 'any';
  wrapper.append(input);
  return wrapper;
}

function showToast(msg) {
  let existing = document.querySelector('.gsp-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'gsp-toast';
  toast.textContent = msg;
  document.body.append(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// ===== Init =====

function init() {
  loadState();
  buildUI();
  initMap();
  renderMap();

  // Global map click handler for coordinate picking
  map.on('click', (e) => {
    if (!pickingMode || !pickCallback) return;
    pickingMode = false;
    map.getContainer().style.cursor = '';
    pickCallback(e.latlng);
    pickCallback = null;
  });
}

init();
