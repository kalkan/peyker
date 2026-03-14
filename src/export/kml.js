/**
 * KML generation and download.
 *
 * Generates standards-compliant KML files client-side.
 * Supports:
 *  - Single satellite track export
 *  - Multi-satellite export with folders
 *  - Current position placemark
 *  - Swath polygon export
 *  - Proper XML escaping and UTF-8
 */

/**
 * Escape XML special characters.
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert hex color to KML AABBGGRR format.
 * KML uses alpha-blue-green-red order.
 */
function hexToKmlColor(hex, alpha = 'cc') {
  const clean = hex.replace('#', '');
  const r = clean.substring(0, 2);
  const g = clean.substring(2, 4);
  const b = clean.substring(4, 6);
  return `${alpha}${b}${g}${r}`;
}

/**
 * Generate coordinate string from track points.
 * KML format: lon,lat,alt (space separated).
 */
function coordsToKml(points) {
  return points
    .map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)},${(p.alt * 1000).toFixed(0)}`)
    .join(' ');
}

/**
 * Generate a KML Folder element for a satellite.
 */
function satFolder(sat, includeSwathPoints) {
  const parts = [];
  parts.push(`    <Folder>`);
  parts.push(`      <name>${escapeXml(sat.name)} (${sat.noradId})</name>`);

  // Track style
  parts.push(`      <Style id="track_${sat.noradId}">`);
  parts.push(`        <LineStyle>`);
  parts.push(`          <color>${hexToKmlColor(sat.color)}</color>`);
  parts.push(`          <width>2</width>`);
  parts.push(`        </LineStyle>`);
  parts.push(`      </Style>`);

  // Track placemark
  if (sat.trackPoints && sat.trackPoints.length > 0) {
    parts.push(`      <Placemark>`);
    parts.push(`        <name>${escapeXml(sat.name)} Ground Track</name>`);
    parts.push(`        <styleUrl>#track_${sat.noradId}</styleUrl>`);
    parts.push(`        <LineString>`);
    parts.push(`          <tessellate>1</tessellate>`);
    parts.push(`          <altitudeMode>absolute</altitudeMode>`);
    parts.push(`          <coordinates>${coordsToKml(sat.trackPoints)}</coordinates>`);
    parts.push(`        </LineString>`);
    parts.push(`      </Placemark>`);
  }

  // Current position placemark
  if (sat.currentPos) {
    parts.push(`      <Placemark>`);
    parts.push(`        <name>${escapeXml(sat.name)} Current Position</name>`);
    parts.push(`        <description>NORAD: ${sat.noradId}\nAlt: ${sat.currentPos.alt.toFixed(1)} km</description>`);
    parts.push(`        <Style>`);
    parts.push(`          <IconStyle>`);
    parts.push(`            <color>${hexToKmlColor(sat.color, 'ff')}</color>`);
    parts.push(`            <scale>1.2</scale>`);
    parts.push(`            <Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>`);
    parts.push(`          </IconStyle>`);
    parts.push(`        </Style>`);
    parts.push(`        <Point>`);
    parts.push(`          <altitudeMode>absolute</altitudeMode>`);
    parts.push(`          <coordinates>${sat.currentPos.lon.toFixed(6)},${sat.currentPos.lat.toFixed(6)},${(sat.currentPos.alt * 1000).toFixed(0)}</coordinates>`);
    parts.push(`        </Point>`);
    parts.push(`      </Placemark>`);
  }

  // Swath polygon
  if (includeSwathPoints && includeSwathPoints.length > 0) {
    parts.push(`      <Placemark>`);
    parts.push(`        <name>${escapeXml(sat.name)} Coverage Swath</name>`);
    parts.push(`        <Style>`);
    parts.push(`          <PolyStyle>`);
    parts.push(`            <color>${hexToKmlColor(sat.color, '40')}</color>`);
    parts.push(`            <outline>1</outline>`);
    parts.push(`          </PolyStyle>`);
    parts.push(`          <LineStyle>`);
    parts.push(`            <color>${hexToKmlColor(sat.color, '80')}</color>`);
    parts.push(`            <width>1</width>`);
    parts.push(`          </LineStyle>`);
    parts.push(`        </Style>`);
    parts.push(`        <Polygon>`);
    parts.push(`          <tessellate>1</tessellate>`);
    parts.push(`          <outerBoundaryIs>`);
    parts.push(`            <LinearRing>`);
    const swathCoords = includeSwathPoints
      .map(p => `${p[1].toFixed(6)},${p[0].toFixed(6)},0`)
      .join(' ');
    parts.push(`              <coordinates>${swathCoords}</coordinates>`);
    parts.push(`            </LinearRing>`);
    parts.push(`          </outerBoundaryIs>`);
    parts.push(`        </Polygon>`);
    parts.push(`      </Placemark>`);
  }

  parts.push(`    </Folder>`);
  return parts.join('\n');
}

/**
 * Generate complete KML document for one or more satellites.
 *
 * @param {string} docName - document name/title
 * @param {Array} satellites - satellite data objects
 * @param {Map} swathData - optional map of noradId -> swath polygon points
 * @returns {string} KML XML string
 */
export function generateKML(docName, satellites, swathData = new Map()) {
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  parts.push('  <Document>');
  parts.push(`    <name>${escapeXml(docName)}</name>`);
  parts.push(`    <description>Generated by Satellite Ground Track Planner</description>`);

  for (const sat of satellites) {
    const swath = swathData.get(sat.noradId);
    // Flatten swath segments into single polygon for KML
    const flatSwath = swath ? swath.flat() : null;
    parts.push(satFolder(sat, flatSwath));
  }

  parts.push('  </Document>');
  parts.push('</kml>');

  return parts.join('\n');
}

/**
 * Trigger download of a KML file in the browser.
 */
export function downloadKML(filename, kmlContent) {
  const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generate a clean filename for KML export.
 */
export function makeKmlFilename(satName, noradId, type) {
  const cleanName = satName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toISOString().slice(11, 16).replace(':', '');

  if (type === 'live') {
    return `${cleanName}_${noradId}_live_${dateStr}_${timeStr}.kml`;
  } else if (type === 'daytrack') {
    return `${cleanName}_${noradId}_daytrack_${dateStr}.kml`;
  }
  return `${cleanName}_${noradId}_${dateStr}.kml`;
}
