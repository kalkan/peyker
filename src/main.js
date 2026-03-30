/**
 * Main entry point for Satellite Ground Track Planner.
 * Orchestrates all modules: map, satellite data, UI, and export.
 */

import 'leaflet/dist/leaflet.css';
import './styles/main.css';
import { initMap, toggleCoverage, refreshGsMarkers, getMap } from './map/setup.js';
import { renderTrack } from './map/tracks.js';
import { updateLiveMarker, removeLiveMarker } from './map/markers.js';
import { clearAllLayers } from './map/layers.js';
import { fetchTLE, fetchGPJson, fetchSATCAT } from './sat/fetch.js';
import { parseTLE, propagateAt, generateGroundTrack, splitAtAntiMeridian, computeSwathPolygon } from './sat/propagate.js';
import { getColor } from './sat/presets.js';
import { generateKML, downloadKML, makeKmlFilename } from './export/kml.js';
import { predictPasses } from './sat/propagate.js';
import { getState, setState, loadState, updateSatellite, findSatellite, subscribe, getActiveGs } from './ui/state.js';
import { buildSidebar, buildRightPanel, updateSidebar, updateSatListAndInfo, setStatus } from './ui/sidebar.js';
import { setRefreshTleCallback } from './ui/info-panel.js';

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

let liveTimer = null;
let countdownOverlayTimer = null;
let countdownPassCache = { noradId: null, passes: null, computedAt: 0 };
const footprintLayers = new Map(); // noradId -> L.layerGroup

// ===== Initialize =====
function init() {
  loadState();
  initMap();

  const sidebar = document.getElementById('sidebar');
  buildSidebar(sidebar, getCallbacks());

  const rightPanel = document.getElementById('right-panel');
  buildRightPanel(rightPanel);

  // Wire up TLE refresh callback
  setRefreshTleCallback(async (noradId) => {
    try {
      // Clear localStorage cache for this satellite
      try {
        const cacheKey = 'sat-tle-cache';
        const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
        delete cache[noradId];
        localStorage.setItem(cacheKey, JSON.stringify(cache));
      } catch { /* ignore */ }

      const tle = await fetchTLE(noradId);
      const satrec = parseTLE(tle.line1, tle.line2);
      updateSatellite(noradId, {
        name: tle.name,
        tle: { line1: tle.line1, line2: tle.line2 },
        satrec,
      });
      showToast(`TLE refreshed for ${tle.name}`, 'success');
    } catch (err) {
      showToast(`TLE refresh failed: ${err.message}`, 'error');
    }
  });

  subscribe(() => {
    updateSatListAndInfo(getCallbacks());
  });

  updateSidebar(getCallbacks());
  restoreSatellites();

  // Restore coverage circle state
  if (getState().coverageVisible) toggleCoverage(true);

  // Always start the live timer — it checks per-satellite showLive flags
  startLiveUpdates();

  // Start map countdown overlay
  startCountdownOverlay();
  subscribe(() => updateCountdownOverlay());
}

/**
 * Callback object passed to UI components.
 */
function getCallbacks() {
  return {
    onAddSatellite: (noradId, name) => addSatellite(noradId, name),
    onAddPreset: (preset) => addSatellite(preset.noradId, preset.name),
    onShowTrack: () => showSelectedDayTrack(),
    onShowToday: () => showToday(),
    onClearTracks: () => clearTracks(),
    onLiveToggle: (enabled) => {
      if (enabled) startLiveUpdates();
      else stopLiveUpdates();
    },
    onLiveIntervalChange: () => {
      // Restart timer with new interval
      stopLiveUpdates();
      startLiveUpdates();
    },
    onCoverageToggle: (visible) => toggleCoverage(visible),
    onGsChanged: () => {
      // Refresh passes and map when ground station changes
      updateCountdownOverlay();
      countdownPassCache = { noradId: null, passes: null, computedAt: 0 };
      refreshMapGsMarkers();
    },
    onExportSelected: () => exportSelected(),
    onExportAll: () => exportAll(),
    onFootprintChange: (noradId) => renderFootprint(noradId),
    onFootprintToggle: (visible) => {
      if (visible) {
        // Re-render all footprints
        const s = getState();
        for (const sat of s.satellites) {
          if (sat.visible && sat.trackPoints && sat.trackPoints.length > 0) {
            renderFootprint(sat.noradId);
          }
        }
      } else {
        clearAllFootprints();
      }
    },
  };
}

// ===== Satellite Management =====

async function addSatellite(noradId, presetName) {
  const state = getState();

  if (state.satellites.find(s => s.noradId === noradId)) {
    showToast(`Satellite #${noradId} is already added`, 'warning');
    return;
  }

  const colorIndex = state.nextColorIndex;
  const color = getColor(colorIndex);

  const sat = {
    noradId,
    name: presetName || `SAT-${noradId}`,
    color,
    colorIndex,
    visible: true,
    showLive: false,
    frameWidth: 12,
    frameHeight: 12,
    rollDeg: 0,
    pitchDeg: 0,
    tle: null,
    satrec: null,
    metadata: null,
    trackPoints: [],
  };

  setState({
    satellites: [...state.satellites, sat],
    selectedSatId: noradId,
    nextColorIndex: colorIndex + 1,
  });

  setStatus(`Fetching TLE for #${noradId}...`);

  try {
    const tle = await fetchTLE(noradId);
    const satrec = parseTLE(tle.line1, tle.line2);

    updateSatellite(noradId, {
      name: tle.name,
      tle: { line1: tle.line1, line2: tle.line2 },
      satrec,
    });

    setStatus(`TLE loaded for ${tle.name}`);
    fetchMetadata(noradId);

    // Auto-show today's track for the newly added satellite
    autoShowTrackForSat(noradId);

  } catch (err) {
    showToast(`Failed to fetch TLE for #${noradId}: ${err.message}`, 'error');
    setStatus('TLE fetch failed');
    const sats = getState().satellites.filter(s => s.noradId !== noradId);
    setState({ satellites: sats });
  }
}

async function fetchMetadata(noradId) {
  try {
    const gp = await fetchGPJson(noradId);
    if (gp) {
      updateSatellite(noradId, {
        metadata: {
          intlDesignator: gp.OBJECT_ID || gp.INTLDES || null,
          objectType: gp.OBJECT_TYPE || null,
          country: gp.COUNTRY_CODE || null,
          launchDate: gp.LAUNCH_DATE || null,
          source: 'CelesTrak GP',
        },
      });
      return;
    }
  } catch { /* fall through */ }

  try {
    const satcat = await fetchSATCAT(noradId);
    if (satcat) {
      updateSatellite(noradId, { metadata: satcat });
    }
  } catch { /* metadata unavailable */ }
}

async function restoreSatellites() {
  const state = getState();
  for (const sat of state.satellites) {
    if (!sat.satrec) {
      try {
        const tle = await fetchTLE(sat.noradId);
        const satrec = parseTLE(tle.line1, tle.line2);
        updateSatellite(sat.noradId, {
          name: tle.name,
          tle: { line1: tle.line1, line2: tle.line2 },
          satrec,
        });
        fetchMetadata(sat.noradId);
      } catch {
        showToast(`Could not restore #${sat.noradId}`, 'warning');
      }
    }
  }
}

// ===== Track Rendering =====

function autoShowTrackForSat(noradId) {
  const sat = findSatellite(noradId);
  if (!sat || !sat.satrec || !sat.visible) return;

  const now = new Date();
  const startTime = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const state = getState();

  try {
    const trackPoints = generateGroundTrack(sat.satrec, startTime, state.trackDuration, state.propagationStep);
    updateSatellite(noradId, { trackPoints });
    const segments = splitAtAntiMeridian(trackPoints);
    renderTrack(noradId, sat.name, segments, sat.color, true);
    renderFootprint(noradId);
    setStatus(`Track rendered for ${sat.name}`);
  } catch { /* silent */ }
}

function showSelectedDayTrack() {
  const state = getState();
  const visibleSats = state.satellites.filter(s => s.visible && s.satrec);

  if (visibleSats.length === 0) {
    showToast('No satellites with TLE data to display', 'warning');
    return;
  }

  const [year, month, day] = state.selectedDate.split('-').map(Number);
  const [hour, minute] = state.selectedTime.split(':').map(Number);
  const startTime = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  setStatus('Propagating orbits...');

  for (const sat of visibleSats) {
    try {
      const trackPoints = generateGroundTrack(
        sat.satrec, startTime, state.trackDuration, state.propagationStep
      );
      updateSatellite(sat.noradId, { trackPoints });

      const segments = splitAtAntiMeridian(trackPoints);
      const fitBounds = visibleSats.indexOf(sat) === visibleSats.length - 1;
      renderTrack(sat.noradId, sat.name, segments, sat.color, fitBounds);
      renderFootprint(sat.noradId);
    } catch (err) {
      showToast(`Propagation error for ${sat.name}: ${err.message}`, 'error');
    }
  }

  setStatus(`Track rendered for ${state.selectedDate}`);
}

function showToday() {
  const now = new Date();
  const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  setState({ selectedDate: todayStr, selectedTime: '00:00' });
  updateSidebar(getCallbacks());
  showSelectedDayTrack();
}

function clearTracks() {
  clearAllLayers();
  clearAllFootprints();
  const state = getState();
  for (const sat of state.satellites) {
    updateSatellite(sat.noradId, { trackPoints: [] });
  }
  setStatus('Tracks cleared');
}

// ===== Footprint Rendering =====

function renderFootprint(noradId) {
  const state = getState();
  if (!state.footprintVisible) return;

  const sat = findSatellite(noradId);
  if (!sat || !sat.trackPoints || sat.trackPoints.length < 2) return;

  const frameW = sat.frameWidth || 12;
  const frameH = sat.frameHeight || 12;
  const roll = sat.rollDeg || 0;
  const pitch = sat.pitchDeg || 0;

  const swath = computeSwathPolygon(sat.trackPoints, frameW, frameH, roll, pitch);
  if (swath.left.length === 0) return;

  // Remove previous footprint for this satellite
  removeFootprint(noradId);

  const map = getMap();
  const group = L.layerGroup();

  // Build polygon strip: left edge forward + right edge reversed = closed polygon
  const polygonCoords = [...swath.left, ...swath.right.slice().reverse()];
  const poly = L.polygon(polygonCoords, {
    color: sat.color,
    weight: 1,
    fillColor: sat.color,
    fillOpacity: 0.12,
    dashArray: '4 3',
  });
  group.addLayer(poly);

  // Center line (shifted track)
  if (roll !== 0 || pitch !== 0) {
    const centerLine = L.polyline(swath.centers, {
      color: sat.color,
      weight: 1,
      opacity: 0.4,
      dashArray: '2 4',
    });
    group.addLayer(centerLine);
  }

  group.addTo(map);
  footprintLayers.set(noradId, group);
}

function removeFootprint(noradId) {
  const layer = footprintLayers.get(noradId);
  if (layer) {
    const map = getMap();
    if (map && map.hasLayer(layer)) map.removeLayer(layer);
    footprintLayers.delete(noradId);
  }
}

function clearAllFootprints() {
  for (const [noradId] of footprintLayers) {
    removeFootprint(noradId);
  }
}

// ===== Live Mode =====

function startLiveUpdates() {
  stopLiveUpdates();
  updateLivePositions();
  const interval = getState().liveInterval * 1000;
  liveTimer = setInterval(updateLivePositions, interval);
}

function stopLiveUpdates() {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
  // Remove all live markers
  const state = getState();
  for (const sat of state.satellites) {
    removeLiveMarker(sat.noradId);
  }
}

function updateLivePositions() {
  const state = getState();
  const now = new Date();

  const tsEl = document.getElementById('live-timestamp');
  if (tsEl) {
    tsEl.textContent = now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  }

  for (const sat of state.satellites) {
    if (!sat.satrec || !sat.visible) continue;

    // Show marker if global live is on OR per-satellite live is on
    const shouldShow = state.liveEnabled || sat.showLive;

    if (!shouldShow) {
      // Make sure marker is removed if not showing
      removeLiveMarker(sat.noradId);
      continue;
    }

    try {
      const pos = propagateAt(sat.satrec, now);
      if (pos) {
        updateLiveMarker(sat.noradId, sat.name, pos.lat, pos.lon, pos.alt, sat.color, now);
      }
    } catch {
      // Skip on propagation error
    }
  }
}

function refreshMapGsMarkers() {
  refreshGsMarkers();
  updateSidebar(getCallbacks());
}

// ===== KML Export =====

function exportSelected() {
  const state = getState();
  const sat = state.selectedSatId ? findSatellite(state.selectedSatId) : null;

  if (!sat || !sat.trackPoints || sat.trackPoints.length === 0) {
    showToast('Select a satellite with a rendered track first', 'warning');
    return;
  }

  let currentPos = null;
  if (sat.satrec) {
    currentPos = propagateAt(sat.satrec, new Date());
  }

  const kml = generateKML(`${sat.name} Ground Track`, [{ ...sat, currentPos }]);
  const hasLive = state.liveEnabled || sat.showLive;
  const type = hasLive ? 'live' : 'daytrack';
  const filename = makeKmlFilename(sat.name, sat.noradId, type);
  downloadKML(filename, kml);
  showToast(`Exported ${filename}`, 'success');
}

function exportAll() {
  const state = getState();
  const visibleSats = state.satellites.filter(s => s.visible && s.trackPoints && s.trackPoints.length > 0);

  if (visibleSats.length === 0) {
    showToast('No visible satellites with tracks to export', 'warning');
    return;
  }

  const exportSats = visibleSats.map(sat => {
    let currentPos = null;
    if (sat.satrec) currentPos = propagateAt(sat.satrec, new Date());
    return { ...sat, currentPos };
  });

  const kml = generateKML('Satellite Ground Tracks', exportSats);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `all_satellites_${dateStr}.kml`;
  downloadKML(filename, kml);
  showToast(`Exported ${filename} (${visibleSats.length} satellites)`, 'success');
}

// ===== Map Countdown Overlay =====

function startCountdownOverlay() {
  updateCountdownOverlay();
  if (countdownOverlayTimer) clearInterval(countdownOverlayTimer);
  countdownOverlayTimer = setInterval(updateCountdownOverlay, 1000);
}

function updateCountdownOverlay() {
  const el = document.getElementById('pass-countdown-overlay');
  if (!el) return;

  const state = getState();
  const sat = state.selectedSatId ? findSatellite(state.selectedSatId) : null;

  const gs = getActiveGs();
  if (!sat || !sat.satrec || !gs) {
    el.classList.remove('visible');
    return;
  }
  const now = Date.now();

  // Cache passes for 60s per satellite
  if (countdownPassCache.noradId !== sat.noradId || (now - countdownPassCache.computedAt) > 60000) {
    countdownPassCache = {
      noradId: sat.noradId,
      passes: predictPasses(sat.satrec, gs, 14),
      computedAt: now,
    };
  }

  const passes = countdownPassCache.passes;
  if (!passes || passes.length === 0) {
    el.classList.remove('visible');
    return;
  }

  // Find active or next pass
  const activePass = passes.find(p => p.aos.getTime() <= now && p.los.getTime() > now);
  const nextPass = passes.find(p => p.los.getTime() > now);
  const pass = activePass || nextPass;

  if (!pass) {
    el.classList.remove('visible');
    return;
  }

  const isActive = activePass != null;
  const target = isActive ? pass.los.getTime() : pass.aos.getTime();
  const remaining = target - now;

  if (remaining <= 0) return;

  const label = isActive ? 'Geçiş bitimine kalan' : 'Geçişe kalan süre';
  const timeStr = fmtCountdownOverlay(remaining);

  el.classList.add('visible');
  el.classList.toggle('active', isActive);
  el.innerHTML = `
    <div class="overlay-sat-name">${sat.name}</div>
    <div class="overlay-countdown-label">${label}</div>
    <div class="overlay-countdown-time">${timeStr}</div>
    <div class="overlay-pass-info">Max El: ${pass.maxEl.toFixed(1)}°</div>
  `;
}

function fmtCountdownOverlay(ms) {
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = n => String(n).padStart(2, '0');
  if (d > 0) return `${d}g ${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ===== Toast Notifications =====

function showToast(message, type = 'info') {
  const existing = document.querySelectorAll('.toast');
  existing.forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.append(toast);

  setTimeout(() => toast.remove(), 4000);
}

// ===== Start =====
function safeInit() {
  try {
    init();
  } catch (err) {
    console.error('Satellite Ground Track Planner init error:', err);
    document.body.innerHTML = `<div style="color:#f85149;padding:2rem;font-family:sans-serif;">
      <h2>Initialization Error</h2>
      <pre>${err.message}\n${err.stack}</pre>
    </div>`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeInit);
} else {
  safeInit();
}
