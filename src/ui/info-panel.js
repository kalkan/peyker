/**
 * Satellite information panel.
 * Displays orbital elements and metadata for the selected satellite.
 */

import { getState, findSatellite } from './state.js';
import { getOrbitalElements, propagateAt } from '../sat/propagate.js';

let refreshTleCallback = null;

/**
 * Set the callback for refreshing TLE data.
 */
export function setRefreshTleCallback(cb) {
  refreshTleCallback = cb;
}

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

    // TLE age indicator
    const ageMs = Date.now() - elems.epoch.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const ageLabel = ageDays < 1 ? `${Math.round(ageDays * 24)}h ago` : `${ageDays.toFixed(1)} days ago`;
    const isStale = ageDays > 7;

    const ageLabelEl = document.createElement('span');
    ageLabelEl.className = 'label';
    ageLabelEl.textContent = 'TLE Age';

    const ageValueEl = document.createElement('span');
    ageValueEl.className = 'value derived';
    ageValueEl.innerHTML = `<span class="tle-age ${isStale ? 'tle-stale' : 'tle-fresh'}">${ageLabel}</span>`;
    if (isStale) {
      ageValueEl.innerHTML += ' <span class="tle-stale-warn">stale!</span>';
    }
    grid.append(ageLabelEl, ageValueEl);

    // Source label
    const tleSource = sat.tle && sat.tle.source ? sat.tle.source : 'CelesTrak';
    if (sat.metadata && sat.metadata.source) {
      addRow(grid, 'Data Source', `${sat.metadata.source} / TLE: ${tleSource}`);
    } else {
      addRow(grid, 'Data Source', `TLE: ${tleSource}`);
    }
  }

  container.append(grid);

  // Refresh TLE button
  if (sat.satrec && refreshTleCallback) {
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn btn-sm tle-refresh-btn';
    refreshBtn.textContent = 'Refresh TLE';
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Refreshing...';
      try {
        await refreshTleCallback(sat.noradId);
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh TLE';
      }
    });
    container.append(refreshBtn);
  }

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
