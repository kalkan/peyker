/**
 * Satellite TLE and metadata fetching with multi-source fallback.
 *
 * TLE sources (tried in order):
 *  1. CelesTrak GP API (.org)
 *  2. CelesTrak GP API (.com mirror)
 *  3. tle.ivanstanojevic.me REST API
 *
 * Metadata: CelesTrak SATCAT (may have CORS issues in some browsers)
 *
 * All fetches are resilient: metadata failures do not block orbit rendering.
 */

const TLE_SOURCES = [
  {
    name: 'CelesTrak',
    url: (id) => `https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`,
    parse: parseCelesTrakTLE,
  },
  {
    name: 'CelesTrak-com',
    url: (id) => `https://celestrak.com/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`,
    parse: parseCelesTrakTLE,
  },
  {
    name: 'TLE API',
    url: (id) => `https://tle.ivanstanojevic.me/api/tle/${id}`,
    parse: parseTleApiJson,
  },
];

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
  return { name: entry.name, line1: entry.line1, line2: entry.line2, source: entry.source };
}

/** Parse CelesTrak 3LE/2LE text response */
function parseCelesTrakTLE(text, noradId) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes('No GP data found')) return null;

  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  if (lines.length >= 3 && !lines[0].startsWith('1 ') && !lines[0].startsWith('2 ')) {
    return { name: lines[0].trim(), line1: lines[1].trim(), line2: lines[2].trim() };
  }
  return { name: `SAT-${noradId}`, line1: lines[0].trim(), line2: lines[1].trim() };
}

/** Parse tle.ivanstanojevic.me JSON response */
function parseTleApiJson(text, noradId) {
  try {
    const data = JSON.parse(text);
    if (!data.line1 || !data.line2) return null;
    return {
      name: data.name || `SAT-${noradId}`,
      line1: data.line1.trim(),
      line2: data.line2.trim(),
    };
  } catch { return null; }
}

async function fetchWithTimeout(url, ms = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch TLE data for a satellite by NORAD catalog number.
 *
 * Queries all configured sources in parallel and returns the first
 * successful response. This significantly reduces latency when the
 * primary source is slow or degraded, and also improves resilience
 * because a single fast source is enough.
 *
 * Returns { line1, line2, name, source } or throws on failure.
 */
export async function fetchTLE(noradId) {
  // Check localStorage cache first
  const cached = getCachedTLE(noradId);
  if (cached) return cached;

  // Race all sources in parallel — first success wins.
  const errors = [];
  const attempts = TLE_SOURCES.map(async (src) => {
    const response = await fetchWithTimeout(src.url(noradId));
    if (!response.ok) throw new Error(`${src.name}: HTTP ${response.status}`);
    const text = await response.text();
    const result = src.parse(text, noradId);
    if (!result) throw new Error(`${src.name}: no data`);
    result.source = src.name;
    return result;
  });

  // Use Promise.any (first fulfilled). If all reject, throw with details.
  try {
    const result = await Promise.any(attempts);
    setTLECache(noradId, result);
    return result;
  } catch (err) {
    // Promise.any rejects with AggregateError — collect messages.
    const reasons = (err.errors || []).map(e => {
      if (e.name === 'AbortError') return 'timeout';
      return e.message || String(e);
    });
    throw new Error(`All TLE sources failed for #${noradId} (${reasons.join('; ')})`);
  }
}

/**
 * Fetch SATCAT metadata for a satellite.
 * Returns metadata object or null if unavailable.
 * This is best-effort — CORS may block it in some browsers.
 */
export async function fetchSATCAT(noradId) {
  try {
    const url = `${CELESTRAK_SATCAT_URL}?CATNR=${noradId}&FORMAT=json`;
    const response = await fetchWithTimeout(url, 8000);
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
 * Search satellites by name. Tries CelesTrak first, falls back to TLE API.
 * Returns array of { name, noradId } or empty array.
 */
export async function searchSatellitesByName(query) {
  // Try CelesTrak first
  const celestrakResults = await searchCelesTrak(query);
  if (celestrakResults.length > 0) return celestrakResults;

  // Fallback to TLE API
  return searchTleApi(query);
}

async function searchCelesTrak(query) {
  try {
    const url = `${CELESTRAK_GP_URL}?NAME=${encodeURIComponent(query)}&FORMAT=JSON`;
    const response = await fetchWithTimeout(url, 8000);
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return [];
    return data
      .filter(rec => rec.NORAD_CAT_ID != null)
      .map(rec => ({
        name: rec.OBJECT_NAME || `SAT-${rec.NORAD_CAT_ID}`,
        noradId: rec.NORAD_CAT_ID,
      }));
  } catch { return []; }
}

async function searchTleApi(query) {
  try {
    const url = `https://tle.ivanstanojevic.me/api/tle?search=${encodeURIComponent(query)}&page_size=20`;
    const response = await fetchWithTimeout(url, 8000);
    if (!response.ok) return [];
    const data = await response.json();
    if (!data.member || !Array.isArray(data.member)) return [];
    return data.member
      .filter(rec => rec.satelliteId != null)
      .map(rec => ({
        name: rec.name || `SAT-${rec.satelliteId}`,
        noradId: rec.satelliteId,
      }));
  } catch { return []; }
}

/**
 * Fetch GP data in JSON format (alternative approach for richer data).
 * Returns parsed GP record or null.
 */
export async function fetchGPJson(noradId) {
  try {
    const url = `${CELESTRAK_GP_URL}?CATNR=${noradId}&FORMAT=JSON`;
    const response = await fetchWithTimeout(url, 8000);
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data[0];
  } catch {
    return null;
  }
}
