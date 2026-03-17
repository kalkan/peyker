/**
 * Sidebar DOM construction.
 * Builds the complete sidebar with all sections.
 */

import { PRESETS } from '../sat/presets.js';
import { getState, setState } from './state.js';
import { renderSatList } from './satellite-list.js';
import { renderInfoPanel } from './info-panel.js';
import { renderPassesPanel } from './passes-panel.js';
import { renderOverlapPanel } from './overlap-panel.js';
import {
  renderDateControls,
  renderLiveControls,
  renderExportControls,
  renderGroundStationControls,
} from './controls.js';

// Container references for re-rendering
let satListContainer = null;
let infoContainer = null;
let dateControlsContainer = null;
let liveControlsContainer = null;
let exportControlsContainer = null;
let gsControlsContainer = null;
let passesContainer = null;
let overlapContainer = null;
let statusEl = null;

/**
 * Build the sidebar DOM structure.
 */
export function buildSidebar(sidebar, callbacks) {
  sidebar.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'sidebar-header';
  header.innerHTML = `
    <h1>Satellite Ground Track Planner</h1>
    <div class="subtitle">2D orbit visualization &amp; planning tool</div>
  `;
  sidebar.append(header);

  // Scrollable content
  const content = document.createElement('div');
  content.className = 'sidebar-content';

  // 1. Satellite Input Section
  content.append(createSection('Satellite Input', (body) => {
    const inputGroup = document.createElement('div');
    inputGroup.className = 'input-group';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter NORAD ID...';
    input.id = 'norad-input';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', () => {
      const val = input.value.trim();
      if (val) {
        callbacks.onAddSatellite(parseInt(val, 10));
        input.value = '';
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addBtn.click();
    });

    inputGroup.append(input, addBtn);
    body.append(inputGroup);

    // Quick-add buttons
    const quickGroup = document.createElement('div');
    quickGroup.className = 'quick-add-group';

    for (const preset of PRESETS) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm';
      btn.textContent = preset.name;
      btn.addEventListener('click', () => callbacks.onAddPreset(preset));
      quickGroup.append(btn);
    }

    body.append(quickGroup);

    satListContainer = document.createElement('div');
    body.append(satListContainer);
  }));

  // 2. Date & Track Controls
  content.append(createSection('Date & Track Controls', (body) => {
    dateControlsContainer = document.createElement('div');
    body.append(dateControlsContainer);
  }));

  // 3. Live Mode
  content.append(createSection('Live Mode', (body) => {
    liveControlsContainer = document.createElement('div');
    body.append(liveControlsContainer);
  }));

  // 4. KML Export
  content.append(createSection('KML Export', (body) => {
    exportControlsContainer = document.createElement('div');
    body.append(exportControlsContainer);
  }));

  // 5. Ground Station Controls
  content.append(createSection('Ground Station', (body) => {
    gsControlsContainer = document.createElement('div');
    body.append(gsControlsContainer);
  }));

  // 6. Upcoming Passes
  content.append(createSection('Upcoming Passes', (body) => {
    passesContainer = document.createElement('div');
    body.append(passesContainer);
  }));

  // 7. Pass Overlap Analysis
  content.append(createSection('Pass Overlap Analysis', (body) => {
    overlapContainer = document.createElement('div');
    body.append(overlapContainer);
  }));

  // 8. Satellite Info Panel
  content.append(createSection('Satellite Information', (body) => {
    infoContainer = document.createElement('div');
    body.append(infoContainer);
  }));

  sidebar.append(content);

  // Status bar
  statusEl = document.createElement('div');
  statusEl.className = 'status-bar';
  statusEl.textContent = 'Ready';
  sidebar.append(statusEl);
}

/**
 * Update all sidebar sections.
 */
export function updateSidebar(callbacks) {
  if (satListContainer) renderSatList(satListContainer);
  if (infoContainer) renderInfoPanel(infoContainer);
  if (dateControlsContainer) renderDateControls(dateControlsContainer, callbacks);
  if (liveControlsContainer) renderLiveControls(liveControlsContainer, callbacks);
  if (exportControlsContainer) renderExportControls(exportControlsContainer, callbacks);
  if (gsControlsContainer) renderGroundStationControls(gsControlsContainer, callbacks);
  if (passesContainer) renderPassesPanel(passesContainer);
  if (overlapContainer) renderOverlapPanel(overlapContainer);
}

/**
 * Update just the satellite list and info panel.
 */
export function updateSatListAndInfo() {
  if (satListContainer) renderSatList(satListContainer);
  if (infoContainer) renderInfoPanel(infoContainer);
  if (passesContainer) renderPassesPanel(passesContainer);
  if (overlapContainer) renderOverlapPanel(overlapContainer);
}

/**
 * Set status bar text.
 */
export function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

// --- Helpers ---

function createSection(title, buildBody) {
  const section = document.createElement('div');
  section.className = 'sidebar-section';

  const titleEl = document.createElement('div');
  titleEl.className = 'section-title';
  titleEl.textContent = title;
  section.append(titleEl);

  const body = document.createElement('div');
  buildBody(body);
  section.append(body);

  return section;
}
