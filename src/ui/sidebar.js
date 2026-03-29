/**
 * Sidebar DOM construction.
 * Builds the complete sidebar with all sections.
 */

import { PRESETS } from '../sat/presets.js';
import { searchSatellitesByName } from '../sat/fetch.js';
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
let dropdownCloseHandler = null;

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
    inputGroup.style.position = 'relative';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'NORAD ID or satellite name...';
    input.id = 'norad-input';
    input.autocomplete = 'off';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', () => {
      const val = input.value.trim();
      if (val) {
        const numVal = parseInt(val, 10);
        if (!isNaN(numVal) && String(numVal) === val) {
          callbacks.onAddSatellite(numVal);
        } else {
          // Treat as name — trigger search
          triggerSearch(val);
        }
        input.value = '';
        hideDropdown();
      }
    });

    // Search results dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'sat-search-dropdown';
    dropdown.style.display = 'none';

    let searchTimeout = null;

    function hideDropdown() {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
    }

    async function triggerSearch(query) {
      if (query.length < 2) { hideDropdown(); return; }
      dropdown.innerHTML = '<div class="sat-search-item loading">Searching...</div>';
      dropdown.style.display = 'block';
      const results = await searchSatellitesByName(query);
      dropdown.innerHTML = '';
      if (results.length === 0) {
        dropdown.innerHTML = '<div class="sat-search-item loading">No results</div>';
        setTimeout(hideDropdown, 2000);
        return;
      }
      for (const r of results.slice(0, 15)) {
        const item = document.createElement('div');
        item.className = 'sat-search-item';
        item.innerHTML = `<span class="sat-search-name">${r.name}</span><span class="sat-search-id">#${r.noradId}</span>`;
        item.addEventListener('click', () => {
          callbacks.onAddSatellite(r.noradId, r.name);
          input.value = '';
          hideDropdown();
        });
        dropdown.append(item);
      }
    }

    input.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      const val = input.value.trim();
      // Only search if it's not a pure number
      if (val && isNaN(parseInt(val, 10))) {
        searchTimeout = setTimeout(() => triggerSearch(val), 400);
      } else {
        hideDropdown();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addBtn.click();
      if (e.key === 'Escape') hideDropdown();
    });

    // Close dropdown when clicking outside (remove old handler first)
    if (dropdownCloseHandler) document.removeEventListener('click', dropdownCloseHandler);
    dropdownCloseHandler = (e) => {
      if (!inputGroup.contains(e.target)) hideDropdown();
    };
    document.addEventListener('click', dropdownCloseHandler);

    inputGroup.append(input, addBtn, dropdown);
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
}

/**
 * Build the right panel DOM structure (passes & overlap analysis).
 */
export function buildRightPanel(panel) {
  panel.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'sidebar-header';
  header.innerHTML = `
    <div class="right-panel-header-row">
      <h1>Pass Analysis</h1>
      <div class="right-panel-header-links">
        <a href="./antenna.html" target="_blank" class="mobile-link" title="Anten Takip 3B">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>
          </svg>
          Anten
        </a>
        <a href="./mobile.html" target="_blank" class="mobile-link" title="Mobil görünüm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12" y2="18"/>
          </svg>
          Mobil
        </a>
      </div>
    </div>
    <div class="subtitle">Ground station visibility &amp; overlap</div>
  `;
  panel.append(header);

  // Scrollable content
  const content = document.createElement('div');
  content.className = 'sidebar-content';

  // 1. Upcoming Passes
  content.append(createSection('Upcoming Passes', (body) => {
    passesContainer = document.createElement('div');
    body.append(passesContainer);
  }));

  // 2. Pass Overlap Analysis
  content.append(createSection('Pass Overlap Analysis', (body) => {
    overlapContainer = document.createElement('div');
    body.append(overlapContainer);
  }));

  panel.append(content);
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
