/*
 * Google Takeout: ogni foto ha accanto un file JSON con data di scatto,
 * titolo, descrizione, posizione e link a Google Foto. I nomi dei JSON
 * seguono regole poco coerenti, gestite qui:
 *
 *   IMG_1234.JPG                    -> IMG_1234.JPG.json
 *                                   -> IMG_1234.JPG.supplemental-metadata.json
 *                                   -> IMG_1234.JPG.supplemental-meta.json (troncato)
 *   IMG_1234(1).JPG                 -> IMG_1234.JPG(1).json
 *                                   -> IMG_1234.JPG.supplemental-metadata(1).json
 *   IMG_1234-edited.JPG             -> il JSON dell'originale IMG_1234.JPG
 *   nome_lunghissimo_tagliato...jpg -> nome_lunghissimo_tagl.json
 */

const EDITED_RE = /^(.*)-(edited|modificato|modificata|bearbeitet|editado|modifié|modifie)(\.[^.]+)$/i;
const DUP_RE = /^(.*)\((\d+)\)(\.[^.]+)$/;
const SUPPLEMENTAL = ".supplemental-metadata";

/** Il JSON di Takeout per un file, tra i JSON della stessa cartella. */
export function findSidecar(fileName: string, jsonNames: readonly string[]): string | null {
  let base = fileName;
  let dup = "";
  const edited = EDITED_RE.exec(base);
  if (edited) base = edited[1] + edited[3];
  const d = DUP_RE.exec(base);
  if (d) {
    base = d[1] + d[3];
    dup = `(${d[2]})`;
  }

  const stems = jsonNames.filter((j) => j.toLowerCase().endsWith(".json")).map((j) => [j, j.slice(0, -5)] as const);

  // 1. nomi esatti
  for (const [j, s] of stems) {
    if (s === base + dup || s === base + SUPPLEMENTAL + dup) return j;
  }
  // 2. ".supplemental-metadata" troncato
  for (const [j, s] of stems) {
    const core = dup && s.endsWith(dup) ? s.slice(0, -dup.length) : dup ? null : s;
    if (core && core.startsWith(base + ".") && (base + SUPPLEMENTAL).startsWith(core)) return j;
  }
  // 3. nome del file troncato (il più lungo che combacia)
  if (!dup) {
    let best: string | null = null;
    let bestLen = 0;
    for (const [j, s] of stems) {
      if (s.length >= 20 && s.length > bestLen && base.startsWith(s)) {
        best = j;
        bestLen = s.length;
      }
    }
    if (best) return best;
  }
  return null;
}

export type TakeoutSidecar = {
  title?: string;
  description?: string;
  url?: string;
  photoTakenTime?: { timestamp?: string };
  geoData?: { latitude?: number; longitude?: number };
  geoDataExif?: { latitude?: number; longitude?: number };
};

export type SidecarInfo = {
  takenAtUtc: string | null;
  description: string | null;
  googlePhotosUrl: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
};

export function parseSidecar(json: TakeoutSidecar): SidecarInfo {
  const ts = Number(json.photoTakenTime?.timestamp);
  const geo = [json.geoDataExif, json.geoData].find(
    (g) => g && typeof g.latitude === "number" && typeof g.longitude === "number" && (g.latitude !== 0 || g.longitude !== 0),
  );
  return {
    takenAtUtc: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null,
    description: json.description?.trim() || null,
    googlePhotosUrl: json.url?.startsWith("https://") ? json.url.slice(0, 512) : null,
    gpsLat: geo?.latitude ?? null,
    gpsLon: geo?.longitude ?? null,
  };
}

/** Cartelle di Takeout che non sono album (anni, cestino). */
export function isNonAlbumFolder(name: string): boolean {
  return (
    /^(photos from|foto da|foto dal|foto del|fotos von|fotos de|photos de) \d{4}$/i.test(name) ||
    /^(trash|cestino|bin|papierkorb|papelera|corbeille)$/i.test(name)
  );
}

/**
 * Il file con titolo e descrizione dell'album: "metadata.json", ma nei Takeout
 * in altre lingue il nome cambia ("metadati.json" in italiano).
 */
export function albumMetadataFile(names: readonly string[]): string | null {
  return (
    names.find((n) => /^(metadata|metadati|metadatos|metadados|metadaten|m[ée]tadonn[ée]es)(\(\d+\))?\.json$/i.test(n)) ??
    null
  );
}
