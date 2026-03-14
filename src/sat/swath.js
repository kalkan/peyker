/**
 * Swath / roll-angle ground coverage estimation.
 *
 * ASSUMPTIONS AND LIMITATIONS:
 *  - Spherical Earth model (radius = 6371 km).
 *  - The sensor is modeled as a simple off-nadir pointing instrument.
 *  - Roll angle defines the maximum off-nadir angle on each side.
 *  - Ground swath width is estimated using flat-Earth approximation:
 *      half-width ≈ altitude × tan(rollAngle)
 *  - This is a PLANNING VISUALIZATION, not a rigorous sensor model.
 *  - Atmospheric refraction, terrain, and Earth curvature effects on
 *    the footprint edge are not modeled.
 *  - For high altitudes or large roll angles, the flat-Earth approximation
 *    becomes less accurate. A spherical correction is applied for angles > 30°.
 *
 * The swath polygon is constructed by offsetting ground track points
 * perpendicular to the track direction (left and right) by the estimated
 * half-width, then forming a closed polygon.
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Estimate the ground swath half-width in km given altitude and roll angle.
 *
 * For small angles (< 30°): simple tangent approximation.
 * For larger angles: spherical geometry correction.
 *
 * @param {number} altitudeKm - satellite altitude in km
 * @param {number} rollAngleDeg - roll angle in degrees
 * @returns {number} half-width in km
 */
export function estimateSwathHalfWidth(altitudeKm, rollAngleDeg) {
  const rollRad = (rollAngleDeg * Math.PI) / 180;

  if (rollAngleDeg <= 30) {
    // Simple flat-Earth approximation
    return altitudeKm * Math.tan(rollRad);
  }

  // Spherical geometry: the nadir angle at Earth's center
  // sin(nadirAngle) / sin(rollAngle) = R / (R + h)
  // But for planning purposes, use a blended approximation:
  const R = EARTH_RADIUS_KM;
  const h = altitudeKm;
  const sinEta = ((R + h) / R) * Math.sin(rollRad);

  // If sinEta > 1, the look angle exceeds the horizon
  if (sinEta >= 1) {
    // Clamp to horizon distance
    return R * Math.acos(R / (R + h));
  }

  const eta = Math.asin(sinEta);
  const earthCentralAngle = eta - rollRad;
  return R * earthCentralAngle;
}

/**
 * Offset a lat/lon point perpendicular to a bearing by a given distance.
 *
 * @param {number} lat - latitude in degrees
 * @param {number} lon - longitude in degrees
 * @param {number} bearing - bearing in degrees (0 = north, 90 = east)
 * @param {number} distanceKm - distance to offset
 * @returns {{lat: number, lon: number}}
 */
function offsetPoint(lat, lon, bearing, distanceKm) {
  const R = EARTH_RADIUS_KM;
  const d = distanceKm / R;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const brngRad = (bearing * Math.PI) / 180;

  const newLat = Math.asin(
    Math.sin(latRad) * Math.cos(d) +
    Math.cos(latRad) * Math.sin(d) * Math.cos(brngRad)
  );

  const newLon = lonRad + Math.atan2(
    Math.sin(brngRad) * Math.sin(d) * Math.cos(latRad),
    Math.cos(d) - Math.sin(latRad) * Math.sin(newLat)
  );

  return {
    lat: (newLat * 180) / Math.PI,
    lon: (((newLon * 180) / Math.PI + 540) % 360) - 180,
  };
}

/**
 * Calculate bearing between two points in degrees.
 */
function calcBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Generate swath polygon coordinates from ground track points.
 *
 * Returns an array of polygon segments (split at anti-meridian).
 * Each segment is an array of [lat, lon] pairs forming a closed polygon.
 *
 * @param {Array<{lat, lon, alt}>} trackPoints - ground track points
 * @param {number} rollAngleDeg - roll angle in degrees
 * @returns {Array<Array<[number, number]>>} array of polygon coordinate arrays
 */
export function generateSwathPolygon(trackPoints, rollAngleDeg) {
  if (trackPoints.length < 2 || rollAngleDeg <= 0) return [];

  const leftEdge = [];
  const rightEdge = [];

  for (let i = 0; i < trackPoints.length; i++) {
    const pt = trackPoints[i];

    // Calculate bearing at this point using neighbors
    let bearing;
    if (i === 0) {
      bearing = calcBearing(pt.lat, pt.lon, trackPoints[1].lat, trackPoints[1].lon);
    } else if (i === trackPoints.length - 1) {
      bearing = calcBearing(trackPoints[i - 1].lat, trackPoints[i - 1].lon, pt.lat, pt.lon);
    } else {
      bearing = calcBearing(trackPoints[i - 1].lat, trackPoints[i - 1].lon, trackPoints[i + 1].lat, trackPoints[i + 1].lon);
    }

    const halfWidth = estimateSwathHalfWidth(pt.alt, rollAngleDeg);

    // Left side: perpendicular bearing - 90°
    const leftBearing = (bearing - 90 + 360) % 360;
    const rightBearing = (bearing + 90) % 360;

    const left = offsetPoint(pt.lat, pt.lon, leftBearing, halfWidth);
    const right = offsetPoint(pt.lat, pt.lon, rightBearing, halfWidth);

    leftEdge.push(left);
    rightEdge.push(right);
  }

  // Build polygon: left edge forward, right edge reversed, close it
  const polygonPoints = [
    ...leftEdge.map(p => ({ lat: p.lat, lon: p.lon })),
    ...rightEdge.reverse().map(p => ({ lat: p.lat, lon: p.lon })),
  ];

  // Split at anti-meridian
  return splitSwathAtAntiMeridian(polygonPoints);
}

/**
 * Split swath polygon at anti-meridian crossings.
 * Returns segments that can each be rendered as a separate polygon.
 */
function splitSwathAtAntiMeridian(points) {
  if (points.length === 0) return [];

  const segments = [];
  let current = [[points[0].lat, points[0].lon]];

  for (let i = 1; i < points.length; i++) {
    const prevLon = points[i - 1].lon;
    const currLon = points[i].lon;

    if (Math.abs(currLon - prevLon) > 180) {
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
