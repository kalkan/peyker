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
    const elClass = isActive ? 'el-high' : (nextPass.maxEl >= 30 ? 'el-mid' : 'el-low');

    // Satellite arc SVG illustration
    const arcSvg = `<svg class="next-pass-arc" viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="arc-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${isActive ? '#3fb950' : '#5daaff'}" stop-opacity="0.1"/>
          <stop offset="50%" stop-color="${isActive ? '#3fb950' : '#5daaff'}" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="${isActive ? '#3fb950' : '#5daaff'}" stop-opacity="0.1"/>
        </linearGradient>
      </defs>
      <path d="M10 70 Q100 ${Math.max(5, 70 - nextPass.maxEl)} 190 70" fill="none" stroke="url(#arc-grad)" stroke-width="2" stroke-dasharray="${isActive ? 'none' : '4 3'}"/>
      <circle cx="10" cy="70" r="2" fill="#5c6980"/>
      <circle cx="190" cy="70" r="2" fill="#5c6980"/>
      ${isActive
        ? `<circle cx="100" cy="${Math.max(8, 70 - nextPass.maxEl)}" r="4" fill="#3fb950" opacity="0.9">
             <animate attributeName="opacity" values="0.9;0.4;0.9" dur="2s" repeatCount="indefinite"/>
           </circle>`
        : `<circle cx="100" cy="${Math.max(8, 70 - nextPass.maxEl)}" r="3" fill="#5daaff" opacity="0.7"/>`
      }
      <!-- Antenna -->
      <g transform="translate(95, 70)">
        <line x1="5" y1="0" x2="5" y2="-8" stroke="#98a4b8" stroke-width="1.2"/>
        <circle cx="5" cy="-8" r="3" fill="none" stroke="#98a4b8" stroke-width="1"/>
        <line x1="1" y1="-5" x2="-2" y2="-2" stroke="#98a4b8" stroke-width="0.8"/>
        <line x1="9" y1="-5" x2="12" y2="-2" stroke="#98a4b8" stroke-width="0.8"/>
      </g>
      <!-- Satellite icon -->
      <g transform="translate(${isActive ? 95 : 95}, ${Math.max(2, 70 - nextPass.maxEl - 8)})">
        <rect x="0" y="2" width="10" height="6" rx="1" fill="#98a4b8" opacity="0.7"/>
        <rect x="-6" y="3" width="6" height="4" rx="0.5" fill="${isActive ? '#3fb950' : '#5daaff'}" opacity="0.5"/>
        <rect x="10" y="3" width="6" height="4" rx="0.5" fill="${isActive ? '#3fb950' : '#5daaff'}" opacity="0.5"/>
      </g>
      <text x="10" y="78" font-size="7" fill="#5c6980" font-family="sans-serif">AOS</text>
      <text x="180" y="78" font-size="7" fill="#5c6980" font-family="sans-serif">LOS</text>
    </svg>`;

    card.innerHTML = `
      <div class="next-pass-top">
        <div class="${labelClass}">${label}</div>
        ${countdown ? `<div class="next-pass-countdown">${countdown}</div>` : ''}
      </div>
      ${arcSvg}
      <div class="next-pass-el-hero">
        <span class="next-pass-el-value ${elClass}">${nextPass.maxEl.toFixed(1)}°</span>
        <span class="next-pass-el-label">max elevation</span>
      </div>
      <div class="next-pass-times">
        <div class="next-pass-row">
          <span class="next-pass-label">AOS</span>
          <span class="next-pass-value">${fmtTime(nextPass.aos)}</span>
          <span class="next-pass-date">${fmtDate(nextPass.aos)}</span>
        </div>
        <div class="next-pass-row">
          <span class="next-pass-label">TCA</span>
          <span class="next-pass-value">${fmtTime(nextPass.tca)}</span>
          <span class="next-pass-date">${fmtDuration(nextPass)}</span>
        </div>
        <div class="next-pass-row">
          <span class="next-pass-label">LOS</span>
          <span class="next-pass-value">${fmtTime(nextPass.los)}</span>
          <span class="next-pass-date">${fmtDate(nextPass.los)}</span>
        </div>
      </div>
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
