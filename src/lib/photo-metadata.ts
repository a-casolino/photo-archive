import { normalizeSubsec, type CameraInfo } from "./import-shared";

/*
 * Dai tag letti da exiftool ai campi che l'app salva per ogni foto.
 * Funzioni pure, testate in tests/import-metadata.test.ts. Usate dal
 * programma di import (exiftool-vendored) e dalla pagina "Carica dal
 * browser" (ExifTool in WebAssembly): stessi tag, stessi campi.
 */

type DateLike = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  tzoffsetMinutes?: number;
  inferredZone?: boolean;
};

export type Tags = Record<string, unknown>;

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

function asDate(v: unknown): DateLike | null {
  if (v && typeof v === "object" && "year" in v && "hour" in v) {
    const d = v as DateLike;
    if (d.year > 1900 && d.month >= 1 && d.day >= 1) return d;
  }
  if (typeof v === "string") {
    const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v);
    if (m && m[1] !== "0000") {
      return { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: +m[6] };
    }
  }
  return null;
}

/** "YYYY-MM-DD HH:MM:SS" come la scrive la fotocamera (ora locale). */
export function localDateString(d: DateLike): string {
  return `${d.year}-${pad(d.month)}-${pad(d.day)} ${pad(d.hour)}:${pad(d.minute)}:${pad(d.second)}`;
}

/** Ora locale a Roma di un istante UTC: stima per le foto senza EXIF. */
export function romeLocalString(isoUtc: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(isoUtc))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function parseOffset(v: unknown): number | null {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function str(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = /-?\d+(\.\d+)?/.exec(String(v ?? ""));
  return m ? Number(m[0]) : null;
}

export function exposureString(v: unknown): string | null {
  if (typeof v === "number" && v > 0) {
    return v >= 1 ? String(Math.round(v * 10) / 10) : `1/${Math.round(1 / v)}`;
  }
  return str(v, 16);
}

export type PhotoFields = {
  takenAt: string | null;
  takenAtSubsec: number | null;
  takenAtUtc: string | null;
  camera: CameraInfo | null;
  lens: string | null;
  focalLengthMm: number | null;
  aperture: number | null;
  exposureTime: string | null;
  iso: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
  width: number | null;
  height: number | null;
  orientation: number | null;
};

export function photoFields(tags: Tags): PhotoFields {
  const dt = asDate(tags.DateTimeOriginal) ?? asDate(tags.CreateDate);
  const takenAt = dt ? localDateString(dt) : null;

  let takenAtUtc: string | null = null;
  const offset = parseOffset(tags.OffsetTimeOriginal) ?? parseOffset(tags.OffsetTime);
  if (dt && offset !== null) {
    const utc = Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second) - offset * 60_000;
    takenAtUtc = new Date(utc).toISOString();
  }

  const make = str(tags.Make, 64);
  const model = str(tags.Model, 128);
  const serial = str(tags.SerialNumber ?? tags.InternalSerialNumber ?? tags.BodySerialNumber, 64) ?? "";
  const camera = make || model ? { make: make ?? "", model: model ?? "", serial } : null;

  const orientation = num(tags.Orientation);
  const o = orientation && orientation >= 1 && orientation <= 8 ? orientation : null;
  const size = /^(\d+)x(\d+)$/.exec(String(tags.ImageSize ?? ""));
  // Dimensioni come sono nel file (sensore): per le foto ruotate di 90° le
  // scambia chi le mostra, con displaySize() in src/lib/gallery-rules.ts.
  const width = size ? Number(size[1]) : num(tags.ImageWidth);
  const height = size ? Number(size[2]) : num(tags.ImageHeight);

  const lat = num(tags.GPSLatitude);
  const lon = num(tags.GPSLongitude);
  const hasGps = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0);

  const iso = num(tags.ISO);
  return {
    takenAt,
    takenAtSubsec: normalizeSubsec(tags.SubSecTimeOriginal ?? tags.SubSecTime),
    takenAtUtc,
    camera,
    lens: str(tags.LensModel ?? tags.Lens ?? tags.LensID, 128),
    focalLengthMm: num(tags.FocalLength),
    aperture: num(tags.FNumber ?? tags.Aperture),
    exposureTime: exposureString(tags.ExposureTime),
    iso: iso !== null ? Math.round(iso) : null,
    gpsLat: hasGps ? Math.round(lat * 1e6) / 1e6 : null,
    gpsLon: hasGps ? Math.round(lon * 1e6) / 1e6 : null,
    width: width ? Math.round(width) : null,
    height: height ? Math.round(height) : null,
    orientation: o,
  };
}

const DROP_TAGS = new Set(["SourceFile", "Directory", "FileName", "FileAccessDate", "FileInodeChangeDate", "FilePermissions", "errors", "warnings"]);

/** Tutti i tag in forma JSON, senza dati binari né percorsi locali. */
export function exifJson(tags: Tags): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(tags)) {
    if (DROP_TAGS.has(k) || v === null || v === undefined) continue;
    if (typeof v === "object") {
      const o = v as { _ctor?: string; rawValue?: unknown };
      if (o._ctor === "BinaryField") continue;
      if ("rawValue" in o && o.rawValue !== undefined) {
        out[k] = o.rawValue;
        continue;
      }
      const json = JSON.stringify(v);
      if (json.length <= 2000) out[k] = JSON.parse(json);
      continue;
    }
    if (typeof v === "string" && v.length > 2000) continue;
    out[k] = v;
  }
  return out;
}

const MIME_BY_EXT: Record<string, string> = {
  cr2: "image/x-canon-cr2",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  gif: "image/gif",
  dng: "image/x-adobe-dng",
};

export function mimeFor(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? null;
}

export const VIDEO_EXT = /\.(mp4|mov|m4v|3gp|avi|mts|m2ts|mkv|webm)$/i;
