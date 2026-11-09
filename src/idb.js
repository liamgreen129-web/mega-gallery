// idb.js — tiny IndexedDB helper shared by page, worker and service worker.
// Every call degrades to a no-op when IndexedDB is unavailable (private mode,
// some file:// contexts), so the app keeps working, just without caching.
//
// Stores:
//   listings  {id: cacheId, root, nodes, needsKey, at}  decrypted folder trees
//   thumbs    {id: nodeHandle, b: ArrayBuffer | none: 1, at}  server thumbnails (type 0)
//   streams   {id: nodeHandle, folder, key, size, name, mime}  what the SW needs to stream a file

const IDB_NAME = 'mega-gallery';
const IDB_VERSION = 1;
let idbPromise = null;

export function idbOpen() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(IDB_NAME, IDB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('listings')) db.createObjectStore('listings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs', { keyPath: 'id' }).createIndex('at', 'at');
      if (!db.objectStoreNames.contains('streams')) db.createObjectStore('streams', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return idbPromise;
}

function idbRun(store, mode, fn) {
  return idbOpen().then((db) => new Promise((resolve) => {
    if (!db) return resolve(undefined);
    let result;
    try {
      const tx = db.transaction(store, mode);
      result = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(typeof result === 'function' ? result() : result);
      tx.onerror = tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  }));
}

export function idbGet(store, key) {
  return idbRun(store, 'readonly', (s) => {
    const r = s.get(key);
    return () => r.result;
  });
}

export function idbGetMany(store, keys) {
  return idbRun(store, 'readonly', (s) => {
    const reqs = keys.map((k) => s.get(k));
    return () => reqs.map((r) => r.result);
  }).then((v) => v || keys.map(() => undefined));
}

export function idbPut(store, value) {
  return idbRun(store, 'readwrite', (s) => { s.put(value); });
}

export function idbPutMany(store, values) {
  return idbRun(store, 'readwrite', (s) => { for (const v of values) s.put(v); });
}

export function idbDelete(store, key) {
  return idbRun(store, 'readwrite', (s) => { s.delete(key); });
}

export function idbClear(store) {
  return idbRun(store, 'readwrite', (s) => { s.clear(); });
}

export function idbCount(store) {
  return idbRun(store, 'readonly', (s) => {
    const r = s.count();
    return () => r.result || 0;
  }).then((v) => v || 0);
}

/** Keep the thumbnail cache bounded: drop the oldest entries beyond `max`. */
export async function idbTrimThumbs(max) {
  const n = await idbCount('thumbs');
  if (n <= max) return 0;
  let toDrop = n - Math.floor(max * 0.85);
  const dropped = toDrop;
  await idbRun('thumbs', 'readwrite', (s) => {
    const cur = s.index('at').openKeyCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c || toDrop <= 0) return;
      s.delete(c.primaryKey);
      toDrop--;
      c.continue();
    };
  });
  return dropped;
}
