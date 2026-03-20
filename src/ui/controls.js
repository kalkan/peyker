/**
 * Date/time controls, propagation settings, and action buttons.
 */

import { getState, setState } from './state.js';

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

  // Active GS selector
  if (state.groundStations.length > 0) {
    const selectRow = document.createElement('div');
    selectRow.className = 'control-row';
    const selectLabel = document.createElement('label');
    selectLabel.textContent = 'Active GS';
    const select = document.createElement('select');
    select.style.cssText = 'background:#161b22;color:var(--text-primary);border:1px solid var(--border-glass);border-radius:var(--radius-xs);padding:4px 8px;font-size:12px;outline:none;flex:1;';
    for (let i = 0; i < state.groundStations.length; i++) {
      const gs = state.groundStations[i];
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${gs.name} (${gs.lat.toFixed(2)}°, ${gs.lon.toFixed(2)}°)`;
      if (i === (state.activeGsIndex || 0)) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener('change', () => {
      setState({ activeGsIndex: parseInt(select.value, 10) });
      if (callbacks.onGsChanged) callbacks.onGsChanged();
    });
    selectRow.append(selectLabel, select);
    container.append(selectRow);

    // Remove button for non-default stations
    const activeIdx = state.activeGsIndex || 0;
    if (activeIdx > 0) {
      const removeBtn = createButton('Remove Station', 'btn btn-danger btn-sm', () => {
        const gs = [...state.groundStations];
        gs.splice(activeIdx, 1);
        setState({ groundStations: gs, activeGsIndex: 0 });
        if (callbacks.onGsChanged) callbacks.onGsChanged();
        renderGroundStationControls(container, callbacks);
      });
      removeBtn.style.marginBottom = '8px';
      container.append(removeBtn);
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
