import { getState, loadState, setState, subscribe } from './ui/state.js';
import { DEFAULT_GROUND_STATIONS } from './sat/presets.js';
import { computeCoverageRadius } from './ui/controls.js';
import './styles/gs-planner.css';

const L = window.L;

if (!L) {
  document.body.innerHTML = '<div style="padding:16px;color:#fff;background:#0a0f1a;font-family:system-ui">Leaflet yüklenemedi. Lütfen bağlantınızı kontrol edip sayfayı yenileyin.</div>';
}

import { getState, loadState, setState, subscribe } from './ui/state.js';
import { DEFAULT_GROUND_STATIONS } from './sat/presets.js';
import { computeCoverageRadius } from './ui/controls.js';

const STROKE_COLORS = ['#55d38f', '#57a9ff', '#f7b955', '#d183ff', '#6de1f5', '#ff8fab'];

let map;
let markersLayer;
let coverageLayer;
let overlapLayer;

function init() {
  loadState();
  ensureStateSafety();
  buildSidebar();

  map = L.map('gs-map', {
    center: [20, 0],
    zoom: 2,
    worldCopyJump: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  coverageLayer = L.layerGroup().addTo(map);
  overlapLayer = L.layerGroup().addTo(map);

  subscribe(() => {
    buildSidebar();
    renderStations();
  });

  renderStations();
}

function ensureStateSafety() {
  const s = getState();
  if (!Array.isArray(s.groundStations) || s.groundStations.length === 0) {
    setState({ groundStations: [...DEFAULT_GROUND_STATIONS], activeGsIndex: 0 });
  }
}

function buildSidebar() {
  const sidebar = document.getElementById('gs-sidebar');
  const s = getState();
  const hasCustom = s.groundStations.length > DEFAULT_GROUND_STATIONS.length;

  sidebar.innerHTML = `
    <h1 class="header-title">Yer İstasyonu Planlama</h1>
    <div class="header-subtitle">Sadece yer istasyonları, kapsama çemberleri ve kesişim analizi.</div>
    <div class="top-links">
      <a class="top-link" href="./index.html">Anasayfa</a>
      <a class="top-link" href="./antenna.html">Anten</a>
      <a class="top-link" href="./mobile.html">Mobil</a>
    </div>
    <div id="gs-list" class="gs-list"></div>
    ${hasCustom ? '<button id="clear-custom" class="btn btn-danger">Eklenenleri Temizle</button>' : ''}
    <h3 style="margin:14px 0 8px; font-size:14px;">+ Yeni Yer İstasyonu</h3>
    <div class="control-row"><label>Ad</label><input id="gs-name" type="text" placeholder="Örn: Ankara" /></div>
    <div class="control-row"><label>Lat</label><input id="gs-lat" type="number" step="any" placeholder="39.93" /></div>
    <div class="control-row"><label>Lon</label><input id="gs-lon" type="number" step="any" placeholder="32.85" /></div>
    <div class="control-row"><label>Alt (m)</label><input id="gs-alt" type="number" step="1" value="0" /></div>
    <div class="control-row"><label>Min El (°)</label><input id="gs-el" type="number" step="any" value="5" /></div>
    <button id="add-gs" class="btn btn-primary">Yer İstasyonu Ekle</button>
    <div class="legend">
      <div><span class="dot" style="background:#57a9ff"></span>Her istasyonun kapsama çemberi ayrı çizilir.</div>
      <div><span class="dot" style="background:#ff4d6d"></span>Kesişen alanlar farklı renkte vurgulanır.</div>
    </div>
  `;

  const list = sidebar.querySelector('#gs-list');
  s.groundStations.forEach((gs, idx) => {
    const row = document.createElement('div');
    row.className = `gs-item${idx === (s.activeGsIndex || 0) ? ' active' : ''}`;
    row.innerHTML = `
      <span class="gs-item-info"><strong>${escapeHtml(gs.name)}</strong><br>${gs.lat.toFixed(3)}°, ${gs.lon.toFixed(3)}° · ${gs.minEl || 5}° el</span>
      ${isDefault(gs) ? '' : '<span class="gs-item-remove" title="Sil">✕</span>'}
    `;

    row.querySelector('.gs-item-info').addEventListener('click', () => {
      setState({ activeGsIndex: idx, coverageVisible: true });
      const target = s.groundStations[idx];
      if (target && map) map.flyTo([target.lat, target.lon], Math.max(map.getZoom(), 4), { duration: 0.6 });
    });

    const remove = row.querySelector('.gs-item-remove');
    if (remove) {
      remove.addEventListener('click', () => {
        const next = [...getState().groundStations];
        next.splice(idx, 1);
        setState({ groundStations: next, activeGsIndex: Math.max(0, Math.min((getState().activeGsIndex || 0), next.length - 1)) });
      });
    }

    list.append(row);
  });

  const addBtn = sidebar.querySelector('#add-gs');
  addBtn.addEventListener('click', () => {
    const name = sidebar.querySelector('#gs-name').value.trim();
    const lat = parseFloat(sidebar.querySelector('#gs-lat').value);
    const lon = parseFloat(sidebar.querySelector('#gs-lon').value);
    const alt = parseInt(sidebar.querySelector('#gs-alt').value, 10) || 0;
    const minEl = parseFloat(sidebar.querySelector('#gs-el').value) || 5;

    if (!name || Number.isNaN(lat) || Number.isNaN(lon)) return;

    const updated = [...getState().groundStations, { name, lat, lon, alt, minEl }];
    setState({ groundStations: updated, activeGsIndex: updated.length - 1, coverageVisible: true });
  });

  const clearBtn = sidebar.querySelector('#clear-custom');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      setState({ groundStations: [...DEFAULT_GROUND_STATIONS], activeGsIndex: 0, coverageVisible: true });
    });
  }
}

function renderStations() {
  if (!map) return;

  const s = getState();
  const stations = s.groundStations || [];

  markersLayer.clearLayers();
  coverageLayer.clearLayers();
  overlapLayer.clearLayers();

  const circles = [];

  stations.forEach((gs, idx) => {
    L.circleMarker([gs.lat, gs.lon], {
      radius: 6,
      color: '#fff',
      weight: 1,
      fillColor: idx === (s.activeGsIndex || 0) ? '#4f8cff' : '#e04040',
      fillOpacity: 0.95,
    })
      .bindPopup(`<strong>${escapeHtml(gs.name)}</strong><br>${gs.lat.toFixed(4)}°, ${gs.lon.toFixed(4)}°`)
      .addTo(markersLayer);

    const radiusKm = computeCoverageRadius(gs.minEl || 5);
    L.circle([gs.lat, gs.lon], {
      radius: radiusKm * 1000,
      color: STROKE_COLORS[idx % STROKE_COLORS.length],
      weight: 1.8,
      fillColor: STROKE_COLORS[idx % STROKE_COLORS.length],
      fillOpacity: 0.1,
      dashArray: '5 4',
    }).addTo(coverageLayer);

    circles.push({ ...gs, radiusKm });
  });

  renderIntersections(circles);

  if (stations.length > 0) {
    const bounds = L.latLngBounds(stations.map((g) => [g.lat, g.lon]));
    map.fitBounds(bounds.pad(0.7), { maxZoom: 5 });
  }
}

function renderIntersections(circles) {
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const poly = circleIntersectionPolygon(circles[i], circles[j]);
      if (!poly || poly.length < 3) continue;

      L.polygon(poly, {
        color: '#ff4d6d',
        weight: 1,
        fillColor: '#ff4d6d',
        fillOpacity: 0.32,
      })
        .bindTooltip(`${circles[i].name} × ${circles[j].name} kesişim alanı`, { direction: 'top' })
        .addTo(overlapLayer);
    }
  }
}

function circleIntersectionPolygon(a, b, sampleCount = 72) {
  const centerLat = (a.lat + b.lat) / 2;
  const toXY = (lat, lon) => {
    const x = (lon * 111.32) * Math.cos(centerLat * Math.PI / 180);
    const y = lat * 110.57;
    return { x, y };
  };
  const toLL = (x, y) => {
    const lat = y / 110.57;
    const lon = x / (111.32 * Math.cos(centerLat * Math.PI / 180));
    return [lat, lon];
  };

  const ca = toXY(a.lat, a.lon);
  const cb = toXY(b.lat, b.lon);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const d = Math.hypot(dx, dy);

  if (d >= a.radiusKm + b.radiusKm || d <= Math.abs(a.radiusKm - b.radiusKm) || d === 0) return null;

  const pts = [];
  for (let k = 0; k < sampleCount; k++) {
    const t = (k / sampleCount) * Math.PI * 2;
    const x = ca.x + a.radiusKm * Math.cos(t);
    const y = ca.y + a.radiusKm * Math.sin(t);
    if (Math.hypot(x - cb.x, y - cb.y) <= b.radiusKm) pts.push(toLL(x, y));
  }
  for (let k = 0; k < sampleCount; k++) {
    const t = (k / sampleCount) * Math.PI * 2;
    const x = cb.x + b.radiusKm * Math.cos(t);
    const y = cb.y + b.radiusKm * Math.sin(t);
    if (Math.hypot(x - ca.x, y - ca.y) <= a.radiusKm) pts.push(toLL(x, y));
  }

  if (pts.length < 3) return null;

  const centroid = pts.reduce((acc, [lat, lon]) => {
    acc.lat += lat;
    acc.lon += lon;
    return acc;
  }, { lat: 0, lon: 0 });
  centroid.lat /= pts.length;
  centroid.lon /= pts.length;

  pts.sort((p1, p2) => {
    const a1 = Math.atan2(p1[0] - centroid.lat, p1[1] - centroid.lon);
    const a2 = Math.atan2(p2[0] - centroid.lat, p2[1] - centroid.lon);
    return a1 - a2;
  });

  return pts;
}

function isDefault(gs) {
  return DEFAULT_GROUND_STATIONS.some((d) => d.name === gs.name && d.lat === gs.lat && d.lon === gs.lon);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

if (L) init();
if (L) init();
