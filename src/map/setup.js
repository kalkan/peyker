/**
 * Leaflet map initialization with basemap layers and controls.
 */

import L from 'leaflet';

let map = null;
let baseLayers = {};
let overlayLayers = {};
let layerControl = null;
let coordsDisplay = null;

/**
 * Initialize the Leaflet map.
 * Sets up OSM and optional satellite imagery basemaps.
 */
export function initMap() {
  map = L.map('map', {
    center: [20, 0],
    zoom: 2,
    zoomControl: true,
    worldCopyJump: true,
  });

  // Default basemap: OpenStreetMap
  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  });
  osmLayer.addTo(map);
  baseLayers['OpenStreetMap'] = osmLayer;

  // Optional satellite imagery: ESRI World Imagery (public, no key required)
  try {
    const satelliteLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '&copy; Esri, Maxar, Earthstar Geographics',
        maxZoom: 18,
      }
    );
    baseLayers['Satellite Imagery'] = satelliteLayer;

    // Test if the layer loads — add error handler
    satelliteLayer.on('tileerror', () => {
      // If tiles fail to load, the layer silently degrades.
      // The user can switch back to OSM.
    });
  } catch {
    console.warn('Satellite imagery layer could not be initialized');
  }

  // Layer control
  layerControl = L.control.layers(baseLayers, {}, { collapsed: true }).addTo(map);

  // Scale bar
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

  // Coordinate display on mouse move
  coordsDisplay = document.getElementById('coords-display');
  map.on('mousemove', (e) => {
    if (coordsDisplay) {
      const lat = e.latlng.lat.toFixed(4);
      const lon = e.latlng.lng.toFixed(4);
      coordsDisplay.textContent = `${lat}°, ${lon}°`;
    }
  });

  map.on('mouseout', () => {
    if (coordsDisplay) {
      coordsDisplay.textContent = '';
    }
  });

  // Ensure map renders correctly after layout settles
  setTimeout(() => map.invalidateSize(), 100);

  return map;
}

/**
 * Get the Leaflet map instance.
 */
export function getMap() {
  return map;
}

/**
 * Add an overlay layer to the layer control.
 */
export function addOverlay(name, layer) {
  if (layerControl) {
    overlayLayers[name] = layer;
    layerControl.addOverlay(layer, name);
  }
}

/**
 * Remove an overlay layer from the layer control.
 */
export function removeOverlay(name) {
  const layer = overlayLayers[name];
  if (layer) {
    if (layerControl) layerControl.removeLayer(layer);
    if (map && map.hasLayer(layer)) map.removeLayer(layer);
    delete overlayLayers[name];
  }
}

/**
 * Fit map bounds to a set of lat/lon points with padding.
 */
export function fitToPoints(points) {
  if (!map || points.length === 0) return;
  const bounds = L.latLngBounds(points.map(p => [p.lat || p[0], p.lon || p[1]]));
  map.fitBounds(bounds, { padding: [30, 30], maxZoom: 8 });
}
