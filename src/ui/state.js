/**
 * Application state management with localStorage persistence.
 *
 * State is a simple reactive store: listeners are notified on changes.
 */

const STORAGE_KEY = 'sat-groundtrack-state';

const defaultState = {
  satellites: [],       // Array of { noradId, name, color, visible, showLive, tle, satrec, metadata, trackPoints, colorIndex }
  selectedSatId: null,  // Currently selected satellite NORAD ID
  selectedDate: todayUTC(),
  selectedTime: '00:00',
  propagationStep: 60,  // seconds
  trackDuration: 24,    // hours
  liveEnabled: false,
  liveInterval: 5,      // seconds
  nextColorIndex: 0,
};

function todayUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

let state = { ...defaultState };
const listeners = new Set();

/**
 * Load persisted state from localStorage.
 * Only restores UI settings and satellite list (not satrec or transient data).
 */
export function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    const parsed = JSON.parse(saved);

    // Restore UI settings
    if (parsed.selectedDate) state.selectedDate = parsed.selectedDate;
    if (parsed.selectedTime) state.selectedTime = parsed.selectedTime;
    if (parsed.propagationStep) state.propagationStep = parsed.propagationStep;
    if (parsed.trackDuration) state.trackDuration = parsed.trackDuration;
    if (parsed.liveInterval) state.liveInterval = parsed.liveInterval;
    if (typeof parsed.liveEnabled === 'boolean') state.liveEnabled = parsed.liveEnabled;
    if (typeof parsed.nextColorIndex === 'number') state.nextColorIndex = parsed.nextColorIndex;

    // Restore satellite list (just IDs, names, colors — TLE will be re-fetched)
    if (Array.isArray(parsed.satellites)) {
      state.satellites = parsed.satellites.map(s => ({
        noradId: s.noradId,
        name: s.name,
        color: s.color,
        colorIndex: s.colorIndex,
        visible: s.visible !== false,
        showLive: s.showLive || false,
        tle: null,
        satrec: null,
        metadata: null,
        trackPoints: [],
      }));
    }
  } catch {
    console.warn('Failed to load saved state');
  }
}

/**
 * Persist current state to localStorage.
 * Excludes non-serializable data (satrec, trackPoints).
 */
function persistState() {
  try {
    const toSave = {
      selectedDate: state.selectedDate,
      selectedTime: state.selectedTime,
      propagationStep: state.propagationStep,
      trackDuration: state.trackDuration,
      liveInterval: state.liveInterval,
      liveEnabled: state.liveEnabled,
      nextColorIndex: state.nextColorIndex,
      satellites: state.satellites.map(s => ({
        noradId: s.noradId,
        name: s.name,
        color: s.color,
        colorIndex: s.colorIndex,
        visible: s.visible,
        showLive: s.showLive,
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // localStorage might be full or unavailable
  }
}

/**
 * Get current state (read-only reference).
 */
export function getState() {
  return state;
}

/**
 * Update state and notify listeners.
 */
export function setState(updates) {
  Object.assign(state, updates);
  persistState();
  notifyListeners();
}

/**
 * Update a specific satellite's data.
 */
export function updateSatellite(noradId, updates) {
  const sat = state.satellites.find(s => s.noradId === noradId);
  if (sat) {
    Object.assign(sat, updates);
    persistState();
    notifyListeners();
  }
}

/**
 * Find a satellite in state by NORAD ID.
 */
export function findSatellite(noradId) {
  return state.satellites.find(s => s.noradId === noradId);
}

/**
 * Add a listener for state changes.
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (e) {
      console.error('State listener error:', e);
    }
  }
}
