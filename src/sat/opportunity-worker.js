/**
 * Web Worker that runs `findOpportunities` for a single satellite off the
 * main thread. The client wrapper (opportunity-worker-client.js) spins up
 * one worker per satellite so a 4-sat × 30-day analysis runs in parallel.
 *
 * Protocol (id-correlated, both directions):
 *   in:  { id, type: 'find',
 *          tle: { line1, line2 },
 *          targetLat, targetLon,
 *          settings: { MAX_ROLL_DEG, SEARCH_HORIZON_DAYS, ... } }
 *   out: { id, type: 'progress', fraction }       (zero or more)
 *        { id, type: 'done', opportunities }       (Date as ISO string)
 *        { id, type: 'error', error }
 */

import { parseTLE } from './propagate.js';
import { findOpportunities } from './opportunity.js';

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type !== 'find') return;
  const { id, tle, targetLat, targetLon, settings } = msg;
  try {
    const satrec = parseTLE(tle.line1, tle.line2);
    const opportunities = await findOpportunities(
      satrec, targetLat, targetLon, settings,
      (fraction) => self.postMessage({ id, type: 'progress', fraction }),
    );
    // Dates → ISO so structured-clone round-trips cleanly.
    const serialized = opportunities.map(o => ({
      ...o,
      time: o.time.toISOString(),
    }));
    self.postMessage({ id, type: 'done', opportunities: serialized });
  } catch (err) {
    self.postMessage({
      id, type: 'error',
      error: err && err.message ? err.message : String(err),
    });
  }
};
