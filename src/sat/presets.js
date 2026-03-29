/**
 * Preset satellites for quick-add buttons.
 * Each preset has a display name and NORAD catalog number.
 */
export const PRESETS = [
  { name: 'İMECE', noradId: 56178 },
  { name: 'Göktürk-2', noradId: 39030 },
];

/**
 * Default ground stations. Users can add more via UI.
 */
export const DEFAULT_GROUND_STATIONS = [
  { name: 'Ankara', lat: 39.8911, lon: 32.7787, alt: 925 },
];

/**
 * Preset ground stations for quick add.
 */
export const GS_PRESETS = [
  { name: 'İstanbul', lat: 41.0082, lon: 28.9784, alt: 40 },
  { name: 'İzmir', lat: 38.4237, lon: 27.1428, alt: 30 },
  { name: 'Antalya', lat: 36.8969, lon: 30.7133, alt: 30 },
  { name: 'Trabzon', lat: 41.0027, lon: 39.7168, alt: 40 },
  { name: 'ESA Darmstadt', lat: 49.8710, lon: 8.6225, alt: 144 },
  { name: 'NASA Goldstone', lat: 35.4267, lon: -116.89, alt: 900 },
  { name: 'NASA Canberra', lat: -35.4014, lon: 148.9817, alt: 680 },
  { name: 'Svalbard SvalSat', lat: 78.2307, lon: 15.3976, alt: 500 },
  { name: 'Kiruna ESRANGE', lat: 67.8558, lon: 20.9644, alt: 420 },
];

/**
 * Preset ground station markers (backwards compat — use getGroundStations() for runtime).
 */
export const GROUND_STATIONS = DEFAULT_GROUND_STATIONS;

/**
 * Palette of distinct colors for satellite tracks.
 * Colors are chosen to be visible on both light and dark map backgrounds.
 */
export const TRACK_COLORS = [
  '#58a6ff', // blue
  '#f0883e', // orange
  '#3fb950', // green
  '#bc8cff', // purple
  '#f778ba', // pink
  '#d29922', // amber
  '#39d2c0', // teal
  '#ff7b72', // coral
];

/**
 * Get the next available color from the palette.
 * Cycles through colors if more satellites than colors.
 */
export function getColor(index) {
  return TRACK_COLORS[index % TRACK_COLORS.length];
}
