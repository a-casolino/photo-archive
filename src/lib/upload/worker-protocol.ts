/*
 * Messaggi tra la pagina "Carica dal browser" e i suoi Web Worker
 * (src/lib/upload/worker.ts), che fanno il lavoro pesante: impronta
 * SHA-256, lettura dei tag con ExifTool (WebAssembly) e anteprime JPEG.
 */

export type WorkerJob =
  | { op: "hash"; file: Blob }
  | { op: "analyze"; file: Blob; name: string; mime: string; wasmUrl: string };

export type WorkerRequest = WorkerJob & { id: number };

export type Analysis = {
  /** Tag di ExifTool, come li dà il programma di import (stessi argomenti). */
  tags: Record<string, unknown>;
  preview: Blob;
  thumb: Blob;
  /** Da dove viene l'anteprima: "file" o il tag del JPEG incorporato (PreviewImage…). */
  source: string;
};

export type WorkerResponse =
  | { id: number; ok: true; sha256: string }
  | { id: number; ok: true; analysis: Analysis }
  | { id: number; ok: false; error: string };

/**
 * Argomenti di ExifTool uguali a quelli di exiftool-vendored nel programma
 * di import (DefaultExifToolOptions + ReadTask): -fast, struct, MWG e gli
 * stessi tag numerici, così photoFields() dà gli stessi campi.
 */
export const EXIFTOOL_ARGS = [
  "-json",
  "-fast",
  "-api",
  "struct=1",
  "-api",
  "keepUTCTime",
  "-use",
  "MWG",
  "-*Duration*#",
  "-GPSAltitude#",
  "-GPSLatitude#",
  "-GPSLongitude#",
  "-GPSPosition#",
  "-GeolocationPosition#",
  "-Orientation#",
  "-all",
];
