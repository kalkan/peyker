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
