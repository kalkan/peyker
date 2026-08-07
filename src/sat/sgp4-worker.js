/**
 * Web Worker that runs SGP4 pass prediction off the main thread so a
 * 30-day × N-satellite predict sweep never stalls the UI.
 *
 * Protocol (both directions are { id } correlated):
 *   in:  { id, type: 'predictPasses', tle: { line1, line2 },
 *          gs: { lat, lon, alt }, days, stepSeconds?, startTime? }
 *   out: { id, passes }            (Date fields serialized as ISO strings)
 *   err: { id, error: string }
 */

import { parseTLE, predictPasses } from './propagate.js';

self.onmessage = (e) => {
  const { id, type, tle, gs, days, stepSeconds, startTime } = e.data || {};
  if (type !== 'predictPasses') return;
  try {
    const satrec = parseTLE(tle.line1, tle.line2);
    const passes = predictPasses(satrec, gs, days, stepSeconds, startTime);
    // Dates → ISO so they survive structured-clone cleanly (also plays well
    // with the IDB cache serialization on the main thread).
    const serialized = passes.map(p => ({
      aos: p.aos.toISOString(),
      los: p.los.toISOString(),
      tca: p.tca.toISOString(),
      maxEl: p.maxEl,
      azAos: p.azAos,
      azTca: p.azTca,
      azLos: p.azLos,
    }));
    self.postMessage({ id, passes: serialized });
  } catch (err) {
    self.postMessage({ id, error: err && err.message ? err.message : String(err) });
  }
};
