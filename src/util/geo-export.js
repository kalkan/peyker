/**
 * KML / GeoJSON export of imaging opportunities.
 *
 * Each opportunity contributes a sub-satellite point plus a look line to
 * the target; the target itself is a single point feature. Attributes
 * carry timing, geometry, sun and cloud data so the files drop cleanly
 * into Google Earth or QGIS.
 */

/**
 * @param {Array} results  [{ name, noradId, opportunities: [...] }]
 * @param {{lat:number, lon:number, name?:string}} target
 * @returns {string} GeoJSON FeatureCollection
 */
export function buildOpportunityGeoJson(results, target) {
  const features = [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [target.lon, target.lat] },
    properties: { kind: 'target', name: target.name || 'Hedef' },
  }];

  for (const r of results) {
    for (const o of r.opportunities) {
      const props = {
        kind: 'opportunity',
        satellite: r.name,
        noradId: r.noradId,
        time: o.time.toISOString(),
        rollDeg: round2(o.rollDeg),
        offNadirDeg: round2(o.offNadirDeg),
        altKm: Math.round(o.altKm),
        groundDistKm: Math.round(o.groundDistKm),
        sunElevationDeg: round2(o.sunElevation),
      };
      if (o.cloudCover) props.cloudCoverPct = o.cloudCover.total;
      if (o._score) props.score = Math.round(o._score.score);

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [o.subSatLon, o.subSatLat] },
        properties: props,
      });
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[o.subSatLon, o.subSatLat], [target.lon, target.lat]],
        },
        properties: { kind: 'look-line', satellite: r.name, time: o.time.toISOString() },
      });
    }
  }

  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}

/**
 * @param {Array} results  same shape as buildOpportunityGeoJson
 * @param {{lat:number, lon:number, name?:string}} target
 * @returns {string} KML document
 */
export function buildOpportunityKml(results, target) {
  const placemarks = [
    `    <Placemark>
      <name>${escXml(target.name || 'Hedef')}</name>
      <styleUrl>#target</styleUrl>
      <Point><coordinates>${target.lon},${target.lat},0</coordinates></Point>
    </Placemark>`,
  ];

  for (const r of results) {
    for (const o of r.opportunities) {
      const when = o.time.toISOString();
      const desc = [
        `Uydu: ${r.name} (#${r.noradId})`,
        `Roll: ${round2(o.rollDeg)}° · Off-nadir: ${round2(o.offNadirDeg)}°`,
        `Yükseklik: ${Math.round(o.altKm)} km · Mesafe: ${Math.round(o.groundDistKm)} km`,
        `Güneş: ${round2(o.sunElevation)}°`,
        o.cloudCover ? `Bulut: ${o.cloudCover.total}%` : null,
      ].filter(Boolean).join('\n');

      placemarks.push(`    <Placemark>
      <name>${escXml(r.name)} — ${when.slice(0, 16).replace('T', ' ')}</name>
      <description>${escXml(desc)}</description>
      <TimeStamp><when>${when}</when></TimeStamp>
      <styleUrl>#opp</styleUrl>
      <Point><coordinates>${o.subSatLon},${o.subSatLat},0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Bakış — ${escXml(r.name)}</name>
      <TimeStamp><when>${when}</when></TimeStamp>
      <styleUrl>#look</styleUrl>
      <LineString><tessellate>1</tessellate><coordinates>${o.subSatLon},${o.subSatLat},0 ${target.lon},${target.lat},0</coordinates></LineString>
    </Placemark>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Peyker — Görüntüleme Fırsatları</name>
    <Style id="target"><IconStyle><color>ff3567ff</color><scale>1.2</scale></IconStyle></Style>
    <Style id="opp"><IconStyle><color>ffffa658</color><scale>0.9</scale></IconStyle></Style>
    <Style id="look"><LineStyle><color>7fffa658</color><width>1.5</width></LineStyle></Style>
${placemarks.join('\n')}
  </Document>
</kml>
`;
}

/** Trigger a browser download of `content` as `filename`. */
export function downloadTextFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function round2(v) { return Math.round(v * 100) / 100; }

function escXml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]));
}
