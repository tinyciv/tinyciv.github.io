const DATABASE = 'tinyciv-games';
const STORE = 'saves';
const SLOT = 'single-player';
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error ?? new Error('Unable to open game storage.'));
    request.onblocked = () => reject(new Error('Game storage is busy in another tab.'));
    request.onsuccess = () => {
      const connection = request.result;
      connection.onversionchange = () => { connection.close(); database = undefined; };
      resolve(connection);
    };
  }).catch(error => { database = undefined; throw error; });
}

/** Large terrain saves exceed localStorage's roughly five-megabyte quota.
 * IndexedDB retains the same lossless serialized data without that limit. */
export async function readStoredGame(): Promise<string | undefined> {
  const connection = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(SLOT);
    transaction.oncomplete = () => resolve(typeof request.result === 'string' ? request.result : undefined);
    transaction.onabort = () => reject(transaction.error ?? new Error('Unable to read saved game.'));
    transaction.onerror = () => { /* onabort reports the complete transaction failure. */ };
  });
}

/** Read/write transactions on the same store commit in invocation order.
 * Report success only after commit, preserving the previous save on failure. */
export async function writeStoredGame(serialized: string): Promise<void> {
  const connection = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(serialized, SLOT);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Unable to save this game.'));
    transaction.onerror = () => { /* onabort reports the complete transaction failure. */ };
  });
}
