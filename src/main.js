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
import { parseTLE, propagateAt, generateGroundTrack, splitAtAntiMeridian, computeSwathPolygon, computeFootprintRect } from './sat/propagate.js';
import { getColor } from './sat/presets.js';
import { generateKML, downloadKML, makeKmlFilename } from './export/kml.js';
import { predictPasses } from './sat/propagate.js';
import { getState, setState, loadState, updateSatellite, findSatellite, subscribe, getActiveGs } from './ui/state.js';
import { buildSidebar, buildRightPanel, updateSidebar, updateSatListAndInfo, setStatus } from './ui/sidebar.js';
import { invalidatePassCache, setPassSelectCallback } from './ui/passes-panel.js';
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
let passArcGroup = null; // LayerGroup for selected pass arc

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
        tle: { line1: tle.line1, line2: tle.line2, source: tle.source },
        satrec,
      });

      // Re-render track with new TLE
      autoShowTrackForSat(noradId);

      const srcLabel = tle.source ? ` (${tle.source})` : '';
      showToast(`TLE refreshed for ${tle.name}${srcLabel}`, 'success');
      return true;
    } catch (err) {
      showToast(`TLE refresh failed: ${err.message}`, 'error');
      return false;
    }
  });

  // Wire up pass selection → map arc visualization
  setPassSelectCallback((pass, sat) => {
    renderPassArc(pass, sat);
  });

  let prevSatIds = new Set(getState().satellites.map(s => s.noradId));
  let prevSelectedSatId = getState().selectedSatId;
  subscribe(() => {
    const state = getState();
    const currentSatId = state.selectedSatId;

    // Detect removed satellites and clean up their map layers
    const currentIds = new Set(state.satellites.map(s => s.noradId));
    for (const id of prevSatIds) {
      if (!currentIds.has(id)) {
        removeFootprint(id);
        if (timeCursorLayer && id === prevSelectedSatId) clearTimeCursorFootprint();
      }
    }
    prevSatIds = currentIds;

    if (currentSatId !== prevSelectedSatId) {
      // Satellite selection changed — invalidate both pass caches and clear arc
      invalidatePassCache();
      countdownPassCache = { noradId: null, passes: null, computedAt: 0 };
      clearPassArc();

      // Auto-zoom to selected satellite's track
      const selectedSat = currentSatId ? findSatellite(currentSatId) : null;
      if (selectedSat && selectedSat.trackPoints && selectedSat.trackPoints.length > 0) {
        const map = getMap();
        if (map) {
          const pts = selectedSat.trackPoints;
          const bounds = L.latLngBounds(pts.map(p => [p.lat, p.lon]));
          map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 6, duration: 0.8 });
        }
      }

      prevSelectedSatId = currentSatId;
    }
    updateSatListAndInfo(getCallbacks());
  });

  updateSidebar(getCallbacks());
  restoreSatellites();

  // Restore coverage circle state
  if (getState().coverageVisible) toggleCoverage(true);

  // Always start the live timer — it checks per-satellite showLive flags
  startLiveUpdates();

  // Map location search (Nominatim)
  initMapSearch();

  // Start map countdown overlay
  startCountdownOverlay();
  subscribe(() => updateCountdownOverlay());

  // Apply URL target parameter (?target=lat,lon) — for cross-app links
  // from tools like Sezen. Drops a marker and flies the map to the target.
  applyUrlTarget();
}

/**
 * Parse ?target=lat,lon from the URL and place a marker + fly map there.
 * Also supports ?lat=..&lon=..
 */
function applyUrlTarget() {
  try {
    const params = new URLSearchParams(window.location.search);
    let lat = null, lon = null, label = null;

    const target = params.get('target');
    if (target) {
      const parts = target.split(',').map(s => parseFloat(s.trim()));
      if (parts.length === 2 && isFinite(parts[0]) && isFinite(parts[1])) {
        lat = parts[0]; lon = parts[1];
      }
    } else if (params.has('lat') && params.has('lon')) {
      const a = parseFloat(params.get('lat'));
      const b = parseFloat(params.get('lon'));
      if (isFinite(a) && isFinite(b)) { lat = a; lon = b; }
    }
    label = params.get('name') || params.get('label');

    if (lat == null || lon == null) return;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;

    const map = getMap();
    if (!map) return;

    const marker = L.marker([lat, lon], {
      title: label || `Target ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`,
    }).addTo(map);
    marker.bindPopup(
      `<strong>${label ? escapeHtml(label) : 'URL Target'}</strong><br>` +
      `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`
    ).openPopup();

    map.flyTo([lat, lon], Math.max(map.getZoom(), 6), { duration: 1.2 });
  } catch (err) {
    console.warn('applyUrlTarget failed:', err);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
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
      invalidatePassCache();
      countdownPassCache = { noradId: null, passes: null, computedAt: 0 };
      updateCountdownOverlay();
      refreshMapGsMarkers();
    },
    onExportSelected: () => exportSelected(),
    onExportAll: () => exportAll(),
    onFootprintChange: (noradId) => {
      renderFootprint(noradId);
      // Also update time cursor if active
      const sat = findSatellite(noradId);
      if (sat && sat._timeCursorIndex != null) {
        renderTimeCursorFootprint(noradId, sat._timeCursorIndex);
      }
    },
    onTimeCursor: (noradId, trackIndex) => {
      const sat = findSatellite(noradId);
      if (sat) sat._timeCursorIndex = trackIndex;
      renderFootprint(noradId);
      renderTimeCursorFootprint(noradId, trackIndex);
    },
    onTimeCursorClear: () => clearTimeCursorFootprint(),
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
        clearTimeCursorFootprint();
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
    rollDeg: 5,
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
      tle: { line1: tle.line1, line2: tle.line2, source: tle.source },
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
  const toRestore = state.satellites.filter(s => !s.satrec);
  if (toRestore.length === 0) return;

  const results = await Promise.allSettled(
    toRestore.map(sat => restoreOneSatellite(sat.noradId))
  );

  const failed = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') failed.push(toRestore[i].noradId);
  });

  if (failed.length > 0) {
    showToast(`Could not restore: ${failed.map(id => '#' + id).join(', ')}`, 'warning');
  }
}

async function restoreOneSatellite(noradId, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const tle = await fetchTLE(noradId);
      const satrec = parseTLE(tle.line1, tle.line2);
      updateSatellite(noradId, {
        name: tle.name,
        tle: { line1: tle.line1, line2: tle.line2, source: tle.source },
        satrec,
      });
      fetchMetadata(noradId);
      return;
    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      } else {
        throw err;
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
  } catch (err) {
    console.warn(`Track generation failed for ${sat.name}:`, err.message);
  }
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
  const pitch = 0; // strip uses 0 pitch; pitch only for time cursor

  // Slice track points to +-10 min around selected time cursor
  const cursorIdx = Math.min(sat._timeCursorIndex || 0, sat.trackPoints.length - 1);
  const cursorTime = sat.trackPoints[cursorIdx].time.getTime();
  const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
  const windowStart = cursorTime - WINDOW_MS;
  const windowEnd = cursorTime + WINDOW_MS;

  const windowPoints = sat.trackPoints.filter(
    p => p.time.getTime() >= windowStart && p.time.getTime() <= windowEnd
  );
  if (windowPoints.length < 2) return;

  const swath = computeSwathPolygon(windowPoints, frameW, frameH, roll, pitch);
  if (swath.left.length === 0) return;

  // Remove previous footprint for this satellite
  removeFootprint(noradId);

  const map = getMap();
  const group = L.layerGroup();

  // Build polygon strip: left edge forward + right edge reversed = closed polygon
  const FOOTPRINT_COLOR = '#e04040';
  const polygonCoords = [...swath.left, ...swath.right.slice().reverse()];
  const poly = L.polygon(polygonCoords, {
    color: FOOTPRINT_COLOR,
    weight: 1,
    fillColor: FOOTPRINT_COLOR,
    fillOpacity: 0.12,
    dashArray: '4 3',
  });
  group.addLayer(poly);

  // Center line (shifted track)
  if (roll !== 0) {
    const centerLine = L.polyline(swath.centers, {
      color: FOOTPRINT_COLOR,
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

// ===== Time Cursor Footprint =====

let timeCursorLayer = null;

function renderTimeCursorFootprint(noradId, trackIndex) {
  clearTimeCursorFootprint();

  const sat = findSatellite(noradId);
  if (!sat || !sat.trackPoints || sat.trackPoints.length < 2) return;

  const frameW = sat.frameWidth || 12;
  const frameH = sat.frameHeight || 12;
  const roll = sat.rollDeg || 0;
  const pitch = sat.pitchDeg || 0;

  const idx = Math.min(Math.max(0, trackIndex), sat.trackPoints.length - 1);
  const rect = computeFootprintRect(sat.trackPoints, idx, frameW, frameH, roll, pitch);
  if (!rect) return;

  const map = getMap();
  const group = L.layerGroup();
  const FC = '#e04040';

  // Large pulsing marker for zoom-out visibility
  const bigMarker = L.circleMarker(rect.center, {
    radius: 12,
    color: FC,
    fillColor: FC,
    fillOpacity: 0.3,
    weight: 2,
  });
  group.addLayer(bigMarker);

  // Footprint rectangle
  const poly = L.polygon(rect.corners, {
    color: FC,
    weight: 2,
    fillColor: FC,
    fillOpacity: 0.25,
  });
  group.addLayer(poly);

  // Center marker (frame center)
  const centerMarker = L.circleMarker(rect.center, {
    radius: 5,
    color: '#fff',
    fillColor: FC,
    fillOpacity: 0.9,
    weight: 1,
  });
  group.addLayer(centerMarker);

  // Sub-satellite point marker
  const subsatMarker = L.circleMarker(rect.subsat, {
    radius: 3,
    color: '#fff',
    fillColor: '#fff',
    fillOpacity: 0.7,
    weight: 1,
  });
  group.addLayer(subsatMarker);

  // Time label popup
  const tp = sat.trackPoints[idx];
  const timeStr = tp.time.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  centerMarker.bindTooltip(`${sat.name}<br>${timeStr}<br>Alt: ${tp.alt.toFixed(0)} km<br>Roll: ${roll}° Pitch: ${pitch}°`, {
    permanent: true,
    direction: 'top',
    className: 'sensor-cursor-tooltip',
  });

  // Clickable popup with Sezen link for the footprint center
  const centerLat = rect.center[0];
  const centerLon = rect.center[1];
  const sezenUrl = `http://kaankalkan.com/sezen/?lat=${centerLat.toFixed(6)}&lon=${centerLon.toFixed(6)}`;
  const popupHtml = `
    <div style="font-size:12px;">
      <b>${sat.name}</b><br>
      ${timeStr}<br>
      Lat: ${centerLat.toFixed(6)}°<br>
      Lon: ${centerLon.toFixed(6)}°<br>
      Alt: ${tp.alt.toFixed(0)} km<br>
      <a href="${sezenUrl}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;padding:4px 10px;background:#58a6ff;color:#fff;text-decoration:none;border-radius:4px;font-weight:600;">Sezen'de Aç</a>
    </div>
  `;
  poly.bindPopup(popupHtml);
  centerMarker.bindPopup(popupHtml);
  bigMarker.bindPopup(popupHtml);

  group.addTo(map);
  timeCursorLayer = group;
}

function clearTimeCursorFootprint() {
  if (timeCursorLayer) {
    const map = getMap();
    if (map && map.hasLayer(timeCursorLayer)) map.removeLayer(timeCursorLayer);
    timeCursorLayer = null;
  }
}

// ===== Pass Arc Visualization =====

/**
 * Draw the satellite ground track for a selected pass (AOS→LOS) on the map.
 * Shows the arc that enters the coverage circle with distinct styling.
 */
function renderPassArc(pass, sat) {
  clearPassArc();
  if (!sat || !sat.satrec || !pass) return;

  const map = getMap();
  if (!map) return;

  passArcGroup = L.layerGroup().addTo(map);

  // Propagate from AOS to LOS at 10-second intervals
  const aosMs = pass.aos.getTime();
  const losMs = pass.los.getTime();
  const step = 10000; // 10 seconds
  const points = [];

  for (let t = aosMs; t <= losMs; t += step) {
    const pos = propagateAt(sat.satrec, new Date(t));
    if (pos) points.push([pos.lat, pos.lon]);
  }
  // Ensure LOS point is included
  const losPos = propagateAt(sat.satrec, pass.los);
  if (losPos) points.push([losPos.lat, losPos.lon]);

  if (points.length < 2) return;

  // Draw the pass arc polyline
  const arcLine = L.polyline(points, {
    color: '#ffd33d',
    weight: 4,
    opacity: 0.9,
    dashArray: null,
  }).addTo(passArcGroup);

  // AOS marker (green)
  L.circleMarker(points[0], {
    radius: 6, color: '#3fb950', fillColor: '#3fb950',
    fillOpacity: 1, weight: 2,
  }).addTo(passArcGroup).bindTooltip('AOS', { permanent: true, direction: 'left', className: 'pass-arc-tooltip' });

  // LOS marker (red)
  L.circleMarker(points[points.length - 1], {
    radius: 6, color: '#f85149', fillColor: '#f85149',
    fillOpacity: 1, weight: 2,
  }).addTo(passArcGroup).bindTooltip('LOS', { permanent: true, direction: 'right', className: 'pass-arc-tooltip' });

  // TCA marker (blue, at max elevation)
  const tcaPos = propagateAt(sat.satrec, pass.tca);
  if (tcaPos) {
    L.circleMarker([tcaPos.lat, tcaPos.lon], {
      radius: 6, color: '#58a6ff', fillColor: '#58a6ff',
      fillOpacity: 1, weight: 2,
    }).addTo(passArcGroup).bindTooltip(`TCA ${pass.maxEl.toFixed(1)}°`, { permanent: true, direction: 'top', className: 'pass-arc-tooltip' });
  }

  // Zoom to the arc
  map.flyToBounds(arcLine.getBounds().pad(0.3), { maxZoom: 8, duration: 0.5 });
}

function clearPassArc() {
  if (passArcGroup) {
    const map = getMap();
    if (map && map.hasLayer(passArcGroup)) map.removeLayer(passArcGroup);
    passArcGroup = null;
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

// ===== Map Location Search (Nominatim) =====

function initMapSearch() {
  const input = document.getElementById('map-search-input');
  const resultsEl = document.getElementById('map-search-results');
  if (!input || !resultsEl) return;

  let searchTimeout = null;
  let lastSearchTime = 0;

  function hideResults() {
    resultsEl.style.display = 'none';
    resultsEl.innerHTML = '';
  }

  async function search(query) {
    if (query.length < 2) { hideResults(); return; }

    // Nominatim rate limit: max 1 request per second
    const now = Date.now();
    const wait = Math.max(0, 1000 - (now - lastSearchTime));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastSearchTime = Date.now();

    resultsEl.innerHTML = '<div class="map-search-item loading">Aranıyor...</div>';
    resultsEl.style.display = 'block';

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'tr' } });
      const data = await res.json();

      resultsEl.innerHTML = '';
      if (data.length === 0) {
        resultsEl.innerHTML = '<div class="map-search-item loading">Sonuç bulunamadı</div>';
        setTimeout(hideResults, 2000);
        return;
      }

      for (const place of data) {
        const item = document.createElement('div');
        item.className = 'map-search-item';
        item.textContent = place.display_name;
        item.addEventListener('click', () => {
          const lat = parseFloat(place.lat);
          const lon = parseFloat(place.lon);
          const map = getMap();
          if (map) {
            if (place.boundingbox) {
              const bb = place.boundingbox.map(Number);
              map.flyToBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { maxZoom: 12, duration: 1.5 });
            } else {
              map.flyTo([lat, lon], 10, { duration: 1.5 });
            }
          }
          input.value = place.display_name.split(',')[0];
          hideResults();
        });
        resultsEl.append(item);
      }
    } catch {
      resultsEl.innerHTML = '<div class="map-search-item loading">Arama hatası</div>';
      setTimeout(hideResults, 2000);
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const val = input.value.trim();
    if (val) {
      searchTimeout = setTimeout(() => search(val), 1000);
    } else {
      hideResults();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideResults(); input.blur(); }
  });

  document.addEventListener('click', (e) => {
    const container = document.getElementById('map-search');
    if (container && !container.contains(e.target)) hideResults();
  });
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
