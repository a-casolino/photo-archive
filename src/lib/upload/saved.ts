/*
 * Caricamenti lasciati a metà, ricordati dal browser (IndexedDB) per
 * riprenderli senza riscegliere la cartella: i riferimenti a cartelle e
 * file di Chrome/Edge (vedi files.ts), l'import da continuare e l'album
 * delle foto sciolte. Uno per pagina (`scope`): "Carica dal browser" o
 * l'album aperto. Resta solo in questo browser; se qualcosa non va
 * (navigazione privata, spazio negato) semplicemente non si ricorda.
 */

export type SavedUpload = {
  scope: string;
  handles: FileSystemHandle[];
  importId: string | null;
  looseTitle: string;
  /** Nomi delle cartelle o dei file scelti, per il messaggio. */
  names: string[];
  files: number;
  savedAt: number;
};

const DB = "photo-archive-carica";
const STORE = "lasciati";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "scope" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveUpload(rec: SavedUpload): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(rec));
  } catch {
    // non si ricorda: pazienza
  }
}

export async function loadUpload(scope: string): Promise<SavedUpload | null> {
  try {
    const rec = await run<SavedUpload | undefined>("readonly", (s) => s.get(scope) as IDBRequest<SavedUpload | undefined>);
    return rec && Array.isArray(rec.handles) && rec.handles.length > 0 ? rec : null;
  } catch {
    return null;
  }
}

export async function forgetUpload(scope: string): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(scope));
  } catch {
    // niente da fare
  }
}
