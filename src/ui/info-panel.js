/**
 * Satellite information panel.
 * Displays orbital elements and metadata for the selected satellite.
 */

import { getState, findSatellite } from './state.js';
import { getOrbitalElements } from '../sat/propagate.js';

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
