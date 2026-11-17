const DATABASE = 'tinyciv-games';
const STORE = 'saves';
const CATALOG = 'catalog';
export const AUTOSAVE_ID = 'single-player';
export interface StoredGameSummary {
  id: string;
  name: string;
  savedAt: number;
  time: number;
  seed: string;
  civilization: string;
}
export type StoredGameDetails = Omit<StoredGameSummary, 'id'>;
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      const connection = request.result;
      if (!connection.objectStoreNames.contains(STORE)) connection.createObjectStore(STORE);
      if (!connection.objectStoreNames.contains(CATALOG)) connection.createObjectStore(CATALOG, { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to open game storage.'));
    request.onblocked = () => { blocked = true; reject(new Error('Game storage is busy in another tab.')); };
    request.onsuccess = () => {
      const connection = request.result;
      if (blocked) { connection.close(); return; }
      connection.onversionchange = () => { connection.close(); database = undefined; };
      resolve(connection);
    };
  }).catch(error => { database = undefined; throw error; });
}

/** Large terrain saves exceed localStorage's roughly five-megabyte quota.
 * IndexedDB retains the same lossless serialized data without that limit. */
export async function readStoredGame(id = AUTOSAVE_ID): Promise<string | undefined> {
  const connection = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(id);
    transaction.oncomplete = () => resolve(typeof request.result === 'string' ? request.result : undefined);
    transaction.onabort = () => reject(transaction.error ?? new Error('Unable to read saved game.'));
    transaction.onerror = () => { /* onabort reports the complete transaction failure. */ };
  });
}

/** Read/write transactions on the same store commit in invocation order.
 * Report success only after commit, preserving the previous save on failure. */
export async function writeStoredGame(serialized: string, details: StoredGameDetails, id = AUTOSAVE_ID): Promise<void> {
  const connection = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction([STORE, CATALOG], 'readwrite');
    transaction.objectStore(STORE).put(serialized, id);
    transaction.objectStore(CATALOG).put({ ...details, id } satisfies StoredGameSummary);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Unable to save this game.'));
    transaction.onerror = () => { /* onabort reports the complete transaction failure. */ };
  });
}

/** Browsing saves reads only small summaries, never every world's terrain. */
export async function listStoredGames(): Promise<StoredGameSummary[]> {
  const connection = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction(CATALOG, 'readonly');
    const request = transaction.objectStore(CATALOG).getAll();
    transaction.oncomplete = () => resolve((request.result as StoredGameSummary[])
      .sort((a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id)));
    transaction.onabort = () => reject(transaction.error ?? new Error('Unable to list saved games.'));
    transaction.onerror = () => { /* onabort reports the complete transaction failure. */ };
  });
}
