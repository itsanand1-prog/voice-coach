// On-device storage (IndexedDB): progress state and per-session metric records. Never audio.

let dbName = 'voice-coach';

/** Switch database (demo mode keeps its own, so test runs never touch real progress). */
export function useDatabase(name) {
  dbName = name;
}
const DB_VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('sessions', { keyPath: 'startedAt' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(storeName, mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const loadState = () => run('kv', 'readonly', (s) => s.get('state'));
export const saveState = (state) => run('kv', 'readwrite', (s) => s.put(state, 'state'));
export const addSession = (record) => run('sessions', 'readwrite', (s) => s.put(record));
export const allSessions = () => run('sessions', 'readonly', (s) => s.getAll());
