/**
 * Minimal IndexedDB key/value store used by the Pass Tracker to cache
 * computed pass lists. Separate store from localStorage so we don't hit
 * the ~5 MB quota when caching 30-day multi-satellite pass sets.
 *
 * All operations are async and degrade gracefully: if the browser
 * doesn't expose IndexedDB (old / private-mode contexts) all `get`
 * calls resolve to `null` and `set` is a no-op.
 */

const DB_NAME = 'peyker-pass-cache';
const DB_VERSION = 1;
const STORE = 'kv';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { console.warn('IDB open failed:', req.error); resolve(null); };
    req.onblocked = () => resolve(null);
  });
  return _dbPromise;
}

export async function idbGet(key) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function idbSet(key, value) {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

export async function idbDelete(key) {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

/**
 * Iterate over all keys and evict entries whose value.expiresAt is in the
 * past. Cheap house-keeping hook called on startup.
 */
export async function idbCleanupExpired() {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const now = Date.now();
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        const v = c.value;
        if (v && typeof v.expiresAt === 'number' && v.expiresAt < now) c.delete();
        c.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}
