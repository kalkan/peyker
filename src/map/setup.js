/**
 * Leaflet map initialization with basemap layers and controls.
 */

import L from 'leaflet';
import { GROUND_STATIONS } from '../sat/presets.js';

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

  // Ground station markers
  const gsGroup = L.layerGroup().addTo(map);
  for (const gs of GROUND_STATIONS) {
    const icon = L.divIcon({
      className: 'gs-marker',
      html: `<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.27 21.73 0 14 0z" fill="#e04040" fill-opacity="0.9" stroke="#fff" stroke-width="1.5"/>
        <circle cx="14" cy="13" r="5" fill="none" stroke="#fff" stroke-width="1.5"/>
        <line x1="14" y1="8" x2="14" y2="4" stroke="#fff" stroke-width="1.5"/>
        <line x1="10" y1="10" x2="7" y2="7" stroke="#fff" stroke-width="1.2"/>
        <line x1="18" y1="10" x2="21" y2="7" stroke="#fff" stroke-width="1.2"/>
      </svg>`,
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      popupAnchor: [0, -36],
    });

    L.marker([gs.lat, gs.lon], { icon })
      .bindPopup(`<strong>${gs.name}</strong><br>${gs.lat.toFixed(5)}°, ${gs.lon.toFixed(5)}°${gs.alt != null ? `<br>Altitude: ${gs.alt} m` : ''}`)
      .addTo(gsGroup);
  }
  addOverlay('Ground Stations', gsGroup);

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
