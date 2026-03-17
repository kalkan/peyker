/**
 * Pass overlap analysis panel.
 * Finds time windows where multiple satellites are simultaneously
 * visible from the ground station over the next 7 days.
 */

import { getState } from './state.js';
import { predictPasses } from '../sat/propagate.js';
import { GROUND_STATIONS } from '../sat/presets.js';

// Cache: { key, overlaps, computedAt }
let overlapCache = null;
const CACHE_TTL = 120000; // 2 minutes

/**
 * Render the overlap analysis panel.
 */
export function renderOverlapPanel(container) {
  const state = getState();
  container.innerHTML = '';

  const satsWithTle = state.satellites.filter(s => s.satrec);

  if (satsWithTle.length < 2) {
    container.innerHTML = '<div class="empty-state">Add at least 2 satellites to analyze overlaps</div>';
    return;
  }

  if (GROUND_STATIONS.length === 0) {
    container.innerHTML = '<div class="empty-state">No ground station configured</div>';
    return;
  }

  const gs = GROUND_STATIONS[0];
  const now = Date.now();
  const cacheKey = satsWithTle.map(s => s.noradId).sort().join(',');

  if (overlapCache && overlapCache.key === cacheKey && (now - overlapCache.computedAt) < CACHE_TTL) {
    buildOverlapUI(container, overlapCache.overlaps, satsWithTle);
    return;
  }

  container.innerHTML = '<div class="pass-loading">Analyzing overlaps...</div>';
  requestAnimationFrame(() => {
    const allPasses = [];
    for (const sat of satsWithTle) {
      const passes = predictPasses(sat.satrec, gs, 7);
      for (const p of passes) {
        allPasses.push({ ...p, sat });
      }
    }

    const overlaps = findOverlaps(allPasses);
    overlapCache = { key: cacheKey, overlaps, computedAt: Date.now() };
    buildOverlapUI(container, overlaps, satsWithTle);
  });
}

/**
 * Find all pairwise overlapping passes.
 * An overlap is when two passes from different satellites share a time window.
 */
function findOverlaps(allPasses) {
  const overlaps = [];

  // Sort by AOS
  allPasses.sort((a, b) => a.aos - b.aos);

  for (let i = 0; i < allPasses.length; i++) {
    for (let j = i + 1; j < allPasses.length; j++) {
      const a = allPasses[i];
      const b = allPasses[j];

      // Same satellite — skip
      if (a.sat.noradId === b.sat.noradId) continue;

      // b starts after a ends — no overlap possible for b or later
      if (b.aos >= a.los) break;

      // Overlap window
      const overlapStart = b.aos; // b starts later since sorted
      const overlapEnd = new Date(Math.min(a.los.getTime(), b.los.getTime()));
      const overlapSec = (overlapEnd - overlapStart) / 1000;

      if (overlapSec > 0) {
        overlaps.push({
          satA: a.sat,
          satB: b.sat,
          passA: a,
          passB: b,
          start: overlapStart,
          end: overlapEnd,
          durationSec: overlapSec,
          maxElA: a.maxEl,
          maxElB: b.maxEl,
        });
      }
    }
  }

  // Sort by overlap start time
  overlaps.sort((a, b) => a.start - b.start);
  return overlaps;
}

function buildOverlapUI(container, overlaps, sats) {
  container.innerHTML = '';

  // Summary
  const summary = document.createElement('div');
  summary.className = 'overlap-summary';
  const satNames = sats.map(s => s.name).join(', ');
  summary.innerHTML = `<span class="overlap-sat-list">${satNames}</span>`;
  container.append(summary);

  if (overlaps.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No overlapping passes in the next 7 days';
    container.append(empty);
    return;
  }

  const now = Date.now();

  // Group by day
  const grouped = groupByDay(overlaps);
  for (const [dayLabel, dayOverlaps] of grouped) {
    const dayHeader = document.createElement('div');
    dayHeader.className = 'pass-day-header';
    dayHeader.textContent = dayLabel;
    container.append(dayHeader);

    for (const ov of dayOverlaps) {
      const card = document.createElement('div');
      const isPast = ov.end.getTime() < now;
      card.className = 'overlap-card' + (isPast ? ' overlap-past' : '');

      const durMin = Math.floor(ov.durationSec / 60);
      const durS = Math.floor(ov.durationSec % 60);
      const durStr = durMin > 0 ? `${durMin}m ${durS}s` : `${durS}s`;

      card.innerHTML = `
        <div class="overlap-header">
          <span class="overlap-sats">
            <span class="overlap-chip" style="background:${ov.satA.color}"></span>${ov.satA.name}
            <span class="overlap-x">&times;</span>
            <span class="overlap-chip" style="background:${ov.satB.color}"></span>${ov.satB.name}
          </span>
          <span class="overlap-dur">${durStr}</span>
        </div>
        <div class="overlap-times">
          <span>${fmtTime(ov.start)} — ${fmtTime(ov.end)}</span>
        </div>
        <div class="overlap-details">
          <span>${ov.satA.name}: ${getElBadge(ov.maxElA)}</span>
          <span>${ov.satB.name}: ${getElBadge(ov.maxElB)}</span>
        </div>
      `;
      container.append(card);
    }
  }

  const note = document.createElement('div');
  note.className = 'pass-note';
  note.textContent = `${overlaps.length} overlap${overlaps.length !== 1 ? 's' : ''} — times in TR (UTC+3)`;
  container.append(note);
}

function groupByDay(items) {
  const groups = new Map();
  for (const item of items) {
    const key = fmtDate(item.start);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function getElBadge(el) {
  const cls = el >= 60 ? 'el-high' : el >= 30 ? 'el-mid' : el >= 10 ? 'el-low' : 'el-vlow';
  return `<span class="el-badge ${cls}">${el.toFixed(1)}°</span>`;
}

function fmtTime(date) {
  return date.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function fmtDate(date) {
  return date.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}
