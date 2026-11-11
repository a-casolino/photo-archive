/*
 * Stima dei costi di Google Cloud Storage per la pagina Statistiche.
 * Regole pure (niente database, niente rete): testate in tests/cost-rules.test.ts.
 *
 * Listino del bucket `acasolino-foto`, regione europe-west8 (Milano), in
 * dollari come nel listino Google. Google conta i "GB" in base 2 (GiB).
 * Da ricontrollare ogni tanto su https://cloud.google.com/storage/pricing
 * e aggiornare PRICES_CHECKED.
 */

export type StorageClass = "STANDARD" | "NEARLINE" | "COLDLINE" | "ARCHIVE";

export const PRICES_CHECKED = "2026-11-11";
export const BUCKET_REGION = "europe-west8 (Milano)";

/** Cambio usato per mostrare i costi in euro (1 USD = USD_TO_EUR €). */
export const USD_TO_EUR = 0.86;

export const GIB = 1024 ** 3;

export const PRICES = {
  /** $/GiB al mese, per classe. */
  storage: { STANDARD: 0.023, NEARLINE: 0.013, COLDLINE: 0.006, ARCHIVE: 0.0025 } as Record<StorageClass, number>,
  /** $/GiB verso internet (fascia 0–1 TiB al mese, rete Premium, dall'Europa). */
  egress: 0.12,
  /** $ per 1000 operazioni di classe A (scritture, elenchi) per classe del file. */
  opsA: { STANDARD: 0.005, NEARLINE: 0.01, COLDLINE: 0.02, ARCHIVE: 0.05 } as Record<StorageClass, number>,
  /** $ per 1000 operazioni di classe B (letture, metadati). */
  opsB: { STANDARD: 0.0004, NEARLINE: 0.001, COLDLINE: 0.01, ARCHIVE: 0.05 } as Record<StorageClass, number>,
  /** $/GiB letti da una classe fredda (download dei CR2 in Archive). */
  retrieval: { STANDARD: 0, NEARLINE: 0.01, COLDLINE: 0.02, ARCHIVE: 0.05 } as Record<StorageClass, number>,
};

/**
 * Peso medio stimato dei file generati dall'app, usato solo quando le metriche
 * di Google non sono disponibili (il database non salva il peso delle anteprime).
 */
export const ESTIMATED_SIZE = {
  preview: 600_000, // JPEG ~2048 px
  thumb: 40_000, // JPEG ~400 px
  face: 10_000, // miniatura del volto 160 px
};

export const STORAGE_CLASS_LABEL: Record<StorageClass, string> = {
  STANDARD: "Standard",
  NEARLINE: "Nearline",
  COLDLINE: "Coldline",
  ARCHIVE: "Archive",
};

/** Normalizza l'etichetta di classe delle metriche ("ARCHIVE", "archive", "REGIONAL", ...). */
export function normalizeClass(label: string | undefined | null): StorageClass {
  const v = (label ?? "").toUpperCase();
  if (v === "ARCHIVE" || v === "COLDLINE" || v === "NEARLINE") return v;
  // MULTI_REGIONAL, REGIONAL e DURABLE_REDUCED_AVAILABILITY sono vecchi nomi di Standard.
  return "STANDARD";
}

/**
 * Classe dell'operazione dal nome del metodo nelle metriche
 * (`api/request_count`, etichetta method: "ReadObject", "WriteObject", ...).
 * Le cancellazioni sono gratuite.
 */
export function operationClass(method: string): "A" | "B" | "free" {
  if (/^Delete/i.test(method)) return "free";
  if (/(Write|Insert|Compose|Copy|Rewrite|List|Update|Patch|Create|Set|Resumable|Start)/i.test(method)) return "A";
  return "B";
}

export type CostInput = {
  /** Byte salvati per classe (già comprensivi di anteprime, volti, ecc.). */
  storedBytes: Partial<Record<StorageClass, number>>;
  /** Byte usciti verso internet in un mese (null = non noto). */
  egressBytes: number | null;
  /** Operazioni in un mese (null = non note). */
  opsA: number | null;
  opsB: number | null;
  /** Di cui scritture di file in classe Archive (CR2 caricati nel mese). */
  archiveWrites: number;
  /** Byte di CR2 letti dalla classe Archive nel mese (download degli originali). */
  archiveReadBytes: number;
};

export type CostLine = { key: string; label: string; usd: number; known: boolean; detail?: string };

const round = (v: number) => Math.round(v * 10000) / 10000;

/** Righe di costo mensile in dollari. `known: false` = voce non misurabile, conta 0. */
export function monthlyCost(input: CostInput): CostLine[] {
  const lines: CostLine[] = [];
  for (const cls of ["ARCHIVE", "COLDLINE", "NEARLINE", "STANDARD"] as const) {
    const bytes = input.storedBytes[cls] ?? 0;
    if (!bytes && cls !== "ARCHIVE" && cls !== "STANDARD") continue;
    lines.push({
      key: `storage-${cls}`,
      label: `Spazio ${STORAGE_CLASS_LABEL[cls]}`,
      usd: round((bytes / GIB) * PRICES.storage[cls]),
      known: true,
    });
  }
  lines.push({
    key: "egress",
    label: "Traffico verso internet",
    usd: input.egressBytes === null ? 0 : round((input.egressBytes / GIB) * PRICES.egress),
    known: input.egressBytes !== null,
  });
  // Le scritture in Archive costano più delle altre: si contano a parte.
  const archiveWrites = Math.min(input.archiveWrites, input.opsA ?? input.archiveWrites);
  const opsA = input.opsA === null ? null : Math.max(0, input.opsA - archiveWrites);
  lines.push({
    key: "ops",
    label: "Operazioni",
    usd:
      opsA === null || input.opsB === null
        ? round((archiveWrites / 1000) * PRICES.opsA.ARCHIVE)
        : round(
            (archiveWrites / 1000) * PRICES.opsA.ARCHIVE +
              (opsA / 1000) * PRICES.opsA.STANDARD +
              (input.opsB / 1000) * PRICES.opsB.STANDARD,
          ),
    known: input.opsA !== null && input.opsB !== null,
  });
  lines.push({
    key: "retrieval",
    label: "Recupero CR2 da Archive",
    usd: round((input.archiveReadBytes / GIB) * PRICES.retrieval.ARCHIVE),
    known: true,
  });
  return lines;
}

export function totalUsd(lines: CostLine[]): number {
  return round(lines.reduce((s, l) => s + l.usd, 0));
}

export function toEur(usd: number): number {
  return usd * USD_TO_EUR;
}

/**
 * Proiezione dello spazio con tutto l'archivio: `targetOriginalBytes` di CR2 in
 * Archive, con anteprime nella stessa proporzione di oggi (byte di file
 * Standard per byte di originale). Senza dati si usano i pesi stimati.
 */
export function projectStorage(
  targetOriginalBytes: number,
  current: { originalBytes: number; originalCount: number; standardBytes: number },
): { photos: number; archiveBytes: number; standardBytes: number } {
  const avgOriginal = current.originalCount > 0 ? current.originalBytes / current.originalCount : 25_000_000;
  const photos = Math.round(targetOriginalBytes / avgOriginal);
  const ratio =
    current.originalBytes > 0 && current.standardBytes > 0
      ? current.standardBytes / current.originalBytes
      : (ESTIMATED_SIZE.preview + ESTIMATED_SIZE.thumb) / avgOriginal;
  return { photos, archiveBytes: targetOriginalBytes, standardBytes: Math.round(targetOriginalBytes * ratio) };
}

/** Somma per giorno di serie già aggregate: [{ date: "2026-11-10", bytes }]. */
export function sumSeries(points: { bytes: number }[]): number {
  return points.reduce((s, p) => s + p.bytes, 0);
}
