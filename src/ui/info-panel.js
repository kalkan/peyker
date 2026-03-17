/**
 * Satellite information panel.
 * Displays orbital elements and metadata for the selected satellite.
 */

import { getState, findSatellite } from './state.js';
import { getOrbitalElements, propagateAt, predictPasses } from '../sat/propagate.js';
import { GROUND_STATIONS } from '../sat/presets.js';

/**
 * Render satellite info panel into the given container.
 */
export function renderInfoPanel(container) {
  const state = getState();
  container.innerHTML = '';

  if (!state.selectedSatId) {
    container.innerHTML = '<div class="empty-state">Select a satellite to see details</div>';
    return;
  }

  const sat = findSatellite(state.selectedSatId);
  if (!sat) {
    container.innerHTML = '<div class="empty-state">Satellite not found</div>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'info-grid';

  addRow(grid, 'Name', sat.name);
  addRow(grid, 'NORAD ID', sat.noradId);
  addLinkRow(grid, 'SATCAT', `https://www.satcat.com/sats/${sat.noradId}`, 'View on satcat.com');

  // Metadata fields (from SATCAT if available)
  if (sat.metadata) {
    if (sat.metadata.intlDesignator) addRow(grid, 'Intl Desig.', sat.metadata.intlDesignator);
    if (sat.metadata.objectType) addRow(grid, 'Object Type', sat.metadata.objectType);
    if (sat.metadata.country) addRow(grid, 'Country', sat.metadata.country);
    if (sat.metadata.launchDate) addRow(grid, 'Launch Date', sat.metadata.launchDate);
    if (sat.metadata.site) addRow(grid, 'Launch Site', sat.metadata.site);
  }

  // Orbital elements derived from TLE
  if (sat.satrec) {
    const elems = getOrbitalElements(sat.satrec);

    // Current altitude from live propagation
    const pos = propagateAt(sat.satrec, new Date());
    if (pos) {
      addRow(grid, 'Altitude', `${pos.alt.toFixed(1)} km`, true);
    }

    addRow(grid, 'Inclination', `${elems.inclination.toFixed(4)}°`, true);
    addRow(grid, 'Eccentricity', elems.eccentricity.toFixed(7), true);
    addRow(grid, 'Mean Motion', `${elems.meanMotion.toFixed(4)} rev/day`, true);
    addRow(grid, 'Period', `${elems.periodMinutes.toFixed(1)} min`, true);
    addRow(grid, 'RAAN', `${elems.raan.toFixed(4)}°`, true);
    addRow(grid, 'Arg. Perigee', `${elems.argPerigee.toFixed(4)}°`, true);
    addRow(grid, 'Epoch', elems.epoch.toISOString().replace('T', ' ').slice(0, 19) + ' UTC', true);

    // Source label
    if (sat.metadata && sat.metadata.source) {
      addRow(grid, 'Data Source', sat.metadata.source);
    } else {
      addRow(grid, 'Data Source', 'TLE-only (CelesTrak)');
    }
  }

  container.append(grid);

  // Collapsible TLE
  if (sat.tle) {
    const tleSection = document.createElement('div');
    tleSection.className = 'tle-collapsible';

    const toggle = document.createElement('button');
    toggle.className = 'tle-toggle';
    toggle.textContent = '▶ Show TLE Lines';

    const content = document.createElement('div');
    content.className = 'tle-content';
    content.textContent = `${sat.tle.line1}\n${sat.tle.line2}`;

    toggle.addEventListener('click', () => {
      const isOpen = content.classList.toggle('open');
      toggle.textContent = isOpen ? '▼ Hide TLE Lines' : '▶ Show TLE Lines';
    });

    tleSection.append(toggle, content);
    container.append(tleSection);
  }

  // Upcoming passes (next 7 days)
  if (sat.satrec && GROUND_STATIONS.length > 0) {
    const gs = GROUND_STATIONS[0];
    const passSection = document.createElement('div');
    passSection.className = 'pass-section';

    const passToggle = document.createElement('button');
    passToggle.className = 'tle-toggle';
    passToggle.textContent = '▶ Upcoming Passes (7 days)';

    const passContent = document.createElement('div');
    passContent.className = 'pass-content';

    let computed = false;

    passToggle.addEventListener('click', () => {
      const isOpen = passContent.classList.toggle('open');
      passToggle.textContent = isOpen ? '▼ Upcoming Passes (7 days)' : '▶ Upcoming Passes (7 days)';

      if (isOpen && !computed) {
        computed = true;
        passContent.innerHTML = '<div class="pass-loading">Computing passes...</div>';

        // Run in next frame to avoid blocking UI
        requestAnimationFrame(() => {
          const passes = predictPasses(sat.satrec, gs, 7);
          renderPassTable(passContent, passes);
        });
      }
    });

    passSection.append(passToggle, passContent);
    container.append(passSection);
  }
}

function renderPassTable(container, passes) {
  container.innerHTML = '';

  if (passes.length === 0) {
    container.innerHTML = '<div class="empty-state">No passes in the next 7 days</div>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'pass-table';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>AOS (UTC)</th><th>LOS (UTC)</th><th>Dur.</th><th>Max El.</th></tr>';
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const pass of passes) {
    const tr = document.createElement('tr');
    const durSec = (pass.los - pass.aos) / 1000;
    const durMin = Math.floor(durSec / 60);
    const durS = Math.floor(durSec % 60);

    tr.innerHTML = `
      <td>${fmtDateTime(pass.aos)}</td>
      <td>${fmtDateTime(pass.los)}</td>
      <td>${durMin}m ${durS}s</td>
      <td>${pass.maxEl.toFixed(1)}°</td>
    `;
    tbody.append(tr);
  }

  table.append(tbody);
  container.append(table);

  const note = document.createElement('div');
  note.className = 'pass-note';
  note.textContent = `${passes.length} pass${passes.length !== 1 ? 'es' : ''} found`;
  container.append(note);
}

function fmtDateTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function addLinkRow(grid, label, url, text) {
  const labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'value';
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = text;
  valueEl.append(link);

  grid.append(labelEl, valueEl);
}

function addRow(grid, label, value, derived = false) {
  const labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'value' + (derived ? ' derived' : '');
  valueEl.textContent = value;

  grid.append(labelEl, valueEl);
}
