/**
 * Upcoming satellite passes panel.
 * Computes and displays passes over the ground station for the selected satellite.
 */

import { getState, findSatellite } from './state.js';
import { predictPasses } from '../sat/propagate.js';
import { GROUND_STATIONS } from '../sat/presets.js';

// Cache: { noradId, passes, computedAt }
let passCache = null;
const CACHE_TTL = 60000; // 1 minute

/**
 * Render the passes panel into the given container.
 */
export function renderPassesPanel(container) {
  const state = getState();
  container.innerHTML = '';

  if (!state.selectedSatId) {
    container.innerHTML = '<div class="empty-state">Select a satellite to see passes</div>';
    return;
  }

  const sat = findSatellite(state.selectedSatId);
  if (!sat) {
    container.innerHTML = '<div class="empty-state">Satellite not found</div>';
    return;
  }

  if (!sat.satrec) {
    container.innerHTML = '<div class="pass-loading">Loading TLE data...</div>';
    return;
  }

  if (GROUND_STATIONS.length === 0) {
    container.innerHTML = '<div class="empty-state">No ground station configured</div>';
    return;
  }

  const gs = GROUND_STATIONS[0];
  const now = Date.now();

  // Use cache if same satellite and recent
  if (passCache && passCache.noradId === sat.noradId && (now - passCache.computedAt) < CACHE_TTL) {
    buildPassUI(container, passCache.passes, sat.name);
    return;
  }

  // Show loading then compute
  container.innerHTML = '<div class="pass-loading">Computing passes...</div>';
  requestAnimationFrame(() => {
    const passes = predictPasses(sat.satrec, gs, 7);
    passCache = { noradId: sat.noradId, passes, computedAt: Date.now() };
    buildPassUI(container, passes, sat.name);
  });
}

/**
 * Get the next upcoming pass for a satellite (used by ground station popup).
 */
export function getNextPass(satrec, gs) {
  const passes = predictPasses(satrec, gs, 2, 30);
  return passes.length > 0 ? passes[0] : null;
}

function buildPassUI(container, passes, satName) {
  container.innerHTML = '';

  if (passes.length === 0) {
    container.innerHTML = '<div class="empty-state">No passes in the next 7 days</div>';
    return;
  }

  const now = Date.now();

  // Next pass highlight card
  const nextPass = passes.find(p => p.los.getTime() > now);
  if (nextPass) {
    const card = document.createElement('div');
    card.className = 'next-pass-card';

    const isActive = nextPass.aos.getTime() <= now;
    const label = isActive ? 'ACTIVE PASS' : 'NEXT PASS';
    const labelClass = isActive ? 'next-pass-badge active' : 'next-pass-badge';

    const countdown = isActive ? '' : getCountdown(nextPass.aos.getTime() - now);

    card.innerHTML = `
      <div class="${labelClass}">${label}</div>
      <div class="next-pass-times">
        <div class="next-pass-row">
          <span class="next-pass-label">AOS</span>
          <span class="next-pass-value">${fmtTime(nextPass.aos)}</span>
          <span class="next-pass-date">${fmtDate(nextPass.aos)}</span>
        </div>
        <div class="next-pass-row">
          <span class="next-pass-label">TCA</span>
          <span class="next-pass-value">${fmtTime(nextPass.tca)}</span>
          <span class="next-pass-date">${nextPass.maxEl.toFixed(1)}° max</span>
        </div>
        <div class="next-pass-row">
          <span class="next-pass-label">LOS</span>
          <span class="next-pass-value">${fmtTime(nextPass.los)}</span>
          <span class="next-pass-date">${fmtDuration(nextPass)}</span>
        </div>
      </div>
      ${countdown ? `<div class="next-pass-countdown">${countdown}</div>` : ''}
    `;
    container.append(card);
  }

  // Full table grouped by day
  const grouped = groupByDay(passes);
  for (const [dayLabel, dayPasses] of grouped) {
    const dayHeader = document.createElement('div');
    dayHeader.className = 'pass-day-header';
    dayHeader.textContent = dayLabel;
    container.append(dayHeader);

    const table = document.createElement('table');
    table.className = 'pass-table';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>AOS</th><th>LOS</th><th>Dur.</th><th>Max El.</th></tr>';
    table.append(thead);

    const tbody = document.createElement('tbody');
    for (const pass of dayPasses) {
      const tr = document.createElement('tr');

      const isNext = nextPass && pass.aos.getTime() === nextPass.aos.getTime();
      const isPast = pass.los.getTime() < now;
      if (isNext) tr.className = 'pass-row-next';
      if (isPast) tr.className = 'pass-row-past';

      const elClass = getElClass(pass.maxEl);

      tr.innerHTML = `
        <td>${fmtTime(pass.aos)}</td>
        <td>${fmtTime(pass.los)}</td>
        <td>${fmtDuration(pass)}</td>
        <td><span class="el-badge ${elClass}">${pass.maxEl.toFixed(1)}°</span></td>
      `;
      tbody.append(tr);
    }
    table.append(tbody);
    container.append(table);
  }

  const note = document.createElement('div');
  note.className = 'pass-note';
  note.textContent = `${passes.length} pass${passes.length !== 1 ? 'es' : ''} — times in TR (UTC+3)`;
  container.append(note);
}

function groupByDay(passes) {
  const groups = new Map();
  for (const pass of passes) {
    const key = fmtDate(pass.aos);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pass);
  }
  return groups;
}

function getElClass(el) {
  if (el >= 60) return 'el-high';
  if (el >= 30) return 'el-mid';
  if (el >= 10) return 'el-low';
  return 'el-vlow';
}

function getCountdown(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `${d}d ${rh}h ${m}m`;
  }
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDuration(pass) {
  const sec = (pass.los - pass.aos) / 1000;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s}s`;
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

/**
 * Build a short HTML string for ground station popup showing next pass per satellite.
 */
export function buildGsPopupContent(gs) {
  const state = getState();
  let html = `<strong>${gs.name}</strong><br>${gs.lat.toFixed(5)}°, ${gs.lon.toFixed(5)}°`;
  if (gs.alt != null) html += `<br>Altitude: ${gs.alt} m`;

  const sats = state.satellites.filter(s => s.satrec);
  if (sats.length === 0) return html;

  html += '<hr style="margin:6px 0;border-color:rgba(255,255,255,0.2)">';

  for (const sat of sats) {
    const pass = getNextPass(sat.satrec, gs);
    if (pass) {
      const isActive = pass.aos.getTime() <= Date.now();
      const statusLabel = isActive ? '<span style="color:#3fb950">ACTIVE</span>' : 'Next';
      html += `<div style="font-size:12px;margin-top:4px">
        <strong>${sat.name}</strong> — ${statusLabel}<br>
        <span style="font-family:monospace;font-size:11px">
          ${fmtTime(pass.aos)} → ${fmtTime(pass.los)}, ${pass.maxEl.toFixed(1)}° max
        </span>
      </div>`;
    } else {
      html += `<div style="font-size:12px;margin-top:4px"><strong>${sat.name}</strong> — No pass (48h)</div>`;
    }
  }

  return html;
}
