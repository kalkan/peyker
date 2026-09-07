/**
 * Satellite list UI component.
 * Renders the list of added satellites with controls.
 */

import { getState, setState, updateSatellite } from './state.js';
import { removeSatFromMap, clearSatLayers } from '../map/layers.js';
import { removeLiveMarker, centerOnSat, updateLiveMarker } from '../map/markers.js';
import { propagateAt } from '../sat/propagate.js';
import { describeTleAge } from '../sat/tle-meta.js';

/**
 * Render the satellite list into the given container element.
 */
export function renderSatList(container) {
  const state = getState();
  container.innerHTML = '';

  if (state.satellites.length === 0) {
    container.innerHTML = '<div class="empty-state">No satellites added yet</div>';
    return;
  }

  const list = document.createElement('div');
  list.className = 'sat-list';

  for (const sat of state.satellites) {
    const item = document.createElement('div');
    item.className = 'sat-item' + (state.selectedSatId === sat.noradId ? ' selected' : '');

    // Color chip
    const chip = document.createElement('div');
    chip.className = 'sat-color-chip';
    chip.style.background = sat.color;

    // Visibility checkbox
    const vis = document.createElement('input');
    vis.type = 'checkbox';
    vis.className = 'sat-checkbox';
    vis.checked = sat.visible;
    vis.title = 'Toggle visibility';
    vis.addEventListener('change', () => {
      updateSatellite(sat.noradId, { visible: vis.checked });
      if (!vis.checked) {
        clearSatLayers(sat.noradId);
      }
    });

    // Name
    const nameEl = document.createElement('div');
    nameEl.className = 'sat-name';
    nameEl.innerHTML = `${escapeHtml(sat.name)} <small>#${sat.noradId}</small>`;
    nameEl.title = `Select ${sat.name}`;
    nameEl.addEventListener('click', () => {
      setState({ selectedSatId: sat.noradId });
    });

    // TLE age badge
    if (sat.satrec) {
      try {
        const age = describeTleAge(sat.satrec);
        if (age) {
          const badge = document.createElement('span');
          badge.className = `tle-age-badge ${age.level}`;
          badge.textContent = age.label;
          badge.title = `TLE yaşı: ${age.ageDays.toFixed(1)} gün`;
          nameEl.append(' ', badge);
        }
      } catch { /* skip */ }
    }

    // Actions
    const actions = document.createElement('div');
    actions.className = 'sat-actions';

    // Center button
    const centerBtn = document.createElement('button');
    centerBtn.textContent = '⊕';
    centerBtn.title = 'Center on track';
    centerBtn.addEventListener('click', () => {
      if (sat.satrec) {
        const pos = propagateAt(sat.satrec, new Date());
        if (pos) centerOnSat(pos.lat, pos.lon);
      }
    });

    // Live toggle — capture current state before toggling
    const liveBtn = document.createElement('button');
    liveBtn.textContent = sat.showLive ? '◉' : '◎';
    liveBtn.title = sat.showLive ? 'Hide live position' : 'Show live position';
    liveBtn.style.color = sat.showLive ? '#3fb950' : '';
    liveBtn.addEventListener('click', () => {
      const wasLive = sat.showLive;
      updateSatellite(sat.noradId, { showLive: !wasLive });

      if (wasLive) {
        // Was showing, now hiding — remove marker
        removeLiveMarker(sat.noradId);
      } else {
        // Was hidden, now showing — immediately show current position
        if (sat.satrec) {
          try {
            const now = new Date();
            const pos = propagateAt(sat.satrec, now);
            if (pos) {
              updateLiveMarker(sat.noradId, sat.name, pos.lat, pos.lon, pos.alt, sat.color, now);
            }
          } catch { /* skip */ }
        }
      }
    });

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove satellite';
    removeBtn.addEventListener('click', () => {
      removeSatFromMap(sat.noradId);
      const sats = getState().satellites.filter(s => s.noradId !== sat.noradId);
      const selected = getState().selectedSatId === sat.noradId ? null : getState().selectedSatId;
      setState({ satellites: sats, selectedSatId: selected });
    });

    actions.append(centerBtn, liveBtn, removeBtn);
    item.append(chip, vis, nameEl, actions);
    list.append(item);
  }

  container.append(list);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
