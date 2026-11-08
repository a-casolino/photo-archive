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
