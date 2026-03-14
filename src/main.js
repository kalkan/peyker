/**
 * Main entry point for Satellite Ground Track Planner.
 * Orchestrates all modules: map, satellite data, UI, and export.
 */

import 'leaflet/dist/leaflet.css';
import './styles/main.css';
import { initMap, getMap } from './map/setup.js';
import { renderTrack } from './map/tracks.js';
import { updateLiveMarker, removeLiveMarker } from './map/markers.js';
import { getOrCreateLayers, clearSatLayers, clearAllLayers, removeSatFromMap } from './map/layers.js';
import { fetchTLE, fetchSATCAT, fetchGPJson } from './sat/fetch.js';
import { parseTLE, propagateAt, generateGroundTrack, splitAtAntiMeridian } from './sat/propagate.js';
import { generateSwathPolygon } from './sat/swath.js';
import { getColor } from './sat/presets.js';
import { generateKML, downloadKML, makeKmlFilename } from './export/kml.js';
import { getState, setState, loadState, updateSatellite, findSatellite, subscribe } from './ui/state.js';
import { buildSidebar, updateSidebar, updateSatListAndInfo, setStatus } from './ui/sidebar.js';

import L from 'leaflet';

// Fix Leaflet default marker icon path issue with Vite bundler.
// Vite resolves these imports to hashed asset URLs in the dist build.
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

// ===== Initialize =====
function init() {
  // Load persisted state
  loadState();

  // Initialize map
  initMap();

  // Build sidebar
  const sidebar = document.getElementById('sidebar');
  buildSidebar(sidebar, getCallbacks());

  // Subscribe to state changes for UI updates
  subscribe(() => {
    updateSatListAndInfo();
  });

  // Initial render of all controls
  updateSidebar(getCallbacks());

  // Restore satellites from persisted state
  restoreSatellites();

  // Start live mode if it was enabled
  if (getState().liveEnabled) {
    startLiveUpdates();
  }
}

/**
 * Callback object passed to UI components.
 */
function getCallbacks() {
  return {
    onAddSatellite: (noradId) => addSatellite(noradId),
    onAddPreset: (preset) => addSatellite(preset.noradId, preset.name),
    onShowTrack: () => showSelectedDayTrack(),
    onShowToday: () => showToday(),
    onClearTracks: () => clearTracks(),
    onLiveToggle: (enabled) => {
      if (enabled) startLiveUpdates();
      else stopLiveUpdates();
    },
    onLiveIntervalChange: (seconds) => {
      if (getState().liveEnabled) {
        stopLiveUpdates();
        startLiveUpdates();
      }
    },
    onSwathToggle: (enabled) => {
      if (!enabled) clearAllSwath();
      else if (getState().satellites.some(s => s.trackPoints && s.trackPoints.length > 0)) {
        renderAllSwath();
      }
    },
    onRollAngleChange: () => {
      if (getState().swathEnabled) renderAllSwath();
    },
    onExportSelected: () => exportSelected(),
    onExportAll: () => exportAll(),
  };
}

// ===== Satellite Management =====

async function addSatellite(noradId, presetName) {
  const state = getState();

  // Check if already added
  if (state.satellites.find(s => s.noradId === noradId)) {
    showToast(`Satellite #${noradId} is already added`, 'warning');
    return;
  }

  const colorIndex = state.nextColorIndex;
  const color = getColor(colorIndex);

  // Add placeholder to state immediately
  const sat = {
    noradId,
    name: presetName || `SAT-${noradId}`,
    color,
    colorIndex,
    visible: true,
    showLive: false,
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
    // Fetch TLE (required)
    const tle = await fetchTLE(noradId);
    const satrec = parseTLE(tle.line1, tle.line2);

    // Update satellite with TLE data
    updateSatellite(noradId, {
      name: tle.name,
      tle: { line1: tle.line1, line2: tle.line2 },
      satrec,
    });

    setStatus(`TLE loaded for ${tle.name}`);

    // Fetch metadata (best-effort, non-blocking)
    fetchMetadata(noradId);

  } catch (err) {
    showToast(`Failed to fetch TLE for #${noradId}: ${err.message}`, 'error');
    setStatus('TLE fetch failed');
    // Remove the placeholder satellite
    const sats = getState().satellites.filter(s => s.noradId !== noradId);
    setState({ satellites: sats });
  }
}

async function fetchMetadata(noradId) {
  try {
    // Try GP JSON first (more CORS-friendly)
    const gp = await fetchGPJson(noradId);
    if (gp) {
      const metadata = {
        intlDesignator: gp.OBJECT_ID || gp.INTLDES || null,
        objectType: gp.OBJECT_TYPE || null,
        country: gp.COUNTRY_CODE || null,
        launchDate: gp.LAUNCH_DATE || null,
        source: 'CelesTrak GP',
      };
      updateSatellite(noradId, { metadata });
      return;
    }
  } catch {
    // Fall through to SATCAT
  }

  try {
    const satcat = await fetchSATCAT(noradId);
    if (satcat) {
      updateSatellite(noradId, { metadata: satcat });
    }
  } catch {
    // Metadata unavailable — app continues with TLE-only mode
  }
}

/**
 * Restore satellites from persisted state by re-fetching TLEs.
 */
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

function showSelectedDayTrack() {
  const state = getState();
  const visibleSats = state.satellites.filter(s => s.visible && s.satrec);

  if (visibleSats.length === 0) {
    showToast('No satellites with TLE data to display', 'warning');
    return;
  }

  // Parse selected date and time
  const [year, month, day] = state.selectedDate.split('-').map(Number);
  const [hour, minute] = state.selectedTime.split(':').map(Number);
  const startTime = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  setStatus('Propagating orbits...');

  for (const sat of visibleSats) {
    try {
      const trackPoints = generateGroundTrack(
        sat.satrec,
        startTime,
        state.trackDuration,
        state.propagationStep
      );

      updateSatellite(sat.noradId, { trackPoints });

      const segments = splitAtAntiMeridian(trackPoints);
      const fitBounds = visibleSats.indexOf(sat) === visibleSats.length - 1;
      renderTrack(sat.noradId, sat.name, segments, sat.color, fitBounds);
    } catch (err) {
      showToast(`Propagation error for ${sat.name}: ${err.message}`, 'error');
    }
  }

  // Render swath if enabled
  if (state.swathEnabled) {
    renderAllSwath();
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
  const state = getState();
  for (const sat of state.satellites) {
    updateSatellite(sat.noradId, { trackPoints: [] });
  }
  setStatus('Tracks cleared');
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

  // Update timestamp display
  const tsEl = document.getElementById('live-timestamp');
  if (tsEl) {
    tsEl.textContent = now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  }

  for (const sat of state.satellites) {
    if (!sat.satrec || !sat.visible) continue;
    if (!state.liveEnabled && !sat.showLive) continue;

    try {
      const pos = propagateAt(sat.satrec, now);
      if (pos) {
        updateLiveMarker(sat.noradId, sat.name, pos.lat, pos.lon, pos.alt, sat.color, now);
      }
    } catch {
      // Skip this satellite on propagation error
    }
  }
}

// ===== Swath =====

function renderAllSwath() {
  const state = getState();

  for (const sat of state.satellites) {
    if (!sat.visible || !sat.trackPoints || sat.trackPoints.length < 2) continue;

    const layers = getOrCreateLayers(sat.noradId, sat.name);
    layers.swath.clearLayers();

    try {
      const polygonSegments = generateSwathPolygon(sat.trackPoints, state.swathRollAngle);

      for (const segment of polygonSegments) {
        if (segment.length < 3) continue;

        L.polygon(segment, {
          color: sat.color,
          weight: 1,
          opacity: 0.4,
          fillColor: sat.color,
          fillOpacity: 0.12,
        }).addTo(layers.swath);
      }
    } catch {
      // Swath rendering error — skip silently
    }
  }
}

function clearAllSwath() {
  const state = getState();
  for (const sat of state.satellites) {
    const layers = getOrCreateLayers(sat.noradId, sat.name);
    layers.swath.clearLayers();
  }
}

// ===== KML Export =====

function exportSelected() {
  const state = getState();
  const sat = state.selectedSatId ? findSatellite(state.selectedSatId) : null;

  if (!sat || !sat.trackPoints || sat.trackPoints.length === 0) {
    showToast('Select a satellite with a rendered track first', 'warning');
    return;
  }

  // Get current position if available
  let currentPos = null;
  if (sat.satrec) {
    currentPos = propagateAt(sat.satrec, new Date());
  }

  const exportData = {
    ...sat,
    currentPos,
  };

  // Get swath data if enabled
  const swathData = new Map();
  if (state.swathEnabled && sat.trackPoints.length >= 2) {
    const polygons = generateSwathPolygon(sat.trackPoints, state.swathRollAngle);
    swathData.set(sat.noradId, polygons);
  }

  const kml = generateKML(`${sat.name} Ground Track`, [exportData], swathData);
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
    if (sat.satrec) {
      currentPos = propagateAt(sat.satrec, new Date());
    }
    return { ...sat, currentPos };
  });

  const swathData = new Map();
  if (state.swathEnabled) {
    for (const sat of visibleSats) {
      if (sat.trackPoints.length >= 2) {
        const polygons = generateSwathPolygon(sat.trackPoints, state.swathRollAngle);
        swathData.set(sat.noradId, polygons);
      }
    }
  }

  const kml = generateKML('Satellite Ground Tracks', exportSats, swathData);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `all_satellites_${dateStr}.kml`;
  downloadKML(filename, kml);
  showToast(`Exported ${filename} (${visibleSats.length} satellites)`, 'success');
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
// Module scripts are deferred, so DOM is ready by the time they execute.
// Use both approaches for safety, wrapped with error logging.
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
