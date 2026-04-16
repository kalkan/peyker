/**
 * Lightweight global keyboard shortcut manager + help overlay.
 *
 * Each binding is { key, alt?, ctrl?, shift?, label, run }.
 *  - `key` matches `event.key` (case-insensitive for letters)
 *  - `run(event)` executes the action; return `true` to keep the event flowing
 *  - When `?` is pressed (or the `_help` binding fires) we render a modal
 *    listing all bindings.
 *
 * Bindings are ignored while the user is typing into an input/textarea or
 * a contentEditable element so shortcuts don't hijack form input.
 */

let installed = false;
let helpEl = null;
const bindings = [];

function isTypingTarget(t) {
  if (!t) return false;
  const tag = (t.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (t.isContentEditable) return true;
  return false;
}

function matches(b, e) {
  if (b.key.toLowerCase() !== e.key.toLowerCase()) return false;
  if (!!b.alt !== e.altKey) return false;
  if (!!b.ctrl !== (e.ctrlKey || e.metaKey)) return false;
  if (!!b.shift !== e.shiftKey) return false;
  return true;
}

function handle(e) {
  if (isTypingTarget(e.target)) return;
  if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
    e.preventDefault();
    toggleHelp();
    return;
  }
  if (e.key === 'Escape' && helpEl && helpEl.classList.contains('open')) {
    closeHelp();
    return;
  }
  for (const b of bindings) {
    if (matches(b, e)) {
      const keep = b.run(e);
      if (!keep) e.preventDefault();
      return;
    }
  }
}

/**
 * Install the global key listener. Call once at app start.
 */
export function installKeyboardShortcuts(initial = []) {
  if (!installed) {
    window.addEventListener('keydown', handle, { capture: false });
    installed = true;
  }
  for (const b of initial) bindings.push(b);
}

/**
 * Add or replace a binding by key+modifiers.
 */
export function bind(b) {
  // De-duplicate by signature
  const sig = `${b.key}|${!!b.alt}|${!!b.ctrl}|${!!b.shift}`;
  for (let i = bindings.length - 1; i >= 0; i--) {
    const x = bindings[i];
    if (`${x.key}|${!!x.alt}|${!!x.ctrl}|${!!x.shift}` === sig) bindings.splice(i, 1);
  }
  bindings.push(b);
}

export function unbind(key, mods = {}) {
  const sig = `${key}|${!!mods.alt}|${!!mods.ctrl}|${!!mods.shift}`;
  for (let i = bindings.length - 1; i >= 0; i--) {
    const x = bindings[i];
    if (`${x.key}|${!!x.alt}|${!!x.ctrl}|${!!x.shift}` === sig) bindings.splice(i, 1);
  }
}

function buildHelp() {
  const wrap = document.createElement('div');
  wrap.className = 'kb-shortcuts-overlay';
  wrap.innerHTML = `
    <div class="kb-shortcuts-box" role="dialog" aria-label="Klavye Kısayolları">
      <div class="kb-shortcuts-head">
        <h3>Klavye Kısayolları</h3>
        <button class="kb-shortcuts-close" aria-label="Kapat">&times;</button>
      </div>
      <div class="kb-shortcuts-body"></div>
      <div class="kb-shortcuts-foot">Esc / ? ile kapat</div>
    </div>
  `;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeHelp(); });
  wrap.querySelector('.kb-shortcuts-close').addEventListener('click', closeHelp);
  document.body.append(wrap);
  return wrap;
}

function renderBindings() {
  const body = helpEl.querySelector('.kb-shortcuts-body');
  body.innerHTML = '';
  const visible = bindings.filter(b => b.label);
  for (const b of visible) {
    const row = document.createElement('div');
    row.className = 'kb-shortcuts-row';
    const keys = [];
    if (b.ctrl) keys.push('Ctrl');
    if (b.alt) keys.push('Alt');
    if (b.shift) keys.push('Shift');
    keys.push(b.key.length === 1 ? b.key.toUpperCase() : b.key);
    row.innerHTML = `<div class="kb-keys">${keys.map(k => `<kbd>${k}</kbd>`).join('+')}</div>` +
      `<div class="kb-label">${b.label}</div>`;
    body.append(row);
  }
  if (!visible.length) body.innerHTML = '<div class="kb-empty">Hiç kısayol tanımlı değil.</div>';
}

export function toggleHelp() {
  if (!helpEl) helpEl = buildHelp();
  if (helpEl.classList.contains('open')) closeHelp();
  else openHelp();
}

export function openHelp() {
  if (!helpEl) helpEl = buildHelp();
  renderBindings();
  helpEl.classList.add('open');
}

export function closeHelp() {
  if (helpEl) helpEl.classList.remove('open');
}
