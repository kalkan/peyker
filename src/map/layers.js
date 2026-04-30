/**
 * Layer group management for satellite tracks and markers.
 * Each satellite gets its own set of layer groups.
 */

import L from 'leaflet';
import { getMap, addOverlay, removeOverlay } from './setup.js';

// Map of noradId -> { track: LayerGroup, marker: LayerGroup }
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

  addOverlay(`${name} Track`, trackGroup);
  addOverlay(`${name} Position`, markerGroup);

  const layers = { track: trackGroup, marker: markerGroup, name };
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

  removeOverlay(`${layers.name} Track`);
  removeOverlay(`${layers.name} Position`);

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
 * Get all layer entries.
 */
export function getAllSatLayers() {
  return satLayers;
}
