/**
 * Antenna Tracking Visualization — 3D antenna + polar sky plot.
 * Shows how the ground station antenna tracks a satellite during a pass.
 */

import './styles/antenna.css';
import { fetchTLE } from './sat/fetch.js';
import { parseTLE, predictPasses, getLookAngles } from './sat/propagate.js';
import { GROUND_STATIONS } from './sat/presets.js';

const STORAGE_KEY = 'sat-groundtrack-state';
const gs = GROUND_STATIONS[0];

let satellites = [];
let selectedSatId = null;
let selectedPassIdx = 0;
let passTrackData = []; // [{time, az, el, range}]
let animT = 0; // 0..1 progress
let animPlaying = false;
let animTimer = null;
let animSpeed = 1; // 1x real-time compression

// ===== Init =====

function init() {
  loadSatellites();
  buildUI();
  restoreTLEs();
}

function loadSatellites() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed.satellites)) {
      satellites = parsed.satellites.map(s => ({
        noradId: s.noradId,
        name: s.name,
        color: s.color,
        satrec: null,
        passes: null,
      }));
      selectedSatId = satellites.length > 0 ? satellites[0].noradId : null;
    }
  } catch { /* ignore */ }
}

async function restoreTLEs() {
  const statusEl = document.getElementById('ant-status');
  for (const sat of satellites) {
    try {
      if (statusEl) statusEl.textContent = `${sat.name} TLE yükleniyor...`;
      const tle = await fetchTLE(sat.noradId);
      sat.satrec = parseTLE(tle.line1, tle.line2);
      sat.name = tle.name;
      sat.passes = predictPasses(sat.satrec, gs, 7);
    } catch {
      if (statusEl) statusEl.textContent = `${sat.name} TLE yüklenemedi`;
    }
  }
  if (statusEl) statusEl.textContent = '';
  onSatChanged();
}

// ===== UI =====

function buildUI() {
  const app = document.getElementById('antenna-app');
  app.innerHTML = `
    <header class="ant-header">
      <div class="ant-header-top">
        <h1>Anten Takip</h1>
        <div class="ant-header-links">
          <a href="./index.html" class="ant-link">Harita</a>
          <a href="./mobile.html" class="ant-link">Mobil</a>
        </div>
      </div>
      <div class="ant-gs">${gs.name} — ${gs.lat.toFixed(4)}°N, ${gs.lon.toFixed(4)}°E, ${gs.alt}m</div>
      <div id="ant-status" class="ant-status"></div>
    </header>

    <div class="ant-controls">
      <div class="ant-select-row">
        <label>Uydu</label>
        <select id="ant-sat-select"></select>
      </div>
      <div class="ant-select-row">
        <label>Geçiş</label>
        <select id="ant-pass-select"></select>
      </div>
    </div>

    <div class="ant-viz-container">
      <div class="ant-viz-panel">
        <div class="ant-viz-title">3B Anten Görünümü</div>
        <canvas id="ant-3d" width="500" height="400"></canvas>
      </div>
      <div class="ant-viz-panel">
        <div class="ant-viz-title">Gökyüzü Haritası (Polar Plot)</div>
        <canvas id="ant-polar" width="400" height="400"></canvas>
      </div>
    </div>

    <div class="ant-data-strip" id="ant-data-strip">
      <div class="ant-data-item">
        <span class="ant-data-label">Azimut</span>
        <span class="ant-data-value" id="d-az">—</span>
      </div>
      <div class="ant-data-item">
        <span class="ant-data-label">Yükseklik</span>
        <span class="ant-data-value" id="d-el">—</span>
      </div>
      <div class="ant-data-item">
        <span class="ant-data-label">Mesafe</span>
        <span class="ant-data-value" id="d-range">—</span>
      </div>
      <div class="ant-data-item">
        <span class="ant-data-label">Zaman</span>
        <span class="ant-data-value" id="d-time">—</span>
      </div>
    </div>

    <div class="ant-timeline">
      <div class="ant-timeline-buttons">
        <button id="ant-play" class="ant-btn">▶ Oynat</button>
        <button id="ant-reset" class="ant-btn">⏮ Başa</button>
        <div class="ant-speed">
          <label>Hız</label>
          <select id="ant-speed-select">
            <option value="0.5">0.5x</option>
            <option value="1" selected>1x</option>
            <option value="2">2x</option>
            <option value="5">5x</option>
            <option value="10">10x</option>
          </select>
        </div>
      </div>
      <div class="ant-slider-row">
        <span id="ant-time-start" class="ant-time-label">--:--</span>
        <input type="range" id="ant-slider" min="0" max="1000" value="0" class="ant-slider" />
        <span id="ant-time-end" class="ant-time-label">--:--</span>
      </div>
    </div>
  `;

  // Populate satellite select
  const satSel = document.getElementById('ant-sat-select');
  for (const sat of satellites) {
    const opt = document.createElement('option');
    opt.value = sat.noradId;
    opt.textContent = sat.name;
    if (sat.noradId === selectedSatId) opt.selected = true;
    satSel.append(opt);
  }
  satSel.addEventListener('change', () => {
    selectedSatId = parseInt(satSel.value, 10);
    selectedPassIdx = 0;
    onSatChanged();
  });

  document.getElementById('ant-pass-select').addEventListener('change', (e) => {
    selectedPassIdx = parseInt(e.target.value, 10);
    onPassChanged();
  });

  document.getElementById('ant-play').addEventListener('click', togglePlay);
  document.getElementById('ant-reset').addEventListener('click', resetAnim);
  document.getElementById('ant-slider').addEventListener('input', (e) => {
    animT = parseInt(e.target.value, 10) / 1000;
    stopAnim();
    renderFrame();
  });
  document.getElementById('ant-speed-select').addEventListener('change', (e) => {
    animSpeed = parseFloat(e.target.value);
  });
}

function populatePassSelect() {
  const passSel = document.getElementById('ant-pass-select');
  passSel.innerHTML = '';
  const sat = satellites.find(s => s.noradId === selectedSatId);
  if (!sat || !sat.passes) return;

  sat.passes.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    const isPast = p.los.getTime() < Date.now();
    const label = `${fmtDateTime(p.aos)} — ${p.maxEl.toFixed(1)}°${isPast ? ' (geçmiş)' : ''}`;
    opt.textContent = label;
    if (i === selectedPassIdx) opt.selected = true;
    passSel.append(opt);
  });
}

// ===== Pass Data =====

function onSatChanged() {
  selectedPassIdx = 0;
  const sat = satellites.find(s => s.noradId === selectedSatId);
  if (sat && sat.passes) {
    // Auto-select next upcoming pass
    const now = Date.now();
    const nextIdx = sat.passes.findIndex(p => p.los.getTime() > now);
    if (nextIdx >= 0) selectedPassIdx = nextIdx;
  }
  populatePassSelect();
  onPassChanged();
}

function onPassChanged() {
  stopAnim();
  animT = 0;
  document.getElementById('ant-slider').value = 0;
  computePassTrack();
  renderFrame();
}

function computePassTrack() {
  passTrackData = [];
  const sat = satellites.find(s => s.noradId === selectedSatId);
  if (!sat || !sat.satrec || !sat.passes || !sat.passes[selectedPassIdx]) return;

  const pass = sat.passes[selectedPassIdx];
  const aosMs = pass.aos.getTime();
  const losMs = pass.los.getTime();
  const duration = losMs - aosMs;
  const steps = Math.max(60, Math.ceil(duration / 1000)); // ~1 per second

  for (let i = 0; i <= steps; i++) {
    const t = aosMs + (duration * i) / steps;
    const date = new Date(t);
    const look = getLookAngles(sat.satrec, date, gs);
    if (look) {
      passTrackData.push({
        time: t,
        az: look.azimuth,
        el: look.elevation,
        range: look.rangeSat,
      });
    }
  }

  // Update time labels
  document.getElementById('ant-time-start').textContent = fmtTime(pass.aos);
  document.getElementById('ant-time-end').textContent = fmtTime(pass.los);
}

function getCurrentData() {
  if (passTrackData.length === 0) return null;
  const idx = Math.min(Math.floor(animT * (passTrackData.length - 1)), passTrackData.length - 1);
  return passTrackData[idx];
}

// ===== Animation =====

function togglePlay() {
  if (animPlaying) stopAnim();
  else startAnim();
}

function startAnim() {
  if (passTrackData.length === 0) return;
  animPlaying = true;
  document.getElementById('ant-play').textContent = '⏸ Durdur';

  const sat = satellites.find(s => s.noradId === selectedSatId);
  const pass = sat.passes[selectedPassIdx];
  const duration = pass.los.getTime() - pass.aos.getTime();
  // Duration in real ms at 1x speed = actual pass duration
  // We compress it: at 1x speed, play in duration/60 ms (1 minute playback for any pass)
  const playbackMs = (duration / animSpeed) / 60;
  const stepMs = 33; // ~30fps
  const stepT = stepMs / playbackMs;

  if (animT >= 0.999) animT = 0;

  animTimer = setInterval(() => {
    animT += stepT;
    if (animT >= 1) {
      animT = 1;
      stopAnim();
    }
    document.getElementById('ant-slider').value = Math.round(animT * 1000);
    renderFrame();
  }, stepMs);
}

function stopAnim() {
  animPlaying = false;
  if (animTimer) { clearInterval(animTimer); animTimer = null; }
  document.getElementById('ant-play').textContent = '▶ Oynat';
}

function resetAnim() {
  stopAnim();
  animT = 0;
  document.getElementById('ant-slider').value = 0;
  renderFrame();
}

// ===== Render =====

function renderFrame() {
  const data = getCurrentData();
  updateDataStrip(data);
  draw3DAntenna(data);
  drawPolarPlot(data);
}

function updateDataStrip(data) {
  if (!data) {
    document.getElementById('d-az').textContent = '—';
    document.getElementById('d-el').textContent = '—';
    document.getElementById('d-range').textContent = '—';
    document.getElementById('d-time').textContent = '—';
    return;
  }
  document.getElementById('d-az').textContent = data.az.toFixed(2) + '°';
  document.getElementById('d-el').textContent = data.el.toFixed(2) + '°';
  document.getElementById('d-range').textContent = data.range.toFixed(1) + ' km';
  document.getElementById('d-time').textContent = fmtTime(new Date(data.time));
}

// ===== 3D Antenna Canvas =====

function draw3DAntenna(data) {
  const canvas = document.getElementById('ant-3d');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const az = data ? data.az : 0;
  const el = data ? Math.max(0, data.el) : 45;
  const azRad = (az - 90) * Math.PI / 180; // offset so 0° (North) is "up" in view
  const elRad = el * Math.PI / 180;

  const cx = W / 2;
  const cy = H * 0.75; // ground level

  // Sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, cy);
  skyGrad.addColorStop(0, '#0a0e1a');
  skyGrad.addColorStop(1, '#1a1e2e');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, cy);

  // Ground
  const gndGrad = ctx.createLinearGradient(0, cy, 0, H);
  gndGrad.addColorStop(0, '#1a2a1a');
  gndGrad.addColorStop(1, '#0d1a0d');
  ctx.fillStyle = gndGrad;
  ctx.fillRect(0, cy, W, H - cy);

  // Grid lines on ground (perspective)
  ctx.strokeStyle = 'rgba(63, 185, 80, 0.1)';
  ctx.lineWidth = 0.5;
  for (let i = -8; i <= 8; i++) {
    const x1 = cx + i * 30;
    const x2 = cx + i * 80;
    ctx.beginPath();
    ctx.moveTo(x1, cy);
    ctx.lineTo(x2, H);
    ctx.stroke();
  }
  for (let j = 1; j <= 4; j++) {
    const y = cy + j * (H - cy) / 4;
    const spread = 0.3 + 0.7 * (j / 4);
    ctx.beginPath();
    ctx.moveTo(cx - 250 * spread, y);
    ctx.lineTo(cx + 250 * spread, y);
    ctx.stroke();
  }

  // Stars
  const starSeed = [0.1, 0.3, 0.5, 0.7, 0.85, 0.15, 0.45, 0.65, 0.9, 0.25, 0.55, 0.78, 0.05, 0.35, 0.62];
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  for (let i = 0; i < starSeed.length; i++) {
    const sx = starSeed[i] * W;
    const sy = starSeed[(i + 5) % starSeed.length] * cy * 0.85;
    ctx.beginPath();
    ctx.arc(sx, sy, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Compass labels
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('K', cx, cy - 5);
  ctx.fillText('G', cx, H - 4);
  ctx.fillText('D', W - 20, cy + 15);
  ctx.fillText('B', 20, cy + 15);

  // --- Antenna Base ---
  const baseW = 40;
  const baseH = 12;
  ctx.fillStyle = '#3a4a5a';
  ctx.fillRect(cx - baseW / 2, cy - baseH, baseW, baseH);
  ctx.fillStyle = '#2a3a4a';
  ctx.fillRect(cx - baseW / 2 - 4, cy - baseH - 3, baseW + 8, 4);

  // --- Pedestal ---
  const pedH = 50;
  const pedW = 8;
  ctx.fillStyle = '#4a5a6a';
  ctx.fillRect(cx - pedW / 2, cy - baseH - pedH, pedW, pedH);

  // Pivot point
  const pivotX = cx;
  const pivotY = cy - baseH - pedH;

  // --- Dish ---
  // The dish tilts based on elevation and rotates in azimuth
  // We'll project the dish as an ellipse that changes shape with azimuth
  // and tilts angle with elevation

  ctx.save();
  ctx.translate(pivotX, pivotY);

  // Azimuth affects the apparent orientation (foreshortening)
  const azView = Math.sin(azRad); // -1..1, how much dish faces left/right

  // Dish arm pointing toward satellite
  const armLen = 55;
  const armAngle = -elRad; // tilt up
  const armDx = azView * Math.cos(armAngle) * armLen;
  const armDy = Math.sin(armAngle) * armLen;

  // Signal beam (before dish so it's behind)
  if (data && data.el > 0) {
    const beamLen = 130;
    const beamDx = azView * Math.cos(armAngle) * beamLen;
    const beamDy = Math.sin(armAngle) * beamLen;

    const beamGrad = ctx.createLinearGradient(armDx, armDy, beamDx, beamDy);
    beamGrad.addColorStop(0, 'rgba(93, 170, 255, 0.25)');
    beamGrad.addColorStop(0.5, 'rgba(93, 170, 255, 0.08)');
    beamGrad.addColorStop(1, 'rgba(93, 170, 255, 0)');

    const spread = 20;
    const perpX = -Math.sin(armAngle) * azView;
    const perpY = Math.cos(armAngle);

    ctx.beginPath();
    ctx.moveTo(armDx - perpX * 5, armDy - perpY * 5);
    ctx.lineTo(beamDx - perpX * spread, beamDy - perpY * spread);
    ctx.lineTo(beamDx + perpX * spread, beamDy + perpY * spread);
    ctx.lineTo(armDx + perpX * 5, armDy + perpY * 5);
    ctx.closePath();
    ctx.fillStyle = beamGrad;
    ctx.fill();
  }

  // Draw arm
  ctx.strokeStyle = '#6a7a8a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(armDx, armDy);
  ctx.stroke();

  // Draw dish (parabola shape)
  const dishW = 36 * Math.abs(Math.cos(azRad)) + 8; // foreshortened by azimuth
  const dishH = 36;
  const dishCurve = 12;

  ctx.save();
  ctx.translate(armDx, armDy);
  // Rotate dish to face the right direction
  const dishAngle = Math.atan2(armDy, armDx);
  ctx.rotate(dishAngle);

  // Dish back (parabola)
  ctx.beginPath();
  ctx.moveTo(0, -dishH / 2);
  ctx.quadraticCurveTo(-dishCurve, 0, 0, dishH / 2);
  ctx.strokeStyle = '#8a9aaa';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Dish fill
  ctx.beginPath();
  ctx.moveTo(0, -dishH / 2);
  ctx.quadraticCurveTo(-dishCurve, 0, 0, dishH / 2);
  ctx.lineTo(0, -dishH / 2);
  const dishGrad = ctx.createLinearGradient(-dishCurve, 0, 4, 0);
  dishGrad.addColorStop(0, 'rgba(120, 140, 170, 0.6)');
  dishGrad.addColorStop(1, 'rgba(80, 100, 130, 0.3)');
  ctx.fillStyle = dishGrad;
  ctx.fill();

  // Dish rim
  ctx.beginPath();
  ctx.moveTo(0, -dishH / 2);
  ctx.quadraticCurveTo(-dishCurve - 2, 0, 0, dishH / 2);
  ctx.strokeStyle = '#aabbcc';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Feed horn
  ctx.fillStyle = '#5daaff';
  ctx.beginPath();
  ctx.arc(4, 0, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore(); // undo dish rotation
  ctx.restore(); // undo pivot translation

  // --- Satellite indicator ---
  if (data && data.el > 0) {
    // Position satellite in the sky area
    const skyH = cy - 20;
    const satScreenX = cx + azView * Math.cos(elRad) * 180;
    const satScreenY = cy - 20 - (el / 90) * skyH * 0.85;

    // Satellite glow
    const glowGrad = ctx.createRadialGradient(satScreenX, satScreenY, 0, satScreenX, satScreenY, 20);
    glowGrad.addColorStop(0, 'rgba(93, 170, 255, 0.4)');
    glowGrad.addColorStop(1, 'rgba(93, 170, 255, 0)');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(satScreenX, satScreenY, 20, 0, Math.PI * 2);
    ctx.fill();

    // Satellite body
    ctx.fillStyle = '#aabbcc';
    ctx.fillRect(satScreenX - 4, satScreenY - 2, 8, 4);
    // Solar panels
    ctx.fillStyle = '#5daaff';
    ctx.fillRect(satScreenX - 12, satScreenY - 1.5, 7, 3);
    ctx.fillRect(satScreenX + 5, satScreenY - 1.5, 7, 3);

    // Label
    ctx.fillStyle = 'rgba(93, 170, 255, 0.8)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    const sat = satellites.find(s => s.noradId === selectedSatId);
    ctx.fillText(sat ? sat.name : '', satScreenX, satScreenY - 14);
  }

  // Az/El overlay text
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = '13px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`Az: ${az.toFixed(1)}°`, 10, 20);
  ctx.fillText(`El: ${el.toFixed(1)}°`, 10, 36);
}

// ===== Polar Sky Plot =====

function drawPolarPlot(currentData) {
  const canvas = document.getElementById('ant-polar');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(cx, cy) - 30;

  // Background
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  // Elevation circles (0°, 30°, 60°, 90°)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 0.8;
  for (const elev of [0, 15, 30, 45, 60, 75]) {
    const r = R * (1 - elev / 90);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Labels
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  for (const elev of [0, 30, 60]) {
    const r = R * (1 - elev / 90);
    ctx.fillText(elev + '°', cx + r + 14, cy + 4);
  }

  // Azimuth lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  for (let a = 0; a < 360; a += 30) {
    const rad = (a - 90) * Math.PI / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(rad), cy + R * Math.sin(rad));
    ctx.stroke();
  }

  // Cardinal directions
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('K', cx, cy - R - 14);
  ctx.fillText('G', cx, cy + R + 14);
  ctx.fillText('D', cx + R + 14, cy);
  ctx.fillText('B', cx - R - 14, cy);

  // Satellite track
  if (passTrackData.length > 1) {
    ctx.beginPath();
    let first = true;
    for (const pt of passTrackData) {
      if (pt.el < 0) continue;
      const r = R * (1 - pt.el / 90);
      const a = (pt.az - 90) * Math.PI / 180;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(93, 170, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dashed track for future part
    if (currentData) {
      const currentIdx = Math.floor(animT * (passTrackData.length - 1));

      // Solid past
      ctx.beginPath();
      first = true;
      for (let i = 0; i <= currentIdx && i < passTrackData.length; i++) {
        const pt = passTrackData[i];
        if (pt.el < 0) continue;
        const r = R * (1 - pt.el / 90);
        const a = (pt.az - 90) * Math.PI / 180;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (first) { ctx.moveTo(x, y); first = false; }
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#5daaff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // AOS / LOS markers
    const aosP = passTrackData[0];
    const losP = passTrackData[passTrackData.length - 1];
    if (aosP.el >= 0) {
      const r = R * (1 - aosP.el / 90);
      const a = (aosP.az - 90) * Math.PI / 180;
      ctx.fillStyle = '#3fb950';
      ctx.beginPath();
      ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(63, 185, 80, 0.7)';
      ctx.font = '10px sans-serif';
      ctx.fillText('AOS', cx + r * Math.cos(a), cy + r * Math.sin(a) - 10);
    }
    if (losP.el >= 0) {
      const r = R * (1 - losP.el / 90);
      const a = (losP.az - 90) * Math.PI / 180;
      ctx.fillStyle = '#f85149';
      ctx.beginPath();
      ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(248, 81, 73, 0.7)';
      ctx.font = '10px sans-serif';
      ctx.fillText('LOS', cx + r * Math.cos(a), cy + r * Math.sin(a) - 10);
    }

    // TCA (max elevation) marker
    let tcaPt = passTrackData[0];
    for (const pt of passTrackData) {
      if (pt.el > tcaPt.el) tcaPt = pt;
    }
    const tcaR = R * (1 - tcaPt.el / 90);
    const tcaA = (tcaPt.az - 90) * Math.PI / 180;
    ctx.strokeStyle = 'rgba(210, 153, 34, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx + tcaR * Math.cos(tcaA), cy + tcaR * Math.sin(tcaA), 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(210, 153, 34, 0.7)';
    ctx.font = '10px sans-serif';
    ctx.fillText(`TCA ${tcaPt.el.toFixed(1)}°`, cx + tcaR * Math.cos(tcaA) + 10, cy + tcaR * Math.sin(tcaA) - 4);
  }

  // Current position marker
  if (currentData && currentData.el >= 0) {
    const r = R * (1 - currentData.el / 90);
    const a = (currentData.az - 90) * Math.PI / 180;
    const px = cx + r * Math.cos(a);
    const py = cy + r * Math.sin(a);

    // Glow
    const glow = ctx.createRadialGradient(px, py, 0, px, py, 14);
    glow.addColorStop(0, 'rgba(93, 170, 255, 0.5)');
    glow.addColorStop(1, 'rgba(93, 170, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(px, py, 14, 0, Math.PI * 2);
    ctx.fill();

    // Dot
    ctx.fillStyle = '#5daaff';
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// ===== Helpers =====

function fmtTime(date) {
  return date.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function fmtDateTime(date) {
  return date.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}

// ===== Start =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
