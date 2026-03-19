/**
 * Preset satellites for quick-add buttons.
 * Each preset has a display name and NORAD catalog number.
 */
export const PRESETS = [
  { name: 'İMECE', noradId: 56178 },
  { name: 'Göktürk-2', noradId: 39030 },
];

/**
 * Preset ground station markers.
 */
export const GROUND_STATIONS = [
  { name: 'Anten', lat: 39.8911, lon: 32.7787, alt: 925 },
];

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
