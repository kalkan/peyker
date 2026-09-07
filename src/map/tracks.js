/**
 * Ground track rendering on the Leaflet map.
 * Handles polyline creation, anti-meridian splitting, and styling.
 */

import L from 'leaflet';
import { getOrCreateLayers, clearSatLayers } from './layers.js';
import { getMap } from './setup.js';

/**
 * Render ground track segments on the map for a satellite.
 *
 * @param {number} noradId - satellite NORAD ID
 * @param {string} name - satellite name
 * @param {Array<Array<[number, number]>>} segments - anti-meridian-split polyline segments
 * @param {string} color - track color
 * @param {boolean} fitBounds - whether to fit map to the track
 */
export function renderTrack(noradId, name, segments, color, fitBounds = true) {
  const layers = getOrCreateLayers(noradId, name);
  layers.track.clearLayers();

  const allBounds = [];

  for (const segment of segments) {
    if (segment.length < 2) continue;

    const polyline = L.polyline(segment, {
      color,
      weight: 2.5,
      opacity: 0.85,
      smoothFactor: 1,
    });

    layers.track.addLayer(polyline);

    for (const pt of segment) {
      allBounds.push(pt);
    }
  }

  // Fit map to track bounds
  if (fitBounds && allBounds.length > 0) {
    const map = getMap();
    const bounds = L.latLngBounds(allBounds);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 6 });
  }
}

/**
 * Clear ground track for a satellite.
 */
export function clearTrack(noradId) {
  const layers = getOrCreateLayers(noradId, '');
  layers.track.clearLayers();
}
