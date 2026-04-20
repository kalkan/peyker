/**
 * Takım Uydu Yönetimi (Constellation Management)
 *
 * Real-time Cesium view of all imported satellites with their current
 * positions. Supports grouping satellites into named "constellations"
 * persisted to localStorage.
 */

import './styles/constellation.css';
import { fetchTLE } from './sat/fetch.js';
import { parseTLE, propagateAt } from './sat/propagate.js';
import { getColor } from './sat/presets.js';

/* global Cesium */

// ───────── State ─────────
let viewer = null;
let satellites = []; // { noradId, name, color, satrec, tle, entity, trailEntity }
let constellations = []; // { id, name, satNoradIds, color }
let tickInterval = null;
let selectedSatId = null;
let editingConstellationId = null;   // null or an existing id, or 'new'
let editingMembers = new Set();
let showTrails = true;
let trailMinutes = 30;

const STORAGE_KEY = 'peyker-constellations';

// ───────── Init ─────────
function init() {
  const app = document.getElementById('constellation-app');
  if (!app) return;

  const panel = document.createElement('div');
  panel.className = 'con-panel';
  panel.innerHTML = `
    <div class="con-header">
      <h1>Takım Uydu</h1>
      <div class="con-nav">
        <a href="./imaging.html" title="Görüntüleme">Görünt.</a>
        <a href="./index.html" title="Ana Sayfa">Ana</a>
      </div>
    </div>
    <div id="con-sections"></div>
  `;
  app.append(panel);

  const viewerWrap = document.createElement('div');
  viewerWrap.className = 'con-viewer';
  viewerWrap.innerHTML = `
    <div id="cesiumContainer"></div>
    <div class="con-clock" id="con-clock">--:--:--</div>
  `;
  app.append(viewerWrap);

  if (typeof Cesium === 'undefined') {
    showToast('Cesium yüklenemedi', 'error');
    return;
  }

  initCesium();
  loadConstellations();
  renderLeft();
  importMainAppSatellites();
  startTickLoop();
}

function initCesium() {
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
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
  });
  viewer.scene.globe.enableLighting = true;
  viewer.scene.skyAtmosphere.show = true;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(35, 39, 15_000_000),
    duration: 0,
  });
}

// ───────── Satellite import/add ─────────
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

    showToast(`${toImport.length} uydu aktarılıyor…`, 'info');
    const settled = await Promise.allSettled(
      toImport.map(async (s) => {
        const tle = await fetchTLE(s.noradId);
        return {
          noradId: s.noradId,
          name: tle.name || s.name,
          color: s.color || getColor(satellites.length),
          satrec: parseTLE(tle.line1, tle.line2),
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
      showToast(`${count} uydu eklendi`, 'success');
    }
  } catch (err) {
    console.warn('Import failed:', err);
  }
}

async function addSatellite(noradId) {
  if (satellites.find(s => s.noradId === noradId)) {
    showToast('Bu uydu zaten ekli', 'warning');
    return;
  }
  try {
    const tle = await fetchTLE(noradId);
    satellites.push({
      noradId,
      name: tle.name,
      color: getColor(satellites.length),
      satrec: parseTLE(tle.line1, tle.line2),
      tle: { line1: tle.line1, line2: tle.line2 },
    });
    renderLeft();
    showToast(`${tle.name} eklendi`, 'success');
  } catch (err) {
    showToast(`TLE alınamadı: ${err.message}`, 'error');
  }
}

function removeSatellite(noradId) {
  const sat = satellites.find(s => s.noradId === noradId);
  if (!sat) return;
  if (sat.entity) viewer.entities.remove(sat.entity);
  if (sat.trailEntity) viewer.entities.remove(sat.trailEntity);
  satellites = satellites.filter(s => s.noradId !== noradId);
  // Remove from any constellations
  for (const c of constellations) {
    c.satNoradIds = c.satNoradIds.filter(id => id !== noradId);
  }
  saveConstellations();
  renderLeft();
}

// ───────── Constellation CRUD ─────────
function loadConstellations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) constellations = parsed;
  } catch { /* ignore */ }
}

function saveConstellations() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(constellations));
  } catch { /* ignore */ }
}

function createOrUpdateConstellation(name, memberIds, color, existingId) {
  if (existingId && existingId !== 'new') {
    const c = constellations.find(x => x.id === existingId);
    if (c) {
      c.name = name;
      c.satNoradIds = memberIds;
      c.color = color;
    }
  } else {
    const id = `c${Date.now()}`;
    constellations.push({ id, name, satNoradIds: memberIds, color });
  }
  saveConstellations();
}

function deleteConstellation(id) {
  constellations = constellations.filter(c => c.id !== id);
  saveConstellations();
}

// ───────── UI ─────────
function renderLeft() {
  const c = document.getElementById('con-sections');
  c.innerHTML = '';
  c.append(buildSatSection());
  c.append(buildConstellationSection());
  c.append(buildOptionsSection());
}

function buildSatSection() {
  const sec = el('div', 'con-section');
  const title = el('div', 'con-section-title');
  title.innerHTML = `<span>Uydular (${satellites.length})</span>`;
  sec.append(title);

  const row = el('div', 'con-input-row');
  const input = el('input', 'con-input');
  input.type = 'number';
  input.placeholder = 'NORAD ID';
  const btn = el('button', 'con-btn');
  btn.textContent = 'Ekle';
  const doAdd = async () => {
    const id = parseInt(input.value, 10);
    if (!Number.isFinite(id) || id <= 0) { showToast('Geçersiz ID', 'warning'); return; }
    btn.disabled = true;
    await addSatellite(id);
    input.value = '';
    btn.disabled = false;
  };
  btn.addEventListener('click', doAdd);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  row.append(input, btn);
  sec.append(row);

  const importBtn = el('button', 'con-btn');
  importBtn.textContent = 'Ana Ekrandan Aktar';
  importBtn.style.width = '100%';
  importBtn.style.marginTop = '8px';
  importBtn.style.fontSize = '11px';
  importBtn.addEventListener('click', () => importMainAppSatellites());
  sec.append(importBtn);

  if (satellites.length === 0) {
    const empty = el('div', 'con-empty');
    empty.textContent = 'Henüz uydu yok';
    sec.append(empty);
  } else {
    for (const sat of satellites) {
      const r = el('div', 'con-sat-row' + (selectedSatId === sat.noradId ? ' selected' : ''));
      const chip = el('div', 'con-sat-chip');
      chip.style.background = sat.color;
      const info = el('div', 'con-sat-info');
      info.innerHTML = `
        <div class="con-sat-name">${esc(sat.name)} #${sat.noradId}</div>
        <div class="con-sat-pos" id="pos-${sat.noradId}">---</div>
      `;
      const rm = el('button', 'con-sat-remove');
      rm.textContent = '×';
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        removeSatellite(sat.noradId);
      });
      r.addEventListener('click', () => focusSatellite(sat.noradId));
      r.append(chip, info, rm);
      sec.append(r);
    }
  }
  return sec;
}

function buildConstellationSection() {
  const sec = el('div', 'con-section');
  const title = el('div', 'con-section-title');
  title.innerHTML = `<span>Takımlar (${constellations.length})</span>`;
  const newBtn = el('button', 'con-btn con-btn-sm');
  newBtn.textContent = '+ Yeni';
  newBtn.addEventListener('click', () => {
    editingConstellationId = 'new';
    editingMembers = new Set();
    renderLeft();
  });
  title.append(newBtn);
  sec.append(title);

  if (editingConstellationId) {
    sec.append(buildConstellationEditor());
  }

  if (constellations.length === 0 && !editingConstellationId) {
    const empty = el('div', 'con-empty');
    empty.textContent = 'Uydularını gruplayarak takım (konstellasyon) oluştur.';
    sec.append(empty);
  }

  for (const c of constellations) {
    if (c.id === editingConstellationId) continue;
    sec.append(buildConstellationCard(c));
  }
  return sec;
}

function buildConstellationEditor() {
  const isNew = editingConstellationId === 'new';
  const existing = isNew ? null : constellations.find(c => c.id === editingConstellationId);
  const defaultName = existing?.name || '';
  const defaultColor = existing?.color || '#58a6ff';
  if (!isNew && existing) editingMembers = new Set(existing.satNoradIds);

  const wrap = el('div', 'con-group-card active');
  wrap.innerHTML = `
    <div class="con-group-head">
      <span class="con-group-title">${isNew ? 'Yeni Takım' : 'Düzenle'}</span>
    </div>
  `;

  const nameInput = el('input', 'con-input');
  nameInput.placeholder = 'Takım adı (örn. Starlink-1)';
  nameInput.value = defaultName;
  nameInput.style.marginTop = '8px';
  wrap.append(nameInput);

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = defaultColor;
  colorInput.style.marginTop = '8px';
  colorInput.style.width = '100%';
  colorInput.style.height = '32px';
  colorInput.style.background = '#0d1117';
  colorInput.style.border = '1px solid #30363d';
  colorInput.style.borderRadius = '6px';
  wrap.append(colorInput);

  if (satellites.length === 0) {
    const empty = el('div', 'con-empty');
    empty.textContent = 'Önce uydu ekleyin';
    wrap.append(empty);
  } else {
    const picker = el('div', 'con-picker');
    for (const sat of satellites) {
      const row = el('div', 'con-picker-row');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = editingMembers.has(sat.noradId);
      cb.addEventListener('change', () => {
        if (cb.checked) editingMembers.add(sat.noradId);
        else editingMembers.delete(sat.noradId);
      });
      const dot = el('span');
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${sat.color};display:inline-block;`;
      const name = document.createElement('span');
      name.textContent = `${sat.name} #${sat.noradId}`;
      name.style.fontSize = '12px';
      row.append(cb, dot, name);
      row.addEventListener('click', (e) => {
        if (e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
      });
      picker.append(row);
    }
    wrap.append(picker);
  }

  const actions = el('div');
  actions.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
  const saveBtn = el('button', 'con-btn con-btn-primary');
  saveBtn.textContent = 'Kaydet';
  saveBtn.style.flex = '1';
  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { showToast('İsim gerekli', 'warning'); return; }
    if (editingMembers.size === 0) { showToast('En az bir uydu seçin', 'warning'); return; }
    createOrUpdateConstellation(
      name, [...editingMembers], colorInput.value,
      editingConstellationId === 'new' ? null : editingConstellationId
    );
    editingConstellationId = null;
    editingMembers.clear();
    renderLeft();
    showToast('Takım kaydedildi', 'success');
  });
  const cancelBtn = el('button', 'con-btn');
  cancelBtn.textContent = 'Vazgeç';
  cancelBtn.addEventListener('click', () => {
    editingConstellationId = null;
    editingMembers.clear();
    renderLeft();
  });
  actions.append(saveBtn, cancelBtn);
  wrap.append(actions);
  return wrap;
}

function buildConstellationCard(c) {
  const card = el('div', 'con-group-card');
  const head = el('div', 'con-group-head');
  const titleWrap = document.createElement('div');
  titleWrap.innerHTML = `
    <div class="con-group-title" style="color:${c.color};">${esc(c.name)}</div>
    <div class="con-group-count">${c.satNoradIds.length} uydu</div>
  `;
  const actions = el('div', 'con-group-actions');
  const focusBtn = el('button', 'con-btn con-btn-sm');
  focusBtn.textContent = 'Odakla';
  focusBtn.addEventListener('click', () => focusConstellation(c.id));
  const editBtn = el('button', 'con-btn con-btn-sm');
  editBtn.textContent = 'Düzenle';
  editBtn.addEventListener('click', () => {
    editingConstellationId = c.id;
    editingMembers = new Set(c.satNoradIds);
    renderLeft();
  });
  const delBtn = el('button', 'con-btn con-btn-sm');
  delBtn.textContent = '×';
  delBtn.style.color = '#f85149';
  delBtn.addEventListener('click', () => {
    if (confirm(`${c.name} takımını sil?`)) {
      deleteConstellation(c.id);
      renderLeft();
    }
  });
  actions.append(focusBtn, editBtn, delBtn);
  head.append(titleWrap, actions);
  card.append(head);

  const members = el('div', 'con-group-members');
  for (const id of c.satNoradIds) {
    const sat = satellites.find(s => s.noradId === id);
    const chip = el('div', 'con-group-chip');
    const dot = el('span', 'chip-dot');
    dot.style.background = sat ? sat.color : '#8b949e';
    const nm = document.createElement('span');
    nm.textContent = sat ? `${sat.name}` : `#${id} (eksik)`;
    chip.append(dot, nm);
    members.append(chip);
  }
  card.append(members);
  return card;
}

function buildOptionsSection() {
  const sec = el('div', 'con-section');
  const title = el('div', 'con-section-title');
  title.innerHTML = '<span>Görünüm</span>';
  sec.append(title);

  const trailRow = el('div');
  trailRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
  const trailCb = document.createElement('input');
  trailCb.type = 'checkbox';
  trailCb.checked = showTrails;
  trailCb.addEventListener('change', () => {
    showTrails = trailCb.checked;
    updateTrails();
  });
  const trailLbl = document.createElement('label');
  trailLbl.textContent = 'Yörünge izleri';
  trailLbl.style.fontSize = '12px';
  trailRow.append(trailCb, trailLbl);
  sec.append(trailRow);

  const slRow = el('div');
  slRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const lbl = document.createElement('label');
  lbl.textContent = 'İz süresi:';
  lbl.style.fontSize = '12px';
  const sl = document.createElement('input');
  sl.type = 'range';
  sl.min = 5; sl.max = 120; sl.step = 5;
  sl.value = trailMinutes;
  sl.style.flex = '1';
  const val = document.createElement('span');
  val.textContent = `${trailMinutes} dk`;
  val.style.cssText = 'font-family:monospace;font-size:12px;color:#58a6ff;min-width:40px;text-align:right;';
  sl.addEventListener('input', () => {
    trailMinutes = parseInt(sl.value, 10);
    val.textContent = `${trailMinutes} dk`;
    updateTrails();
  });
  slRow.append(lbl, sl, val);
  sec.append(slRow);

  return sec;
}

// ───────── Visualization / ticking ─────────
function startTickLoop() {
  tick();
  tickInterval = setInterval(tick, 1000);
}

function tick() {
  const now = new Date();
  const clk = document.getElementById('con-clock');
  if (clk) clk.textContent = now.toLocaleTimeString('tr-TR', { hour12: false });

  for (const sat of satellites) {
    const pos = propagateAt(sat.satrec, now);
    if (!pos) continue;
    const altM = pos.alt * 1000;
    const cart = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, altM);

    // Update live position label
    const el = document.getElementById(`pos-${sat.noradId}`);
    if (el) el.textContent = `${pos.lat.toFixed(2)}°, ${pos.lon.toFixed(2)}° · ${pos.alt.toFixed(0)} km`;

    // Create or update satellite entity
    if (!sat.entity) {
      sat.entity = viewer.entities.add({
        position: cart,
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString(sat.color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
        label: {
          text: sat.name,
          font: 'bold 11px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          showBackground: false,
          scale: 0.9,
        },
      });
    } else {
      sat.entity.position = cart;
    }
  }

  updateTrails();
}

function updateTrails() {
  const now = new Date();
  for (const sat of satellites) {
    if (sat.trailEntity) {
      viewer.entities.remove(sat.trailEntity);
      sat.trailEntity = null;
    }
    if (!showTrails) continue;

    const points = [];
    const stepS = 20;
    const windowS = trailMinutes * 60;
    for (let dt = -windowS; dt <= windowS; dt += stepS) {
      const t = new Date(now.getTime() + dt * 1000);
      const p = propagateAt(sat.satrec, t);
      if (p) points.push(p.lon, p.lat, p.alt * 1000);
    }
    if (points.length < 6) continue;

    sat.trailEntity = viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights(points),
        width: 1.5,
        material: Cesium.Color.fromCssColorString(sat.color).withAlpha(0.35),
      },
    });
  }
}

function focusSatellite(noradId) {
  selectedSatId = noradId;
  const sat = satellites.find(s => s.noradId === noradId);
  if (!sat || !sat.entity) { renderLeft(); return; }
  const now = new Date();
  const pos = propagateAt(sat.satrec, now);
  if (!pos) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat - 10, pos.alt * 1000 * 3),
    duration: 1.2,
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
  });
  renderLeft();
}

function focusConstellation(id) {
  const c = constellations.find(x => x.id === id);
  if (!c || c.satNoradIds.length === 0) return;
  const now = new Date();
  let sumLat = 0, sumLon = 0, maxAlt = 0, n = 0;
  for (const noradId of c.satNoradIds) {
    const sat = satellites.find(s => s.noradId === noradId);
    if (!sat) continue;
    const pos = propagateAt(sat.satrec, now);
    if (!pos) continue;
    sumLat += pos.lat; sumLon += pos.lon;
    if (pos.alt > maxAlt) maxAlt = pos.alt;
    n++;
  }
  if (n === 0) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(sumLon / n, sumLat / n - 15, maxAlt * 1000 * 4),
    duration: 1.5,
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-50), roll: 0 },
  });
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

function showToast(message, type = 'info') {
  document.querySelectorAll('.con-toast').forEach(t => t.remove());
  const t = el('div', `con-toast ${type}`);
  t.textContent = message;
  document.body.append(t);
  setTimeout(() => t.remove(), 3000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
