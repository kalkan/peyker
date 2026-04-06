/**
 * Satellite TLE and metadata fetching from CelesTrak.
 *
 * Data sources:
 *  - TLE: CelesTrak GP API (no auth, CORS-friendly)
 *  - Metadata: CelesTrak SATCAT (may have CORS issues in some browsers)
 *
 * All fetches are resilient: metadata failures do not block orbit rendering.
 */

const CELESTRAK_GP_URL = 'https://celestrak.org/NORAD/elements/gp.php';
const CELESTRAK_SATCAT_URL = 'https://celestrak.org/satcat/records.php';

const TLE_CACHE_KEY = 'sat-tle-cache';
const TLE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getTLECache() {
  try {
    const raw = localStorage.getItem(TLE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function setTLECache(noradId, data) {
  try {
    const cache = getTLECache();
    cache[noradId] = { ...data, cachedAt: Date.now() };
    localStorage.setItem(TLE_CACHE_KEY, JSON.stringify(cache));
  } catch { /* localStorage might be full */ }
}

function getCachedTLE(noradId) {
  const cache = getTLECache();
  const entry = cache[noradId];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TLE_CACHE_TTL) return null;
  return { name: entry.name, line1: entry.line1, line2: entry.line2 };
}

/**
 * Fetch TLE data for a satellite by NORAD catalog number.
 * Returns { line1, line2, name } or throws on failure.
 */
export async function fetchTLE(noradId) {
  // Check localStorage cache first
  const cached = getCachedTLE(noradId);
  if (cached) return cached;

  const url = `${CELESTRAK_GP_URL}?CATNR=${noradId}&FORMAT=TLE`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`TLE fetch failed: HTTP ${response.status}`);
  }

  const text = (await response.text()).trim();

  if (!text || text.includes('No GP data found')) {
    throw new Error(`No TLE data found for NORAD ID ${noradId}`);
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  if (lines.length < 2) {
    throw new Error(`Invalid TLE response for NORAD ID ${noradId}`);
  }

  // CelesTrak 3LE format: line 0 = name, line 1 = TLE line 1, line 2 = TLE line 2
  let result;
  if (lines.length >= 3 && !lines[0].startsWith('1 ') && !lines[0].startsWith('2 ')) {
    result = {
      name: lines[0].trim(),
      line1: lines[1].trim(),
      line2: lines[2].trim(),
    };
  } else {
    // 2-line format (no name)
    result = {
      name: `SAT-${noradId}`,
      line1: lines[0].trim(),
      line2: lines[1].trim(),
    };
  }

  // Cache in localStorage
  setTLECache(noradId, result);
  return result;
}

/**
 * Fetch SATCAT metadata for a satellite.
 * Returns metadata object or null if unavailable.
 * This is best-effort — CORS may block it in some browsers.
 */
export async function fetchSATCAT(noradId) {
  try {
    const url = `${CELESTRAK_SATCAT_URL}?CATNR=${noradId}&FORMAT=json`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) return null;

    const rec = data[0];
    return {
      intlDesignator: rec.INTLDES || rec.OBJECT_ID || null,
      objectType: rec.OBJECT_TYPE || null,
      launchDate: rec.LAUNCH_DATE || null,
      decayDate: rec.DECAY_DATE || null,
      rcsSize: rec.RCS_SIZE || null,
      country: rec.COUNTRY_CODE || null,
      site: rec.SITE || null,
      source: 'CelesTrak SATCAT',
    };
  } catch {
    // CORS or network failure — this is expected in some environments
    return null;
  }
}

/**
 * Search satellites by name via CelesTrak GP API.
 * Returns array of { name, noradId } or empty array.
 */
export async function searchSatellitesByName(query) {
  try {
    const url = `${CELESTRAK_GP_URL}?NAME=${encodeURIComponent(query)}&FORMAT=JSON`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return [];

    return data
      .filter(rec => rec.NORAD_CAT_ID != null)
      .map(rec => ({
        name: rec.OBJECT_NAME || `SAT-${rec.NORAD_CAT_ID}`,
        noradId: rec.NORAD_CAT_ID,
      }));
  } catch {
    return [];
  }
}

/**
 * Fetch GP data in JSON format (alternative approach for richer data).
 * Returns parsed GP record or null.
 */
export async function fetchGPJson(noradId) {
  try {
    const url = `${CELESTRAK_GP_URL}?CATNR=${noradId}&FORMAT=JSON`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    return data[0];
  } catch {
    return null;
  }
}
