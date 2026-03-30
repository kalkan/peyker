/**
 * Date/time controls, propagation settings, and action buttons.
 */

import { getState, setState } from './state.js';
import { DEFAULT_GROUND_STATIONS } from '../sat/presets.js';

/**
 * Render the date/track controls section.
 */
export function renderDateControls(container, callbacks) {
  const state = getState();
  container.innerHTML = '';

  // Date picker
  const dateRow = createControlRow('Date', 'date', state.selectedDate, (val) => {
    setState({ selectedDate: val });
  });
  container.append(dateRow);

  // Time picker
  const timeRow = createControlRow('Time (UTC)', 'time', state.selectedTime, (val) => {
    setState({ selectedTime: val });
  });
  container.append(timeRow);

  // Propagation step
  const stepRow = document.createElement('div');
  stepRow.className = 'control-row';
  const stepLabel = document.createElement('label');
  stepLabel.textContent = 'Step (sec)';
  const stepInput = document.createElement('input');
  stepInput.type = 'number';
  stepInput.min = '1';
  stepInput.max = '3600';
  stepInput.value = state.propagationStep;
  stepInput.addEventListener('change', () => {
    const val = parseInt(stepInput.value, 10);
    if (val > 0) setState({ propagationStep: val });
  });
  stepRow.append(stepLabel, stepInput);
  container.append(stepRow);

  // Duration hours
  const durRow = document.createElement('div');
  durRow.className = 'control-row';
  const durLabel = document.createElement('label');
  durLabel.textContent = 'Hours';
  const durInput = document.createElement('input');
  durInput.type = 'number';
  durInput.min = '1';
  durInput.max = '168';
  durInput.value = state.trackDuration;
  durInput.addEventListener('change', () => {
    const val = parseInt(durInput.value, 10);
    if (val > 0) setState({ trackDuration: val });
  });
  durRow.append(durLabel, durInput);
  container.append(durRow);

  // Action buttons
  const btnGroup = document.createElement('div');
  btnGroup.className = 'btn-group';
  btnGroup.style.marginTop = '8px';

  const showTrackBtn = createButton('Show Track', 'btn btn-primary btn-sm', callbacks.onShowTrack);
  const showTodayBtn = createButton('Show Today', 'btn btn-sm', callbacks.onShowToday);
  const clearBtn = createButton('Clear Tracks', 'btn btn-danger btn-sm', callbacks.onClearTracks);

  btnGroup.append(showTrackBtn, showTodayBtn, clearBtn);
  container.append(btnGroup);
}

/**
 * Render live mode controls.
 */
export function renderLiveControls(container, callbacks) {
  const state = getState();
  container.innerHTML = '';

  // Live toggle
  const liveToggle = createToggleRow('Show live positions', state.liveEnabled, (checked) => {
    setState({ liveEnabled: checked });
    callbacks.onLiveToggle(checked);
  });
  container.append(liveToggle);

  // Auto-refresh interval
  const refreshRow = document.createElement('div');
  refreshRow.className = 'control-row';
  const refreshLabel = document.createElement('label');
  refreshLabel.textContent = 'Refresh (sec)';
  const refreshInput = document.createElement('input');
  refreshInput.type = 'number';
  refreshInput.min = '1';
  refreshInput.max = '60';
  refreshInput.value = state.liveInterval;
  refreshInput.addEventListener('change', () => {
    const val = parseInt(refreshInput.value, 10);
    if (val > 0) {
      setState({ liveInterval: val });
      callbacks.onLiveIntervalChange(val);
    }
  });
  refreshRow.append(refreshLabel, refreshInput);
  container.append(refreshRow);

  // Timestamp display
  const tsDiv = document.createElement('div');
  tsDiv.id = 'live-timestamp';
  tsDiv.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-top: 4px; font-family: var(--font-mono);';
  container.append(tsDiv);
}

/**
 * Render KML export controls.
 */
export function renderExportControls(container, callbacks) {
  container.innerHTML = '';

  const btnGroup = document.createElement('div');
  btnGroup.className = 'btn-group';

  const exportSelectedBtn = createButton('Export Selected', 'btn btn-sm', callbacks.onExportSelected);
  const exportAllBtn = createButton('Export All Visible', 'btn btn-primary btn-sm', callbacks.onExportAll);

  btnGroup.append(exportSelectedBtn, exportAllBtn);
  container.append(btnGroup);
}

/**
 * Render ground station controls (list, add, coverage toggle).
 */
export function renderGroundStationControls(container, callbacks) {
  const state = getState();
  container.innerHTML = '';

  // Ground station list — click to select, click X to remove
  if (state.groundStations.length > 0) {
    const list = document.createElement('div');
    list.className = 'gs-list';

    for (let i = 0; i < state.groundStations.length; i++) {
      const gs = state.groundStations[i];
      const isActive = i === (state.activeGsIndex || 0);
      const isDefault = i === 0 && DEFAULT_GROUND_STATIONS.some(
        d => d.name === gs.name && d.lat === gs.lat && d.lon === gs.lon
      );

      const item = document.createElement('div');
      item.className = 'gs-item' + (isActive ? ' active' : '');
      item.title = isDefault ? gs.name : `Click to select, ✕ to remove`;

      const info = document.createElement('span');
      info.className = 'gs-item-info';
      info.textContent = `${gs.name} (${gs.lat.toFixed(2)}°, ${gs.lon.toFixed(2)}°)`;
      info.addEventListener('click', () => {
        setState({ activeGsIndex: i });
        if (callbacks.onGsChanged) callbacks.onGsChanged();
        renderGroundStationControls(container, callbacks);
      });
      item.append(info);

      // Remove button for non-default stations
      if (!isDefault) {
        const removeX = document.createElement('span');
        removeX.className = 'gs-item-remove';
        removeX.textContent = '✕';
        removeX.title = 'Remove station';
        removeX.addEventListener('click', (e) => {
          e.stopPropagation();
          const gsList = [...state.groundStations];
          gsList.splice(i, 1);
          const newIdx = state.activeGsIndex >= i ? Math.max(0, (state.activeGsIndex || 0) - 1) : (state.activeGsIndex || 0);
          setState({ groundStations: gsList, activeGsIndex: newIdx });
          if (callbacks.onGsChanged) callbacks.onGsChanged();
          renderGroundStationControls(container, callbacks);
        });
        item.append(removeX);
      }

      list.append(item);
    }
    container.append(list);

    // Reset button — only show if there are non-default stations
    const hasCustom = state.groundStations.length > DEFAULT_GROUND_STATIONS.length;
    if (hasCustom) {
      const resetBtn = createButton('Clear Added Stations', 'btn btn-danger btn-sm', () => {
        setState({ groundStations: [...DEFAULT_GROUND_STATIONS], activeGsIndex: 0 });
        if (callbacks.onGsChanged) callbacks.onGsChanged();
        renderGroundStationControls(container, callbacks);
      });
      resetBtn.style.marginTop = '6px';
      container.append(resetBtn);
    }
  }

  // Add new GS form
  const addSection = document.createElement('div');
  addSection.style.cssText = 'margin-top:8px;';

  const addToggle = document.createElement('button');
  addToggle.className = 'btn btn-sm';
  addToggle.textContent = '+ Add Station';
  addToggle.style.marginBottom = '6px';
  addToggle.addEventListener('click', () => {
    addForm.style.display = addForm.style.display === 'none' ? 'block' : 'none';
  });
  addSection.append(addToggle);

  const addForm = document.createElement('div');
  addForm.style.display = 'none';

  const nameInput = createSmallInput('Name', 'text', '');
  const latInput = createSmallInput('Lat °', 'number', '');
  const lonInput = createSmallInput('Lon °', 'number', '');
  const altInput = createSmallInput('Alt m', 'number', '0');

  const saveBtn = createButton('Save', 'btn btn-primary btn-sm', () => {
    const name = nameInput.querySelector('input').value.trim();
    const lat = parseFloat(latInput.querySelector('input').value);
    const lon = parseFloat(lonInput.querySelector('input').value);
    const alt = parseInt(altInput.querySelector('input').value, 10) || 0;
    if (!name || isNaN(lat) || isNaN(lon)) return;
    const gs = [...state.groundStations, { name, lat, lon, alt }];
    setState({ groundStations: gs, activeGsIndex: gs.length - 1 });
    if (callbacks.onGsChanged) callbacks.onGsChanged();
    renderGroundStationControls(container, callbacks);
  });

  addForm.append(nameInput, latInput, lonInput, altInput, saveBtn);
  addSection.append(addForm);
  container.append(addSection);

  // Coverage toggle
  const toggle = createToggleRow('Coverage circle (2500 km)', state.coverageVisible, (checked) => {
    setState({ coverageVisible: checked });
    callbacks.onCoverageToggle(checked);
  });
  container.append(toggle);
}

function createSmallInput(labelText, type, defaultValue) {
  const row = document.createElement('div');
  row.className = 'control-row';
  row.style.marginBottom = '4px';
  const label = document.createElement('label');
  label.textContent = labelText;
  label.style.fontSize = '11px';
  label.style.minWidth = '40px';
  const input = document.createElement('input');
  input.type = type;
  input.value = defaultValue;
  input.style.fontSize = '12px';
  if (type === 'number') input.step = 'any';
  row.append(label, input);
  return row;
}

// --- Helpers ---

function createControlRow(labelText, inputType, value, onChange) {
  const row = document.createElement('div');
  row.className = 'control-row';
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = inputType;
  input.value = value;
  input.addEventListener('change', () => onChange(input.value));
  row.append(label, input);
  return row;
}

function createButton(text, className, onClick) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

function createToggleRow(labelText, checked, onChange) {
  const row = document.createElement('div');
  row.className = 'toggle-row';

  const label = document.createElement('label');
  label.textContent = labelText;

  const toggle = document.createElement('label');
  toggle.className = 'toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const slider = document.createElement('span');
  slider.className = 'toggle-slider';
  toggle.append(input, slider);

  row.append(label, toggle);
  return row;
}
