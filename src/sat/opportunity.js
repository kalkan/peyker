/**
 * Access opportunity analysis — ported from Sezen.
 *
 * Finds all imaging opportunities where a satellite can observe a ground
 * target within the roll-angle constraint during daylight hours.
 *
 * Algorithm:
 *   1. COARSE SCAN — propagate at COARSE_STEP_SEC intervals. Track the
 *      continuous windows where off-nadir stays below a generous pre-filter
 *      threshold. The minimum within each window is a candidate.
 *   2. REFINEMENT — around each candidate, do a fine scan at
 *      REFINE_STEP_SEC to find the exact minimum off-nadir moment.
 *   3. FILTERING — accept only passes where off-nadir ≤ MAX_ROLL_DEG
 *      and the target is in daylight.
 *   4. DEDUPLICATION — merge passes within 10 minutes (same orbital pass).
 */

import { propagateAt } from './propagate.js';
import { computeOffNadir } from './roll.js';
import { sunElevation } from './sun.js';

export const DEFAULT_OPPORTUNITY_CONFIG = {
  MAX_ROLL_DEG: 5.0,
  SEARCH_HORIZON_DAYS: 7,
  COARSE_STEP_SEC: 10,
  REFINE_STEP_SEC: 1,
  REFINE_WINDOW_SEC: 180,
  MIN_SUN_ELEVATION_DEG: -2,
  MAX_OPPORTUNITIES: 20,
};

function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Find imaging opportunities for one satellite against a ground target.
 *
 * @param {object} satrec             satellite.js satrec
 * @param {number} targetLat          target latitude (degrees)
 * @param {number} targetLon          target longitude (degrees)
 * @param {object} [settings={}]      override any config field
 * @param {function} [onProgress]     callback(fraction 0..1)
 * @returns {Promise<Array<{
 *   time: Date,
 *   rollDeg: number,
 *   offNadirDeg: number,
 *   groundDistKm: number,
 *   altKm: number,
 *   subSatLat: number,
 *   subSatLon: number,
 *   sunElevation: number,
 * }>>}
 */
export async function findOpportunities(satrec, targetLat, targetLon, settings = {}, onProgress = null) {
  const cfg = { ...DEFAULT_OPPORTUNITY_CONFIG, ...settings };
  const maxRoll = cfg.MAX_ROLL_DEG;
  const horizonDays = cfg.SEARCH_HORIZON_DAYS;
  const coarseStepMs = cfg.COARSE_STEP_SEC * 1000;
  const refineStepMs = cfg.REFINE_STEP_SEC * 1000;
  const refineWindowMs = cfg.REFINE_WINDOW_SEC * 1000;
  const maxOpp = cfg.MAX_OPPORTUNITIES;

  // Generous prefilter margin so we don't miss edge passes at coarse step.
  const prefilterDeg = Math.max(maxRoll + 15, 20);

  const now = new Date();
  const endMs = now.getTime() + horizonDays * 86400_000;
  const totalMs = endMs - now.getTime();

  // ── Phase 1: coarse scan, track below-prefilter windows ─────────
  const coarseCandidates = [];
  let yieldCounter = 0;

  let inWindow = false;
  let windowBestTime = null;
  let windowBestOffNadir = Infinity;

  for (let t = now.getTime(); t <= endMs; t += coarseStepMs) {
    const date = new Date(t);
    const pos = propagateAt(satrec, date);

    if (!pos) {
      if (inWindow && windowBestTime) {
        coarseCandidates.push({ time: windowBestTime, offNadirDeg: windowBestOffNadir });
        inWindow = false;
        windowBestTime = null;
        windowBestOffNadir = Infinity;
      }
      if (++yieldCounter % 2000 === 0) {
        if (onProgress) onProgress((t - now.getTime()) / totalMs);
        await yieldToUI();
      }
      continue;
    }

    const geom = computeOffNadir(pos.lat, pos.lon, pos.alt, targetLat, targetLon);
    const curOffNadir = geom.offNadirDeg;

    if (curOffNadir < prefilterDeg) {
      if (!inWindow) {
        inWindow = true;
        windowBestTime = date;
        windowBestOffNadir = curOffNadir;
      } else if (curOffNadir < windowBestOffNadir) {
        windowBestTime = date;
        windowBestOffNadir = curOffNadir;
      }
    } else {
      if (inWindow && windowBestTime) {
        coarseCandidates.push({ time: windowBestTime, offNadirDeg: windowBestOffNadir });
      }
      inWindow = false;
      windowBestTime = null;
      windowBestOffNadir = Infinity;
    }

    if (++yieldCounter % 2000 === 0) {
      if (onProgress) onProgress((t - now.getTime()) / totalMs);
      await yieldToUI();
    }
  }

  if (inWindow && windowBestTime) {
    coarseCandidates.push({ time: windowBestTime, offNadirDeg: windowBestOffNadir });
  }

  // Deduplicate candidates within ±2 × refine window (same orbital pass)
  const dedupedCandidates = [];
  for (const c of coarseCandidates) {
    const last = dedupedCandidates[dedupedCandidates.length - 1];
    if (last && Math.abs(c.time.getTime() - last.time.getTime()) < refineWindowMs * 2) {
      if (c.offNadirDeg < last.offNadirDeg) {
        dedupedCandidates[dedupedCandidates.length - 1] = c;
      }
    } else {
      dedupedCandidates.push(c);
    }
  }

  // ── Phase 2: refine each candidate ──────────────────────────────
  const rawOpportunities = [];

  for (const candidate of dedupedCandidates) {
    const windowStart = candidate.time.getTime() - refineWindowMs;
    const windowEnd = candidate.time.getTime() + refineWindowMs;

    let bestTime = null;
    let bestOffNadir = Infinity;
    let bestPos = null;

    for (let t = windowStart; t <= windowEnd; t += refineStepMs) {
      const date = new Date(t);
      const pos = propagateAt(satrec, date);
      if (!pos) continue;
      const geom = computeOffNadir(pos.lat, pos.lon, pos.alt, targetLat, targetLon);
      if (geom.offNadirDeg < bestOffNadir) {
        bestOffNadir = geom.offNadirDeg;
        bestTime = date;
        bestPos = pos;
      }
    }

    if (!bestPos || !bestTime) continue;
    if (bestOffNadir > maxRoll) continue;

    // Daylight filter
    const sunElev = sunElevation(bestTime, targetLat, targetLon);
    if (sunElev < cfg.MIN_SUN_ELEVATION_DEG) continue;

    const geom = computeOffNadir(bestPos.lat, bestPos.lon, bestPos.alt, targetLat, targetLon);

    // Signed roll via cross product with velocity direction
    const posAhead = propagateAt(satrec, new Date(bestTime.getTime() + 1000));
    let signedRoll = geom.rollDeg;
    if (posAhead) {
      const vLon = posAhead.lon - bestPos.lon;
      const vLat = posAhead.lat - bestPos.lat;
      const tLon = targetLon - bestPos.lon;
      const tLat = targetLat - bestPos.lat;
      const cross = vLon * tLat - vLat * tLon;
      signedRoll = cross >= 0 ? geom.rollDeg : -geom.rollDeg;
    }

    rawOpportunities.push({
      time: bestTime,
      rollDeg: signedRoll,
      offNadirDeg: geom.offNadirDeg,
      groundDistKm: geom.groundDistKm,
      altKm: bestPos.alt,
      subSatLat: bestPos.lat,
      subSatLon: bestPos.lon,
      sunElevation: sunElev,
    });
  }

  // ── Phase 3: deduplicate passes within 10 min ───────────────────
  rawOpportunities.sort((a, b) => a.time.getTime() - b.time.getTime());

  const opportunities = [];
  for (const opp of rawOpportunities) {
    if (opportunities.length >= maxOpp) break;
    const last = opportunities[opportunities.length - 1];
    if (last && Math.abs(opp.time.getTime() - last.time.getTime()) < 600_000) {
      if (opp.offNadirDeg < last.offNadirDeg) {
        opportunities[opportunities.length - 1] = opp;
      }
    } else {
      opportunities.push(opp);
    }
  }

  if (onProgress) onProgress(1);
  return opportunities;
}

/**
 * Run opportunity analysis for all satellites (sequential).
 */
export async function analyzeAll(satellites, targetLat, targetLon, settings = {}, onOneComplete = null) {
  const results = [];
  for (const sat of satellites) {
    if (!sat.satrec) {
      const result = {
        noradId: sat.noradId,
        name: sat.name || `SAT-${sat.noradId}`,
        color: sat.color || null,
        status: 'no_tle',
        opportunities: [],
      };
      if (onOneComplete) onOneComplete(result);
      results.push(result);
      continue;
    }

    try {
      const opportunities = await findOpportunities(sat.satrec, targetLat, targetLon, settings);
      const result = {
        noradId: sat.noradId,
        name: sat.name,
        color: sat.color || null,
        satrec: sat.satrec,
        status: opportunities.length > 0 ? 'available' : 'no_opportunity',
        opportunities,
      };
      if (onOneComplete) onOneComplete(result);
      results.push(result);
    } catch (err) {
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
  }

  results.sort((a, b) => {
    const aHas = a.opportunities?.length > 0;
    const bHas = b.opportunities?.length > 0;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (aHas && bHas) {
      return a.opportunities[0].time.getTime() - b.opportunities[0].time.getTime();
    }
    return 0;
  });

  return results;
}
