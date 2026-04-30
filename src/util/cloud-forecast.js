/**
 * Cloud cover forecast via Open-Meteo API (free, no API key).
 *
 * Fetches hourly cloud cover (total + low/mid/high layers) for a
 * coordinate and caches the result for 30 minutes.  Call getCloudAtTime()
 * to look up the forecast value nearest a specific datetime.
 */

const CACHE = new Map();
const CACHE_TTL = 30 * 60_000;

/**
 * Fetch cloud cover forecast for a location.
 * Returns { times[], total[], low[], mid[], high[] } or null on error.
 */
export async function fetchCloudForecast(lat, lon, days = 7) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${days}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high` +
      `&forecast_days=${days}&timezone=UTC`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const h = data.hourly;
    if (!h || !h.time) return null;

    const entry = {
      fetchedAt: Date.now(),
      times: h.time,
      total: h.cloud_cover,
      low: h.cloud_cover_low,
      mid: h.cloud_cover_mid,
      high: h.cloud_cover_high,
    };
    CACHE.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

/**
 * Look up cloud cover at the hour closest to `date`.
 * Returns { total, low, mid, high } (percentages) or null.
 */
export function getCloudAtTime(forecast, date) {
  if (!forecast || !forecast.times || forecast.times.length === 0) return null;
  const target = date.getTime();
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < forecast.times.length; i++) {
    const diff = Math.abs(new Date(forecast.times[i]).getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    else break;
  }
  return {
    total: forecast.total[bestIdx],
    low: forecast.low[bestIdx],
    mid: forecast.mid[bestIdx],
    high: forecast.high[bestIdx],
  };
}

/**
 * Enrich an array of opportunity objects with `cloudCover` field.
 * Each opportunity gets { total, low, mid, high } or null.
 */
export function enrichWithCloud(opportunities, forecast) {
  for (const opp of opportunities) {
    opp.cloudCover = getCloudAtTime(forecast, opp.time);
  }
}
