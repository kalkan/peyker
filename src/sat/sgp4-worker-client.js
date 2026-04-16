/**
 * Client wrapper around sgp4-worker.js. Exposes an async
 * predictPassesInWorker() that mirrors the synchronous signature but
 * runs the actual SGP4 sweep on a dedicated Worker thread.
 *
 * Falls back to synchronous execution if the browser can't spin up
 * module workers (very old Safari, some privacy settings, tests).
 */

import { parseTLE, predictPasses } from './propagate.js';

let worker = null;
let workerOk = true;
let nextId = 1;
const pending = new Map();

function ensureWorker() {
  if (worker || !workerOk) return worker;
  try {
    worker = new Worker(new URL('./sgp4-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, passes, error } = e.data || {};
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (error) { entry.reject(new Error(error)); return; }
      entry.resolve(passes.map(x => ({
        ...x,
        aos: new Date(x.aos),
        los: new Date(x.los),
        tca: new Date(x.tca),
      })));
    };
    worker.onerror = (err) => {
      console.warn('SGP4 worker error, falling back to main-thread predict:', err.message || err);
      workerOk = false;
      // Reject every in-flight call so callers can fall back
      for (const [id, entry] of pending) entry.reject(new Error('worker-error'));
      pending.clear();
      try { worker.terminate(); } catch {}
      worker = null;
    };
  } catch (err) {
    console.warn('Failed to create SGP4 worker:', err);
    workerOk = false;
    worker = null;
  }
  return worker;
}

export async function predictPassesInWorker(tleLine1, tleLine2, gs, days, stepSeconds) {
  const w = ensureWorker();
  if (!w) {
    // Fall back to synchronous on the main thread
    const satrec = parseTLE(tleLine1, tleLine2);
    return predictPasses(satrec, gs, days, stepSeconds);
  }
  try {
    return await new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      w.postMessage({ id, type: 'predictPasses', tle: { line1: tleLine1, line2: tleLine2 }, gs, days, stepSeconds });
    });
  } catch (err) {
    // Worker broke mid-flight — fall back
    const satrec = parseTLE(tleLine1, tleLine2);
    return predictPasses(satrec, gs, days, stepSeconds);
  }
}
