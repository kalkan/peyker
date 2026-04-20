/**
 * Animasyon ve Kayıt
 *
 * Cesium-based animated visualization of satellite movement + image
 * capture events, with canvas recording to WebM via MediaRecorder.
 *
 * Flow:
 *  1. Import satellites + target (URL params or localStorage from main app)
 *  2. Pick a time window + playback speed
 *  3. "Sahneyi Hazırla" pre-samples positions as Cesium
 *     SampledPositionProperty so animation interpolates smoothly
 *  4. Capture events (when satellite is near target) highlighted with
 *     time-bounded footprint polygons
 *  5. "Kaydı Başlat" captures the Cesium canvas as a WebM stream;
 *     "Durdur" offers download
 */

import './styles/animation.css';
import { fetchTLE } from './sat/fetch.js';
import { parseTLE, propagateAt } from './sat/propagate.js';
import { getColor } from './sat/presets.js';

/* global Cesium */

// ───────── State ─────────
let viewer = null;
let satellites = []; // { noradId, name, color, satrec, tle }
let targetLat = null, targetLon = null, targetName = null;
let sceneReady = false;
let windowStart = null; // Date
let windowEnd = null;
let playbackMultiplier = 60;
const SPEED_OPTIONS = [1, 10, 60, 300, 900, 3600];

// Recording
let mediaRecorder = null;
let recordedChunks = [];
let recordingDownloadUrl = null;
let recording = false;
let recordStartMs = 0;

// Capture detection (for scene setup)
const CAPTURE_ROLL_THRESHOLD_DEG = 15;

// ───────── Init ─────────
function init() {
  const app = document.getElementById('animation-app');
  if (!app) return;

  const panel = document.createElement('div');
  panel.className = 'anim-panel';
  panel.innerHTML = `
    <div class="anim-header">
      <div style="display:flex;align-items:center;gap:8px;">
        <h1>Animasyon</h1>
        <span class="anim-badge">Kayıt</span>
      </div>
      <div class="anim-nav">
        <a href="./imaging.html#3d" title="3D Planlayıcıya Dön">3D</a>
        <a href="./index.html" title="Ana Sayfa">Ana</a>
      </div>
    </div>
    <div id="anim-sections"></div>
  `;
  app.append(panel);

  const viewerWrap = document.createElement('div');
  viewerWrap.className = 'anim-viewer';
  viewerWrap.innerHTML = '<div id="cesiumContainer"></div>';
  app.append(viewerWrap);

  if (typeof Cesium === 'undefined') {
    showToast('Cesium yüklenemedi', 'error');
    return;
  }

  initCesium();
  applyUrlParams();
  importMainAppSatellites();
  // Default: 30 min window starting now
  windowStart = new Date();
  windowEnd = new Date(windowStart.getTime() + 30 * 60 * 1000);
  renderLeft();
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
    animation: true,   // keep Cesium's built-in animation widget for scrubbing
    timeline: true,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: false,
  });
  viewer.scene.globe.enableLighting = true;
  viewer.scene.skyAtmosphere.show = true;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(35, 39, 12_000_000),
    duration: 0,
  });

  // Click to set target
  viewer.screenSpaceEventHandler.setInputAction((click) => {
    const cart = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
    if (!cart) return;
    const carto = Cesium.Cartographic.fromCartesian(cart);
    targetLat = Cesium.Math.toDegrees(carto.latitude);
    targetLon = Cesium.Math.toDegrees(carto.longitude);
    targetName = 'Harita noktası';
    drawTargetPin();
    renderLeft();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function applyUrlParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    const t = p.get('target');
    if (t) {
      const [la, lo] = t.split(',').map(s => parseFloat(s));
      if (isFinite(la) && isFinite(lo)) {
        targetLat = la;
        targetLon = lo;
        targetName = p.get('name') || 'Paylaşılan hedef';
        drawTargetPin();
      }
    }
  } catch { /* ignore */ }
}

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
    let n = 0;
    for (const r of settled) {
      if (r.status === 'fulfilled' && !satellites.find(x => x.noradId === r.value.noradId)) {
        satellites.push(r.value);
        n++;
      }
    }
    if (n > 0) { renderLeft(); showToast(`${n} uydu eklendi`, 'success'); }
  } catch (err) {
    console.warn('Import failed:', err);
  }
}

// ───────── Left panel ─────────
function renderLeft() {
  const c = document.getElementById('anim-sections');
  c.innerHTML = '';
  c.append(buildTargetSection());
  c.append(buildSatSection());
  c.append(buildWindowSection());
  c.append(buildPlaybackSection());
  c.append(buildRecordSection());
}

function buildTargetSection() {
  const sec = el('div', 'anim-section');
  sec.innerHTML = '<div class="anim-section-title">Hedef</div>';

  const row = el('div', 'anim-input-row');
  const lat = el('input', 'anim-input');
  lat.type = 'number'; lat.step = '0.0001'; lat.placeholder = 'Enlem';
  lat.value = targetLat != null ? targetLat.toFixed(4) : '';
  const lon = el('input', 'anim-input');
  lon.type = 'number'; lon.step = '0.0001'; lon.placeholder = 'Boylam';
  lon.value = targetLon != null ? targetLon.toFixed(4) : '';
  const btn = el('button', 'anim-btn');
  btn.textContent = 'Ayarla';
  btn.addEventListener('click', () => {
    const la = parseFloat(lat.value), lo = parseFloat(lon.value);
    if (isFinite(la) && isFinite(lo)) {
      targetLat = la; targetLon = lo; targetName = 'Manuel';
      drawTargetPin();
      renderLeft();
    }
  });
  row.append(lat, lon, btn);
  sec.append(row);

  if (targetLat == null) {
    const hint = el('div', 'anim-empty');
    hint.textContent = 'Haritaya tıklayın veya koordinat girin';
    sec.append(hint);
  } else {
    const info = el('div');
    info.style.cssText = 'font-size:12px;color:#58a6ff;margin-top:8px;font-family:monospace;';
    info.textContent = `${targetLat.toFixed(4)}°, ${targetLon.toFixed(4)}°`;
    sec.append(info);
  }
  return sec;
}

function buildSatSection() {
  const sec = el('div', 'anim-section');
  sec.innerHTML = `<div class="anim-section-title">Uydular (${satellites.length})</div>`;

  const row = el('div', 'anim-input-row');
  const input = el('input', 'anim-input');
  input.type = 'number'; input.placeholder = 'NORAD ID';
  const btn = el('button', 'anim-btn');
  btn.textContent = 'Ekle';
  const doAdd = async () => {
    const id = parseInt(input.value, 10);
    if (!Number.isFinite(id) || id <= 0) return;
    if (satellites.find(s => s.noradId === id)) return;
    btn.disabled = true;
    try {
      const tle = await fetchTLE(id);
      satellites.push({
        noradId: id, name: tle.name,
        color: getColor(satellites.length),
        satrec: parseTLE(tle.line1, tle.line2),
        tle: { line1: tle.line1, line2: tle.line2 },
      });
      input.value = ''; renderLeft();
    } catch (err) {
      showToast(err.message, 'error');
    }
    btn.disabled = false;
  };
  btn.addEventListener('click', doAdd);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  row.append(input, btn);
  sec.append(row);

  if (satellites.length === 0) {
    const e = el('div', 'anim-empty');
    e.textContent = 'Uydu ekleyin';
    sec.append(e);
  } else {
    for (const sat of satellites) {
      const r = el('div', 'anim-sat-row');
      const chip = el('div', 'anim-sat-chip');
      chip.style.background = sat.color;
      const n = el('div', 'anim-sat-name');
      n.textContent = `${sat.name} #${sat.noradId}`;
      const rm = el('button', 'anim-sat-remove');
      rm.textContent = '×';
      rm.addEventListener('click', () => {
        satellites = satellites.filter(s => s.noradId !== sat.noradId);
        sceneReady = false;
        clearScene();
        renderLeft();
      });
      r.append(chip, n, rm);
      sec.append(r);
    }
  }
  return sec;
}

function buildWindowSection() {
  const sec = el('div', 'anim-section');
  sec.innerHTML = '<div class="anim-section-title">Zaman Aralığı</div>';

  const startRow = el('div', 'anim-input-row');
  const startInp = el('input', 'anim-input');
  startInp.type = 'datetime-local';
  startInp.value = toDatetimeLocal(windowStart);
  startInp.addEventListener('change', () => {
    const d = new Date(startInp.value);
    if (isFinite(d.getTime())) { windowStart = d; sceneReady = false; }
  });
  startRow.append(startInp);
  sec.append(startRow);

  const endRow = el('div', 'anim-input-row');
  const endInp = el('input', 'anim-input');
  endInp.type = 'datetime-local';
  endInp.value = toDatetimeLocal(windowEnd);
  endInp.addEventListener('change', () => {
    const d = new Date(endInp.value);
    if (isFinite(d.getTime())) { windowEnd = d; sceneReady = false; }
  });
  endRow.append(endInp);
  sec.append(endRow);

  const presetRow = el('div');
  presetRow.style.cssText = 'display:flex;gap:4px;margin-top:8px;';
  const presets = [
    { label: '30 dk', min: 30 },
    { label: '2 sa', min: 120 },
    { label: '6 sa', min: 360 },
    { label: '24 sa', min: 1440 },
  ];
  for (const p of presets) {
    const b = el('button', 'anim-speed-btn');
    b.textContent = p.label;
    b.addEventListener('click', () => {
      windowStart = new Date();
      windowEnd = new Date(windowStart.getTime() + p.min * 60 * 1000);
      sceneReady = false;
      renderLeft();
    });
    presetRow.append(b);
  }
  sec.append(presetRow);

  const prepBtn = el('button', 'anim-btn-primary');
  prepBtn.textContent = sceneReady ? 'Sahne Hazır ✓' : 'Sahneyi Hazırla';
  prepBtn.style.marginTop = '10px';
  prepBtn.disabled = satellites.length === 0;
  prepBtn.addEventListener('click', () => prepareScene());
  sec.append(prepBtn);

  return sec;
}

function buildPlaybackSection() {
  const sec = el('div', 'anim-section');
  sec.innerHTML = '<div class="anim-section-title">Oynatma</div>';

  const row = el('div');
  row.style.cssText = 'display:flex;gap:6px;';
  const playBtn = el('button', 'anim-btn');
  playBtn.textContent = '▶ Oynat';
  playBtn.style.flex = '1';
  playBtn.addEventListener('click', () => {
    if (!sceneReady) { showToast('Önce sahneyi hazırla', 'warning'); return; }
    viewer.clock.shouldAnimate = true;
  });
  const pauseBtn = el('button', 'anim-btn');
  pauseBtn.textContent = '❚❚ Duraklat';
  pauseBtn.style.flex = '1';
  pauseBtn.addEventListener('click', () => { viewer.clock.shouldAnimate = false; });
  const rewindBtn = el('button', 'anim-btn');
  rewindBtn.textContent = '⏮';
  rewindBtn.addEventListener('click', () => {
    if (!sceneReady) return;
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(windowStart);
  });
  row.append(playBtn, pauseBtn, rewindBtn);
  sec.append(row);

  const speedRow = el('div', 'anim-speed-buttons');
  for (const s of SPEED_OPTIONS) {
    const b = el('button', 'anim-speed-btn' + (s === playbackMultiplier ? ' active' : ''));
    b.textContent = s >= 60 ? (s % 3600 === 0 ? `${s / 3600}sa/s` : `${s / 60}dk/s`) : `${s}x`;
    b.addEventListener('click', () => {
      playbackMultiplier = s;
      viewer.clock.multiplier = s;
      renderLeft();
    });
    speedRow.append(b);
  }
  sec.append(speedRow);

  return sec;
}

function buildRecordSection() {
  const sec = el('div', 'anim-section');
  sec.innerHTML = '<div class="anim-section-title">Kayıt</div>';

  if (!recording) {
    const btn = el('button', 'anim-btn-record');
    btn.textContent = '● Kaydı Başlat';
    btn.disabled = !sceneReady;
    btn.addEventListener('click', () => startRecording());
    sec.append(btn);

    if (recordingDownloadUrl) {
      const link = document.createElement('a');
      link.className = 'anim-download-link';
      link.href = recordingDownloadUrl;
      link.download = `peyker-animasyon-${Date.now()}.webm`;
      link.textContent = '⬇ Son kaydı indir (.webm)';
      sec.append(link);
    }

    const hint = el('div', 'anim-empty');
    hint.style.textAlign = 'left';
    hint.style.padding = '6px 0 0 0';
    hint.textContent = 'Kayıt başladığında Cesium tuvali (canvas) WebM formatında kaydedilir.';
    sec.append(hint);
  } else {
    const status = el('div', 'anim-rec-status');
    const dot = el('div', 'anim-rec-dot');
    const txt = document.createElement('span');
    txt.id = 'rec-timer';
    txt.textContent = 'Kaydediliyor… 0s';
    status.append(dot, txt);
    sec.append(status);

    const stopBtn = el('button', 'anim-btn anim-btn-stop');
    stopBtn.textContent = '■ Kaydı Durdur';
    stopBtn.style.width = '100%';
    stopBtn.style.marginTop = '8px';
    stopBtn.addEventListener('click', () => stopRecording());
    sec.append(stopBtn);
  }

  return sec;
}

// ───────── Scene setup ─────────
function clearScene() {
  viewer.entities.removeAll();
  if (targetLat != null) drawTargetPin();
}

function drawTargetPin() {
  // Remove prior target pin
  const existing = viewer.entities.getById('anim-target');
  if (existing) viewer.entities.remove(existing);
  viewer.entities.add({
    id: 'anim-target',
    position: Cesium.Cartesian3.fromDegrees(targetLon, targetLat, 0),
    point: {
      pixelSize: 14,
      color: Cesium.Color.RED,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
    label: {
      text: targetName || 'Hedef',
      font: '12px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -22),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });
}

function prepareScene() {
  if (satellites.length === 0) return;

  clearScene();
  const startJ = Cesium.JulianDate.fromDate(windowStart);
  const endJ = Cesium.JulianDate.fromDate(windowEnd);

  viewer.clock.startTime = startJ.clone();
  viewer.clock.stopTime = endJ.clone();
  viewer.clock.currentTime = startJ.clone();
  viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
  viewer.clock.multiplier = playbackMultiplier;
  viewer.clock.shouldAnimate = false;
  viewer.timeline.zoomTo(startJ, endJ);

  // Sample satellite positions at 30s
  const stepS = 30;
  const totalS = (windowEnd - windowStart) / 1000;
  const samples = Math.min(3000, Math.ceil(totalS / stepS) + 1);
  const actualStepS = totalS / Math.max(1, samples - 1);

  for (const sat of satellites) {
    const positions = new Cesium.SampledPositionProperty();
    const captureIntervals = [];
    let inCapture = false;
    let captureStart = null;

    for (let i = 0; i < samples; i++) {
      const t = new Date(windowStart.getTime() + i * actualStepS * 1000);
      const pos = propagateAt(sat.satrec, t);
      if (!pos) continue;
      positions.addSample(
        Cesium.JulianDate.fromDate(t),
        Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt * 1000)
      );

      // Capture detection
      if (targetLat != null) {
        const dist = haversineKm(pos.lat, pos.lon, targetLat, targetLon);
        const offNadir = Math.atan(dist / pos.alt) * 180 / Math.PI;
        const nowInCapture = offNadir <= CAPTURE_ROLL_THRESHOLD_DEG;
        if (nowInCapture && !inCapture) {
          inCapture = true; captureStart = t;
        } else if (!nowInCapture && inCapture) {
          inCapture = false;
          captureIntervals.push({ start: captureStart, end: t });
          captureStart = null;
        }
      }
    }
    if (inCapture && captureStart) {
      captureIntervals.push({ start: captureStart, end: windowEnd });
    }

    const satColor = Cesium.Color.fromCssColorString(sat.color);

    // Satellite entity with path behind it
    viewer.entities.add({
      id: `sat-${sat.noradId}`,
      availability: new Cesium.TimeIntervalCollection([
        new Cesium.TimeInterval({ start: startJ, stop: endJ }),
      ]),
      position: positions,
      point: {
        pixelSize: 12,
        color: satColor,
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
        scale: 0.9,
      },
      path: {
        material: satColor.withAlpha(0.5),
        width: 1.5,
        leadTime: 0,
        trailTime: 60 * 60, // show 1h trail behind
        resolution: 60,
      },
    });

    // Capture events: brief ring + line to target during each window
    if (targetLat != null) {
      for (let ci = 0; ci < captureIntervals.length; ci++) {
        const cap = captureIntervals[ci];
        const availability = new Cesium.TimeIntervalCollection([
          new Cesium.TimeInterval({
            start: Cesium.JulianDate.fromDate(cap.start),
            stop: Cesium.JulianDate.fromDate(cap.end),
          }),
        ]);
        const tgtPos = Cesium.Cartesian3.fromDegrees(targetLon, targetLat, 0);

        // Beam from satellite to target (only during capture)
        viewer.entities.add({
          id: `cap-beam-${sat.noradId}-${ci}`,
          availability,
          polyline: {
            positions: new Cesium.CallbackProperty(() => {
              const t = viewer.clock.currentTime;
              const p = positions.getValue(t);
              return p ? [p, tgtPos] : [tgtPos, tgtPos];
            }, false),
            width: 2,
            material: new Cesium.PolylineGlowMaterialProperty({
              color: satColor,
              glowPower: 0.3,
            }),
            arcType: Cesium.ArcType.NONE,
          },
        });

        // Expanding ring at the target during capture
        viewer.entities.add({
          id: `cap-ring-${sat.noradId}-${ci}`,
          availability,
          position: tgtPos,
          ellipse: {
            semiMajorAxis: 25000,
            semiMinorAxis: 25000,
            material: satColor.withAlpha(0.35),
            outline: true,
            outlineColor: satColor,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        });
      }
    }
  }

  // Camera fit: mid of window over target (or over mean sat track)
  const midT = new Date((windowStart.getTime() + windowEnd.getTime()) / 2);
  const sample = propagateAt(satellites[0].satrec, midT);
  if (sample) {
    const focalLat = targetLat != null ? targetLat : sample.lat;
    const focalLon = targetLon != null ? targetLon : sample.lon;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(focalLon, focalLat - 8, sample.alt * 1000 * 2.5),
      duration: 1.5,
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
    });
  }

  sceneReady = true;
  renderLeft();
  showToast('Sahne hazır', 'success');
}

// ───────── Recording ─────────
function startRecording() {
  if (!sceneReady) return;
  const canvas = viewer.scene.canvas;
  if (!canvas || typeof canvas.captureStream !== 'function') {
    showToast('Tarayıcı canvas kaydını desteklemiyor', 'error');
    return;
  }

  recordedChunks = [];
  if (recordingDownloadUrl) {
    URL.revokeObjectURL(recordingDownloadUrl);
    recordingDownloadUrl = null;
  }

  const stream = canvas.captureStream(30);
  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  let mime = '';
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) { mime = t; break; }
  }
  if (!mime) {
    showToast('WebM desteklenmiyor', 'error');
    return;
  }

  try {
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
  } catch (err) {
    showToast(`Kayıt başlatılamadı: ${err.message}`, 'error');
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    recordingDownloadUrl = URL.createObjectURL(blob);
    recording = false;
    renderLeft();
    showToast('Kayıt hazır — indirme linki açıldı', 'success');
  };
  mediaRecorder.onerror = (e) => {
    showToast(`Kayıt hatası: ${e.error?.message || 'bilinmeyen'}`, 'error');
  };

  mediaRecorder.start(1000);
  recording = true;
  recordStartMs = Date.now();
  viewer.clock.shouldAnimate = true;
  renderLeft();

  // Update timer
  const timerInterval = setInterval(() => {
    if (!recording) { clearInterval(timerInterval); return; }
    const el = document.getElementById('rec-timer');
    if (el) {
      const s = Math.floor((Date.now() - recordStartMs) / 1000);
      el.textContent = `Kaydediliyor… ${s}s`;
    }
  }, 250);
}

function stopRecording() {
  if (!mediaRecorder || !recording) return;
  try { mediaRecorder.stop(); } catch { /* ignore */ }
}

// ───────── Helpers ─────────
function el(tag, cls) {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  return x;
}

function toDatetimeLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function showToast(message, type = 'info') {
  document.querySelectorAll('.anim-toast').forEach(t => t.remove());
  const t = el('div', `anim-toast ${type}`);
  t.textContent = message;
  document.body.append(t);
  setTimeout(() => t.remove(), 3000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
