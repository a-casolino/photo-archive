/* Regole pure della verifica di un Takeout (senza database): vedi check.ts. */
import { zipEntrySegments } from "../../src/lib/drive-rules";
import { mimeFor, VIDEO_EXT } from "../../src/lib/photo-metadata";
import type { ExpectedFile } from "../../src/lib/takeout-check";
import { isNonAlbumFolder } from "../import/takeout";

export type ExpectedAlbums = {
  albums: Map<string, { files: ExpectedFile[]; videos: number }>;
  outsideAlbums: number;
  videos: number;
  others: number;
};

/**
 * Dalle voci degli zip, le foto attese per album, con le stesse regole
 * dell'import (scripts/drive/index.ts e scripts/import/scan.ts): l'album è la
 * cartella che contiene il file.
 */
export function expectedFromEntries(entries: Iterable<{ fileName: string; size: number }>): ExpectedAlbums {
  const out: ExpectedAlbums = { albums: new Map(), outsideAlbums: 0, videos: 0, others: 0 };
  for (const { fileName, size } of entries) {
    const parts = zipEntrySegments(fileName);
    if (!parts) continue;
    if (parts.slice(0, -1).some(isNonAlbumFolder)) {
      out.outsideAlbums++;
      continue;
    }
    const name = parts[parts.length - 1];
    if (name.toLowerCase().endsWith(".json")) continue;
    const isVideo = VIDEO_EXT.test(name);
    const isPhoto = !isVideo && mimeFor(name) !== null;
    if (!isVideo && !isPhoto) {
      out.others++;
      continue;
    }
    if (isVideo) out.videos++;
    if (parts.length < 2) continue; // file nella radice dello zip: nessun album
    const ref = parts[parts.length - 2];
    let album = out.albums.get(ref);
    if (!album) out.albums.set(ref, (album = { files: [], videos: 0 }));
    if (isVideo) album.videos++;
    else album.files.push({ name, size });
  }
  return out;
}
