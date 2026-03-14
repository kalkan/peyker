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
