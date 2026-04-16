/**
 * Pool-based client for opportunity-worker.js.
 *
 * - Maintains up to MAX_WORKERS workers (sized to navigator.hardwareConcurrency
 *   minus a couple of cores so the UI stays responsive).
 * - `findOpportunitiesPool()` resolves a single satellite's analysis on
 *   the next free worker; falls back to the main-thread implementation
 *   if workers are unavailable (Safari edge cases, tests, jailed iframes).
 * - `analyzeAllInPool()` schedules every satellite concurrently and
 *   surfaces per-satellite progress + completion via callbacks.
 */

import { findOpportunities } from './opportunity.js';
import { parseTLE } from './propagate.js';

const MAX_WORKERS = (() => {
  if (typeof navigator === 'undefined' || !navigator.hardwareConcurrency) return 2;
  return Math.max(1, Math.min(4, navigator.hardwareConcurrency - 2));
})();

let workerSupported = true;
const idle = [];
const busy = new Set();
const queue = [];

function tryCreateWorker() {
  try {
    return new Worker(new URL('./opportunity-worker.js', import.meta.url), { type: 'module' });
  } catch (err) {
    console.warn('Opportunity worker unavailable, falling back to main thread:', err);
    workerSupported = false;
    return null;
  }
}

function getWorker() {
  if (idle.length) return idle.pop();
  if (idle.length + busy.size < MAX_WORKERS) {
    const w = tryCreateWorker();
    if (w) return w;
  }
  return null;
}

function releaseWorker(w) {
  busy.delete(w);
  idle.push(w);
  pump();
}

function pump() {
  while (queue.length) {
    const w = getWorker();
    if (!w) break;
    const next = queue.shift();
    busy.add(w);
    next(w);
  }
}

let nextId = 1;

/**
 * Run findOpportunities() for one satellite, preferring a worker.
 *
 * @param {{ line1, line2 } | null} tle  When null, must pass `satrec`.
 * @param {object|null} satrec           Used only on main-thread fallback.
 * @param {number} targetLat
 * @param {number} targetLon
 * @param {object} settings
 * @param {(fraction:number)=>void} [onProgress]
 * @param {AbortSignal} [signal]
 */
export function findOpportunitiesPool(tle, satrec, targetLat, targetLon, settings = {}, onProgress, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }

    const fallback = async () => {
      try {
        const sr = satrec || parseTLE(tle.line1, tle.line2);
        const opps = await findOpportunities(sr, targetLat, targetLon, settings, onProgress);
        if (signal && signal.aborted) reject(new DOMException('aborted', 'AbortError'));
        else resolve(opps);
      } catch (err) { reject(err); }
    };

    if (!workerSupported || !tle) { fallback(); return; }

    const dispatch = (worker) => {
      const id = nextId++;
      let onAbort = null;
      const cleanup = () => {
        worker.removeEventListener('message', onMsg);
        worker.removeEventListener('error', onErr);
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      };
      const onMsg = (e) => {
        const m = e.data;
        if (!m || m.id !== id) return;
        if (m.type === 'progress') {
          if (onProgress) onProgress(m.fraction);
        } else if (m.type === 'done') {
          cleanup();
          releaseWorker(worker);
          const opps = m.opportunities.map(o => ({ ...o, time: new Date(o.time) }));
          resolve(opps);
        } else if (m.type === 'error') {
          cleanup();
          releaseWorker(worker);
          reject(new Error(m.error));
        }
      };
      const onErr = () => {
        cleanup();
        // Worker died — drop it from pool, fall back to main thread.
        try { worker.terminate(); } catch {}
        busy.delete(worker);
        workerSupported = idle.length + busy.size > 0;
        fallback();
      };
      worker.addEventListener('message', onMsg);
      worker.addEventListener('error', onErr);
      if (signal) {
        onAbort = () => {
          cleanup();
          // Abort by killing the worker (no graceful protocol). It will
          // be replaced lazily next time a slot is needed.
          try { worker.terminate(); } catch {}
          busy.delete(worker);
          reject(new DOMException('aborted', 'AbortError'));
          pump();
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
      worker.postMessage({ id, type: 'find', tle, targetLat, targetLon, settings });
    };

    queue.push(dispatch);
    pump();
  });
}

/**
 * Run findOpportunities for many satellites in parallel using the pool.
 *
 * @param {Array<{ noradId, name, color, satrec, tle? }>} satellites
 * @param {number} targetLat
 * @param {number} targetLon
 * @param {object} settings
 * @param {object} [hooks]
 * @param {(satNoradId:number, fraction:number)=>void} [hooks.onProgress]
 * @param {(result:object)=>void} [hooks.onOneComplete]
 * @param {AbortSignal} [hooks.signal]
 */
export async function analyzeAllInPool(satellites, targetLat, targetLon, settings = {}, hooks = {}) {
  const { onProgress, onOneComplete, signal } = hooks;
  const results = [];

  const tasks = satellites.map(async (sat) => {
    if (!sat.satrec && !sat.tle) {
      const result = {
        noradId: sat.noradId,
        name: sat.name || `SAT-${sat.noradId}`,
        color: sat.color || null,
        status: 'no_tle',
        opportunities: [],
      };
      if (onOneComplete) onOneComplete(result);
      results.push(result);
      return;
    }
    try {
      const opps = await findOpportunitiesPool(
        sat.tle || null,
        sat.satrec || null,
        targetLat, targetLon, settings,
        (f) => onProgress && onProgress(sat.noradId, f),
        signal,
      );
      const result = {
        noradId: sat.noradId,
        name: sat.name,
        color: sat.color || null,
        satrec: sat.satrec || null,
        status: opps.length > 0 ? 'available' : 'no_opportunity',
        opportunities: opps,
      };
      if (onOneComplete) onOneComplete(result);
      results.push(result);
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      const result = {
        noradId: sat.noradId,
        name: sat.name,
        color: sat.color || null,
        status: 'error',
        error: err.message,
        opportunities: [],
      };
      if (onOneComplete) onOneComplete(result);
      results.push(result);
    }
  });

  await Promise.all(tasks);

  results.sort((a, b) => {
    const aHas = a.opportunities?.length > 0;
    const bHas = b.opportunities?.length > 0;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (aHas && bHas) return a.opportunities[0].time.getTime() - b.opportunities[0].time.getTime();
    return 0;
  });

  return results;
}
