/**
 * SGP4 orbit propagation and geodetic conversion using satellite.js.
 *
 * Handles:
 *  - TLE parsing to satrec
 *  - Position propagation at arbitrary times
 *  - Geodetic (lat/lon/alt) conversion
 *  - Daily ground track generation with configurable step size
 *  - Anti-meridian crossing detection and polyline splitting
 */

import * as satellite from 'satellite.js';

/**
 * Parse TLE lines into a satellite.js satrec object.
 */
export function parseTLE(line1, line2) {
  return satellite.twoline2satrec(line1, line2);
}

/**
 * Extract orbital elements from a satrec for display.
 * All values derived from the TLE data.
 */
export function getOrbitalElements(satrec) {
  const RAD2DEG = 180 / Math.PI;
  const inclinationDeg = satrec.inclo * RAD2DEG;
  const eccentricity = satrec.ecco;
  const meanMotionRevPerDay = satrec.no * (1440 / (2 * Math.PI)); // rad/min → rev/day
  const periodMinutes = (2 * Math.PI) / satrec.no; // in minutes
  const raan = satrec.nodeo * RAD2DEG;
  const argPerigee = satrec.argpo * RAD2DEG;
  const meanAnomaly = satrec.mo * RAD2DEG;

  // Epoch: satrec.epochyr (2-digit year) and satrec.epochdays (day of year)
  const year = satrec.epochyr < 57 ? 2000 + satrec.epochyr : 1900 + satrec.epochyr;
  const epochDate = dayOfYearToDate(year, satrec.epochdays);

  return {
    inclination: inclinationDeg,
    eccentricity,
    meanMotion: meanMotionRevPerDay,
    periodMinutes,
    raan,
    argPerigee,
    meanAnomaly,
    epoch: epochDate,
  };
}

/**
 * Convert day-of-year (fractional) to a Date object.
 */
function dayOfYearToDate(year, dayOfYear) {
  const d = new Date(Date.UTC(year, 0, 1));
  d.setTime(d.getTime() + (dayOfYear - 1) * 86400000);
  return d;
}

/**
 * Propagate satellite position at a given Date.
 * Returns { lat, lon, alt, position } or null on error.
 *
 * lat/lon in degrees, alt in km.
 */
export function propagateAt(satrec, date) {
  const positionAndVelocity = satellite.propagate(satrec, date);

  if (!positionAndVelocity.position || positionAndVelocity.position === true) {
    return null; // propagation error
  }

  const gmst = satellite.gstime(date);
  const geodetic = satellite.eciToGeodetic(positionAndVelocity.position, gmst);

  const RAD2DEG = 180 / Math.PI;
  let lon = geodetic.longitude * RAD2DEG;
  let lat = geodetic.latitude * RAD2DEG;
  const alt = geodetic.height; // km

  // Normalize longitude to [-180, 180]
  lon = ((lon + 540) % 360) - 180;

  return { lat, lon, alt, position: positionAndVelocity.position };
}

/**
 * Generate ground track points for a time range.
 *
 * @param {Object} satrec - satellite.js satrec object
 * @param {Date} startTime - start of propagation window
 * @param {number} durationHours - how many hours to propagate
 * @param {number} stepSeconds - time step in seconds
 * @returns {Array<{lat: number, lon: number, alt: number, time: Date}>}
 */
export function generateGroundTrack(satrec, startTime, durationHours, stepSeconds) {
  const points = [];
  const durationMs = durationHours * 3600 * 1000;
  const stepMs = stepSeconds * 1000;
  const endTime = startTime.getTime() + durationMs;

  for (let t = startTime.getTime(); t <= endTime; t += stepMs) {
    const date = new Date(t);
    const pos = propagateAt(satrec, date);
    if (pos) {
      points.push({ lat: pos.lat, lon: pos.lon, alt: pos.alt, time: date });
    }
  }

  return points;
}

/**
 * Compute the sensor footprint strip for a ground track.
 *
 * Uses frame dimensions (km) instead of FOV angles.
 * Roll shifts the frame cross-track, pitch shifts it along-track.
 *
 * @param {Array} trackPoints - array of { lat, lon, alt, time }
 * @param {number} frameWidthKm - sensor frame width in km (cross-track)
 * @param {number} frameHeightKm - sensor frame height in km (along-track)
 * @param {number} rollDeg - roll angle in degrees (positive = right)
 * @param {number} pitchDeg - pitch angle in degrees (positive = forward)
 * @returns {{ left: Array<[lat,lon]>, right: Array<[lat,lon]>, centers: Array<[lat,lon]> }}
 */
export function computeSwathPolygon(trackPoints, frameWidthKm, frameHeightKm, rollDeg, pitchDeg) {
  if (trackPoints.length < 2) return { left: [], right: [], centers: [] };

  const DEG2RAD = Math.PI / 180;
  const EARTH_R = 6371; // km
  const halfWidth = frameWidthKm / 2;

  const left = [];
  const right = [];
  const centers = [];

  for (let i = 0; i < trackPoints.length; i++) {
    const p = trackPoints[i];
    const alt = p.alt; // km

    // Compute heading from adjacent points
    let heading;
    if (i < trackPoints.length - 1) {
      heading = bearing(p.lat, p.lon, trackPoints[i + 1].lat, trackPoints[i + 1].lon);
    } else {
      heading = bearing(trackPoints[i - 1].lat, trackPoints[i - 1].lon, p.lat, p.lon);
    }

    const crossRight = heading + 90;
    const crossLeft = heading - 90;

    // Roll shift: cross-track displacement (km)
    const rollShiftKm = alt * Math.tan(rollDeg * DEG2RAD);
    // Pitch shift: along-track displacement (km)
    const pitchShiftKm = alt * Math.tan(pitchDeg * DEG2RAD);

    // Start from sub-satellite point, apply roll + pitch shift to get frame center
    let cLat = p.lat, cLon = p.lon;
    if (rollShiftKm !== 0) {
      [cLat, cLon] = destPoint(cLat, cLon, rollShiftKm, crossRight, EARTH_R);
    }
    if (pitchShiftKm !== 0) {
      [cLat, cLon] = destPoint(cLat, cLon, pitchShiftKm, heading, EARTH_R);
    }

    // Frame edges: half-width left and right from center
    const leftPt = destPoint(cLat, cLon, halfWidth, crossLeft, EARTH_R);
    const rightPt = destPoint(cLat, cLon, halfWidth, crossRight, EARTH_R);

    left.push(leftPt);
    right.push(rightPt);
    centers.push([cLat, cLon]);
  }

  return { left, right, centers };
}

/**
 * Compute a single footprint rectangle at a specific track point index.
 * Returns 4 corners of the rectangle [[lat,lon], ...] in order (for L.polygon).
 */
export function computeFootprintRect(trackPoints, index, frameWidthKm, frameHeightKm, rollDeg, pitchDeg) {
  if (trackPoints.length < 2 || index < 0 || index >= trackPoints.length) return null;

  const DEG2RAD = Math.PI / 180;
  const EARTH_R = 6371;
  const halfW = frameWidthKm / 2;
  const halfH = frameHeightKm / 2;

  const p = trackPoints[index];
  const alt = p.alt;

  // Compute heading
  let heading;
  if (index < trackPoints.length - 1) {
    heading = bearing(p.lat, p.lon, trackPoints[index + 1].lat, trackPoints[index + 1].lon);
  } else {
    heading = bearing(trackPoints[index - 1].lat, trackPoints[index - 1].lon, p.lat, p.lon);
  }

  const crossRight = heading + 90;
  const crossLeft = heading - 90;
  const forward = heading;
  const backward = (heading + 180) % 360;

  // Roll/pitch shift to get frame center
  const rollShiftKm = alt * Math.tan(rollDeg * DEG2RAD);
  const pitchShiftKm = alt * Math.tan(pitchDeg * DEG2RAD);

  let cLat = p.lat, cLon = p.lon;
  if (rollShiftKm !== 0) {
    [cLat, cLon] = destPoint(cLat, cLon, rollShiftKm, crossRight, EARTH_R);
  }
  if (pitchShiftKm !== 0) {
    [cLat, cLon] = destPoint(cLat, cLon, pitchShiftKm, forward, EARTH_R);
  }

  // 4 corners: front-left, front-right, back-right, back-left
  const fl = destPoint(...destPoint(cLat, cLon, halfH, forward, EARTH_R), halfW, crossLeft, EARTH_R);
  const fr = destPoint(...destPoint(cLat, cLon, halfH, forward, EARTH_R), halfW, crossRight, EARTH_R);
  const br = destPoint(...destPoint(cLat, cLon, halfH, backward, EARTH_R), halfW, crossRight, EARTH_R);
  const bl = destPoint(...destPoint(cLat, cLon, halfH, backward, EARTH_R), halfW, crossLeft, EARTH_R);

  return { corners: [fl, fr, br, bl], center: [cLat, cLon], subsat: [p.lat, p.lon] };
}

// Compute bearing between two lat/lon points (degrees)
function bearing(lat1, lon1, lat2, lon2) {
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const y = Math.sin(dLon) * Math.cos(lat2 * DEG2RAD);
  const x = Math.cos(lat1 * DEG2RAD) * Math.sin(lat2 * DEG2RAD) -
            Math.sin(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.cos(dLon);
  return ((Math.atan2(y, x) * RAD2DEG) + 360) % 360;
}

// Destination point given start, distance (km), bearing (degrees), earth radius
function destPoint(lat, lon, distKm, bearingDeg, earthR) {
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;
  const angDist = distKm / earthR;
  const brng = bearingDeg * DEG2RAD;
  const lat1 = lat * DEG2RAD;
  const lon1 = lon * DEG2RAD;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) +
    Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1),
    Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
  );

  return [lat2 * RAD2DEG, ((lon2 * RAD2DEG) + 540) % 360 - 180];
}

/**
 * Compute look angles (elevation, azimuth, range) from a ground station to a satellite.
 *
 * @param {Object} satrec - satellite.js satrec object
 * @param {Date} date - time of observation
 * @param {Object} gs - ground station { lat, lon, alt } (degrees, degrees, metres)
 * @returns {{ elevation: number, azimuth: number, rangeSat: number } | null}
 *   elevation/azimuth in degrees, rangeSat in km
 */
export function getLookAngles(satrec, date, gs) {
  const posVel = satellite.propagate(satrec, date);
  if (!posVel.position || posVel.position === true) return null;

  const gmst = satellite.gstime(date);
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  const observerGd = {
    longitude: gs.lon * DEG2RAD,
    latitude: gs.lat * DEG2RAD,
    height: (gs.alt || 0) / 1000, // metres → km
  };

  const posEcf = satellite.eciToEcf(posVel.position, gmst);
  const lookAngles = satellite.ecfToLookAngles(observerGd, posEcf);

  return {
    elevation: lookAngles.elevation * RAD2DEG,
    azimuth: lookAngles.azimuth * RAD2DEG,
    rangeSat: lookAngles.rangeSat,
  };
}

/**
 * Cached wrapper around getLookAngles. Bounded LRU-ish cache keyed by
 * (satrec identity + time bucket + gs identity). Cache entries are
 * rounded to the nearest second so rapid re-calls (polar chart +
 * live readout + transition check at the same moment) reuse one
 * propagation. Size-limited to prevent unbounded growth.
 */
const LOOK_CACHE_MAX = 4096;
const lookCache = new Map();  // key → { data, ts }
let lookCacheSatTag = new WeakMap();
let lookCacheGsTag = new WeakMap();
let _tagCounter = 0;
function _tagFor(obj, map) {
  let t = map.get(obj);
  if (t === undefined) { t = ++_tagCounter; map.set(obj, t); }
  return t;
}

export function getLookAnglesCached(satrec, date, gs) {
  const sec = Math.floor(date.getTime() / 1000);
  const key = _tagFor(satrec, lookCacheSatTag) + ':' + _tagFor(gs, lookCacheGsTag) + ':' + sec;
  const hit = lookCache.get(key);
  if (hit) return hit.data;
  const data = getLookAngles(satrec, date, gs);
  // Evict oldest when over cap (Map keeps insertion order)
  if (lookCache.size >= LOOK_CACHE_MAX) {
    const firstKey = lookCache.keys().next().value;
    if (firstKey !== undefined) lookCache.delete(firstKey);
  }
  lookCache.set(key, { data });
  return data;
}

/**
 * Predict satellite passes over a ground station for a given number of days.
 *
 * A pass is detected when the satellite elevation rises above 0° as seen
 * from the ground station. For each pass we record the start (AOS),
 * end (LOS), maximum elevation, and the time of max elevation (TCA).
 *
 * @param {Object} satrec - satellite.js satrec object
 * @param {Object} gs - ground station { lat, lon, alt }
 * @param {number} days - how many days to look ahead
 * @param {number} [stepSeconds=30] - coarse scan step
 * @returns {Array<{ aos: Date, los: Date, tca: Date, maxEl: number }>}
 */
export function predictPasses(satrec, gs, days, stepSeconds = 60) {
  const passes = [];
  const start = Date.now();
  const end = start + days * 86400000;
  const coarseStepMs = stepSeconds * 1000;
  const fineStepMs = 10 * 1000;  // inside a pass: 10 s steps to locate TCA accurately

  let inPass = false;
  let passStart = null;
  let maxEl = 0;
  let maxElTime = null;
  let stepMs = coarseStepMs;
  let t = start;

  while (t <= end) {
    const date = new Date(t);
    const look = getLookAngles(satrec, date, gs);
    if (!look) { t += stepMs; continue; }

    if (look.elevation > 0) {
      if (!inPass) {
        // Refine AOS with 1-second precision
        passStart = refineTime(satrec, gs, t - stepMs, t, true);
        inPass = true;
        maxEl = look.elevation;
        maxElTime = date;
        stepMs = fineStepMs;  // switch to fine-grained inside the pass
      }
      if (look.elevation > maxEl) {
        maxEl = look.elevation;
        maxElTime = date;
      }
    } else if (inPass) {
      // Refine LOS with 1-second precision
      const los = refineTime(satrec, gs, t - stepMs, t, false);
      // Compute azimuth at AOS, TCA, LOS
      const aosDate = new Date(passStart);
      const losDate = new Date(los);
      const tcaDate = new Date(maxElTime);
      const aosLook = getLookAngles(satrec, aosDate, gs);
      const tcaLook = getLookAngles(satrec, tcaDate, gs);
      const losLook = getLookAngles(satrec, losDate, gs);

      passes.push({
        aos: aosDate,
        los: losDate,
        tca: tcaDate,
        maxEl,
        azAos: aosLook ? aosLook.azimuth : null,
        azTca: tcaLook ? tcaLook.azimuth : null,
        azLos: losLook ? losLook.azimuth : null,
      });
      inPass = false;
      maxEl = 0;
      stepMs = coarseStepMs;  // back to coarse
    }
    t += stepMs;
  }

  // Close any pass still in progress at end of window
  if (inPass) {
    const aosDate = new Date(passStart);
    const losDate = new Date(end);
    const tcaDate = new Date(maxElTime);
    const aosLook = getLookAngles(satrec, aosDate, gs);
    const tcaLook = getLookAngles(satrec, tcaDate, gs);
    const losLook = getLookAngles(satrec, losDate, gs);
    passes.push({
      aos: aosDate,
      los: losDate,
      tca: tcaDate,
      maxEl,
      azAos: aosLook ? aosLook.azimuth : null,
      azTca: tcaLook ? tcaLook.azimuth : null,
      azLos: losLook ? losLook.azimuth : null,
    });
  }

  return passes;
}

/**
 * Binary search to find the precise crossing time (elevation = 0).
 * @param {boolean} rising - true for AOS (find where el goes > 0), false for LOS
 */
function refineTime(satrec, gs, tLow, tHigh, rising) {
  for (let i = 0; i < 15; i++) {
    const tMid = (tLow + tHigh) / 2;
    const look = getLookAngles(satrec, new Date(tMid), gs);
    const aboveHorizon = look && look.elevation > 0;
    if (rising ? aboveHorizon : !aboveHorizon) {
      tHigh = tMid;
    } else {
      tLow = tMid;
    }
  }
  return rising ? tHigh : tLow;
}

/**
 * Split a polyline of lat/lon points at anti-meridian crossings.
 * Returns an array of segments, each being an array of [lat, lon] pairs.
 *
 * The anti-meridian is crossed when consecutive points have a longitude
 * difference > 180° (after accounting for wrapping).
 */
export function splitAtAntiMeridian(points) {
  if (points.length === 0) return [];

  const segments = [];
  let current = [[points[0].lat, points[0].lon]];

  for (let i = 1; i < points.length; i++) {
    const prevLon = points[i - 1].lon;
    const currLon = points[i].lon;
    const lonDiff = Math.abs(currLon - prevLon);

    // If the longitude jump is > 180°, we've crossed the anti-meridian
    if (lonDiff > 180) {
      // End current segment and start a new one
      segments.push(current);
      current = [];
    }

    current.push([points[i].lat, points[i].lon]);
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}
