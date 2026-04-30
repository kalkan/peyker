/**
 * Roll / off-nadir angle calculation — ported from Sezen.
 *
 * Computes the cross-track off-nadir (≈ roll) angle required for a
 * satellite to image a given target point on Earth.
 *
 *        Satellite (S)
 *           /|
 *          / |
 *   roll  /  | altitude h (km)
 *  angle /   |
 *   η   /    |
 *      /     |
 *     ───────── Earth surface
 *     T      N
 *   (target) (nadir)
 *          |--d--|
 *          ground distance (km)
 *
 *   η = atan( d / h )
 *
 * Flat-Earth tangent model — accurate at small off-nadir angles (≤ 15°).
 * At larger angles the model diverges from the true spherical geometry,
 * but those cases are outside the imaging acceptance threshold anyway.
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const EARTH_RADIUS_KM = 6371.0;

/**
 * Haversine angular distance between two points on a sphere (radians).
 */
export function haversineAngle(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const dp = (lat2 - lat1) * DEG2RAD;
  const dl = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dp / 2) ** 2 +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Compute off-nadir / roll geometry for a satellite–target pair.
 *
 * @param {number} satLat     sub-satellite latitude (degrees)
 * @param {number} satLon     sub-satellite longitude (degrees)
 * @param {number} satAltKm   satellite altitude above surface (km)
 * @param {number} targetLat  target latitude (degrees)
 * @param {number} targetLon  target longitude (degrees)
 * @returns {{
 *   offNadirDeg: number,
 *   rollDeg: number,
 *   groundDistKm: number,
 *   angularDistDeg: number
 * }}
 */
export function computeOffNadir(satLat, satLon, satAltKm, targetLat, targetLon) {
  const gamma = haversineAngle(satLat, satLon, targetLat, targetLon);
  const groundDistKm = EARTH_RADIUS_KM * gamma;

  const offNadirRad = Math.atan2(groundDistKm, satAltKm);
  const offNadirDeg = offNadirRad * RAD2DEG;

  return {
    offNadirDeg,
    rollDeg: offNadirDeg,
    groundDistKm,
    angularDistDeg: gamma * RAD2DEG,
  };
}
