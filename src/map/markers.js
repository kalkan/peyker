/**
 * Live position markers for satellites on the Leaflet map.
 */

import L from 'leaflet';
import { getOrCreateLayers, getAllSatLayers } from './layers.js';
import { getMap } from './setup.js';

/**
 * Create a satellite marker icon with the given color.
 */
function createSatIcon(color) {
  return L.divIcon({
    className: 'sat-marker',
    html: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="8" fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="2"/>
      <circle cx="10" cy="10" r="3" fill="${color}"/>
    </svg>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
  });
}

/**
 * Update or create the live position marker for a satellite.
 *
 * @param {number} noradId
 * @param {string} name
 * @param {number} lat
 * @param {number} lon
 * @param {number} alt
 * @param {string} color
 * @param {Date} timestamp
 */
export function updateLiveMarker(noradId, name, lat, lon, alt, color, timestamp) {
  const layers = getOrCreateLayers(noradId, name);
  layers.marker.clearLayers();

  const icon = createSatIcon(color);

  const marker = L.marker([lat, lon], { icon }).addTo(layers.marker);

  const timeStr = timestamp.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

  marker.bindPopup(`
    <strong>${name}</strong><br>
    NORAD: ${noradId}<br>
    Lat: ${lat.toFixed(4)}°<br>
    Lon: ${lon.toFixed(4)}°<br>
    Alt: ${alt.toFixed(1)} km<br>
    Time: ${timeStr}
  `);

  return marker;
}

/**
 * Remove live position marker for a satellite.
 */
export function removeLiveMarker(noradId) {
  const allLayers = getAllSatLayers();
  const layers = allLayers.get(noradId);
  if (layers) layers.marker.clearLayers();
}

/**
 * Center the map on a satellite's current position.
 */
export function centerOnSat(lat, lon) {
  const map = getMap();
  if (map) {
    map.setView([lat, lon], map.getZoom() < 4 ? 4 : map.getZoom());
  }
}
