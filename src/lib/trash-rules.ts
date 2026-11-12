/*
 * Regole del cestino senza database né archivio, così si possono testare.
 */

export type PurgeRow = {
  id: number;
  original_key: string;
  preview_key: string | null;
  thumb_key: string | null;
};

/**
 * Tutti i file di una foto nell'archivio: originale (CR2 in classe Archive),
 * anteprima, miniatura e miniature dei volti. Senza vuoti né doppioni.
 */
export function storageKeysOf(row: PurgeRow, faceKeys: (string | null)[] = []): string[] {
  const keys = [row.original_key, row.preview_key, row.thumb_key, ...faceKeys];
  return [...new Set(keys.filter((k): k is string => typeof k === "string" && k.length > 0))];
}

/**
 * Esegue `fn` su ogni elemento con al massimo `limit` chiamate insieme.
 * Restituisce gli elementi per cui `fn` è fallita, con l'errore.
 */
export async function runLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<{ item: T; error: unknown }[]> {
  const failed: { item: T; error: unknown }[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (error) {
        failed.push({ item, error });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return failed;
}

/** Messaggio dopo un'eliminazione definitiva. */
export function purgeMessage(deleted: number, failed: number): string {
  const ok = deleted === 0 ? "Nessuna foto eliminata." : `${deleted} foto eliminat${deleted === 1 ? "a" : "e"} definitivamente.`;
  if (!failed) return ok;
  return `${ok} ${failed} non eliminat${failed === 1 ? "a" : "e"}: l'archivio non ha risposto, restano nel cestino e puoi riprovare.`;
}

/*
 * "Annulla" dopo uno spostamento nel cestino: un cookie breve (solo server)
 * ricorda cosa è appena finito nel cestino. Foto per id numerico (più corto
 * del public_id, così ne stanno anche 200 di una pagina), album per public_id.
 */
export const UNDO_COOKIE = "annulla_cestino";
/** Minuti per cui "Annulla" resta disponibile. */
export const UNDO_MINUTES = 10;
const UNDO_MAX_BYTES = 3500;

export type UndoTrash = { kind: "photos"; ids: number[] } | { kind: "albums"; publicIds: string[] };

/** Valore del cookie, o null se non ci sta (allora resta solo il Cestino). */
export function encodeUndo(u: UndoTrash): string | null {
  const list = u.kind === "photos" ? u.ids.map(String) : u.publicIds;
  if (!list.length) return null;
  const value = `${u.kind === "photos" ? "f" : "a"}:${list.join(".")}`;
  return value.length <= UNDO_MAX_BYTES ? value : null;
}

/** Legge il cookie; null se manca o non è valido. */
export function decodeUndo(value: string | undefined | null): UndoTrash | null {
  const m = /^([fa]):([0-9A-Za-z.]+)$/.exec(value ?? "");
  if (!m) return null;
  const parts = m[2].split(".").filter(Boolean);
  if (m[1] === "f") {
    if (!parts.every((p) => /^[1-9]\d{0,18}$/.test(p))) return null;
    const ids = [...new Set(parts.map(Number))].filter(Number.isSafeInteger);
    return ids.length ? { kind: "photos", ids } : null;
  }
  if (!parts.every((p) => /^[0-9A-Za-z]{22}$/.test(p))) return null;
  return { kind: "albums", publicIds: [...new Set(parts)] };
}

/**
 * Tra gli album scelti tiene solo quelli che non stanno dentro un altro
 * album scelto: eliminando il padre se ne vanno anche i sotto-album.
 */
export function topmostSelected(selected: number[], parentOf: (id: number) => number | null | undefined): number[] {
  const set = new Set(selected);
  return [...set].filter((id) => {
    const seen = new Set<number>();
    for (let cur = parentOf(id); cur != null && !seen.has(cur); cur = parentOf(cur)) {
      if (set.has(cur)) return false;
      seen.add(cur);
    }
    return true;
  });
}
