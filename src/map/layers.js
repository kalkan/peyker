/**
 * Layer group management for satellite tracks, markers, and swath polygons.
 * Each satellite gets its own set of layer groups.
 */

import L from 'leaflet';
import { getMap, addOverlay, removeOverlay } from './setup.js';

// Map of noradId -> { track: LayerGroup, marker: LayerGroup, swath: LayerGroup }
const satLayers = new Map();

/**
 * Get or create layer groups for a satellite.
 */
export function getOrCreateLayers(noradId, name) {
  if (satLayers.has(noradId)) {
    return satLayers.get(noradId);
  }

  const map = getMap();
  const trackGroup = L.layerGroup().addTo(map);
  const markerGroup = L.layerGroup().addTo(map);
  const swathGroup = L.layerGroup().addTo(map);

  addOverlay(`${name} Track`, trackGroup);
  addOverlay(`${name} Position`, markerGroup);
  addOverlay(`${name} Swath`, swathGroup);

  const layers = { track: trackGroup, marker: markerGroup, swath: swathGroup, name };
  satLayers.set(noradId, layers);
  return layers;
}

/**
 * Clear all layers for a satellite.
 */
export function clearSatLayers(noradId) {
  const layers = satLayers.get(noradId);
  if (!layers) return;
  layers.track.clearLayers();
  layers.marker.clearLayers();
  layers.swath.clearLayers();
}

/**
 * Remove a satellite entirely from the map and layer control.
 */
export function removeSatFromMap(noradId) {
  const layers = satLayers.get(noradId);
  if (!layers) return;

  const map = getMap();
  if (map.hasLayer(layers.track)) map.removeLayer(layers.track);
  if (map.hasLayer(layers.marker)) map.removeLayer(layers.marker);
  if (map.hasLayer(layers.swath)) map.removeLayer(layers.swath);

  removeOverlay(`${layers.name} Track`);
  removeOverlay(`${layers.name} Position`);
  removeOverlay(`${layers.name} Swath`);

  satLayers.delete(noradId);
}

/**
 * Clear all satellite layers from the map.
 */
export function clearAllLayers() {
  for (const [noradId] of satLayers) {
    clearSatLayers(noradId);
  }
}

/**
 * Get all layer entries (for export etc.).
 */
export function getAllSatLayers() {
  return satLayers;
}
