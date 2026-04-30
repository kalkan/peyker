/**
 * Solar position module — ported from Sezen.
 *
 * Computes Sun elevation at a given geographic location and time.
 * Used to determine whether a target is in daylight — only daylight
 * passes are relevant for optical Earth observation imaging.
 *
 * Algorithm: simplified astronomical solar position (Meeus-style),
 * accurate to ~1° which is more than sufficient for day/night
 * discrimination. No atmospheric refraction correction.
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Compute the Julian Day Number from a JavaScript Date (UTC).
 */
function julianDay(date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const h = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  let yr = y;
  let mo = m;
  if (mo <= 2) { yr -= 1; mo += 12; }

  const A = Math.floor(yr / 100);
  const B = 2 - A + Math.floor(A / 4);

  return Math.floor(365.25 * (yr + 4716)) +
         Math.floor(30.6001 * (mo + 1)) +
         d + h / 24.0 + B - 1524.5;
}

/**
 * Compute the Sun's elevation angle at a geographic location.
 *
 * @param {Date}   date       UTC time
 * @param {number} latitude   degrees (positive north)
 * @param {number} longitude  degrees (positive east)
 * @returns {number} Sun elevation in degrees (positive = above horizon)
 */
export function sunElevation(date, latitude, longitude) {
  const JD = julianDay(date);
  const T = (JD - 2451545.0) / 36525.0;

  // Geometric mean longitude of the Sun (degrees)
  let L0 = 280.46646 + T * (36000.76983 + T * 0.0003032);
  L0 = ((L0 % 360) + 360) % 360;

  // Mean anomaly of the Sun (degrees)
  let M = 357.52911 + T * (35999.05029 - T * 0.0001537);
  M = ((M % 360) + 360) % 360;
  const Mrad = M * DEG2RAD;

  // Equation of center (degrees)
  const C = (1.914602 - T * (0.004817 + T * 0.000014)) * Math.sin(Mrad)
          + (0.019993 - T * 0.000101) * Math.sin(2 * Mrad)
          + 0.000289 * Math.sin(3 * Mrad);

  // Sun's apparent longitude (corrected for nutation, approximate)
  const sunLon = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = sunLon - 0.00569 - 0.00478 * Math.sin(omega * DEG2RAD);

  // Obliquity of the ecliptic (degrees)
  const eps0 = 23.0 + (26.0 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60.0) / 60.0;
  const eps = eps0 + 0.00256 * Math.cos(omega * DEG2RAD);

  // Declination (radians)
  const declination = Math.asin(Math.sin(eps * DEG2RAD) * Math.sin(lambda * DEG2RAD));

  // Right ascension
  const y2 = Math.cos(eps * DEG2RAD) * Math.sin(lambda * DEG2RAD);
  const x2 = Math.cos(lambda * DEG2RAD);
  const RA = Math.atan2(y2, x2);

  // Greenwich Mean Sidereal Time (degrees → radians)
  let GMST = 280.46061837 + 360.98564736629 * (JD - 2451545.0)
             + T * T * (0.000387933 - T / 38710000.0);
  GMST = ((GMST % 360) + 360) % 360;

  // Local hour angle (radians)
  const LHA = (GMST + longitude) * DEG2RAD - RA;

  const latRad = latitude * DEG2RAD;
  const sinElev = Math.sin(latRad) * Math.sin(declination)
                + Math.cos(latRad) * Math.cos(declination) * Math.cos(LHA);

  return Math.asin(sinElev) * RAD2DEG;
}

/**
 * Check if a location is in daylight at a given time.
 *
 * @param {Date}   date
 * @param {number} latitude   degrees
 * @param {number} longitude  degrees
 * @param {number} [minElevation=0]  minimum Sun elevation in degrees
 *                 (0° = geometric sunrise/sunset, -6° = civil twilight)
 * @returns {boolean}
 */
export function isDaylight(date, latitude, longitude, minElevation = 0) {
  return sunElevation(date, latitude, longitude) >= minElevation;
}
