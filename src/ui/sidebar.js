/**
 * Sidebar DOM construction.
 * Builds the complete sidebar with all sections.
 */

import { PRESETS } from '../sat/presets.js';
import { getState, setState } from './state.js';
import { renderSatList } from './satellite-list.js';
import { renderInfoPanel } from './info-panel.js';
import {
  renderDateControls,
  renderLiveControls,
  renderSwathControls,
  renderExportControls,
} from './controls.js';

// Container references for re-rendering
let satListContainer = null;
let infoContainer = null;
let dateControlsContainer = null;
let liveControlsContainer = null;
let swathControlsContainer = null;
let exportControlsContainer = null;
let statusEl = null;

/**
 * Build the sidebar DOM structure.
 *
 * @param {HTMLElement} sidebar - the sidebar element
 * @param {Object} callbacks - event callbacks from main
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
    // Input row
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

    // Satellite list container
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

  // 4. Coverage / Swath
  content.append(createSection('Coverage / Swath', (body) => {
    swathControlsContainer = document.createElement('div');
    body.append(swathControlsContainer);
  }));

  // 5. KML Export
  content.append(createSection('KML Export', (body) => {
    exportControlsContainer = document.createElement('div');
    body.append(exportControlsContainer);
  }));

  // 6. Satellite Info Panel
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

  return {
    satListContainer,
    infoContainer,
    dateControlsContainer,
    liveControlsContainer,
    swathControlsContainer,
    exportControlsContainer,
  };
}

/**
 * Update all sidebar sections.
 */
export function updateSidebar(callbacks) {
  if (satListContainer) renderSatList(satListContainer);
  if (infoContainer) renderInfoPanel(infoContainer);
  if (dateControlsContainer) renderDateControls(dateControlsContainer, callbacks);
  if (liveControlsContainer) renderLiveControls(liveControlsContainer, callbacks);
  if (swathControlsContainer) renderSwathControls(swathControlsContainer, callbacks);
  if (exportControlsContainer) renderExportControls(exportControlsContainer, callbacks);
}

/**
 * Update just the satellite list and info panel.
 */
export function updateSatListAndInfo() {
  if (satListContainer) renderSatList(satListContainer);
  if (infoContainer) renderInfoPanel(infoContainer);
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
