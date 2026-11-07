import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ExifTool } from "exiftool-vendored";
import sharp, { type Sharp } from "sharp";
import { PREVIEW_LONG_SIDE, THUMB_LONG_SIDE } from "../../src/lib/import-shared";

/*
 * Anteprime: un JPEG grande (~2048 px) e una miniatura (~400 px), ruotate
 * secondo l'EXIF e senza metadati (niente GPS nelle immagini condivise).
 *
 * - CR2: si usa il JPEG incorporato nel file (PreviewImage), che è a piena
 *   risoluzione ma non porta l'orientamento: lo si applica a mano.
 * - JPEG/PNG/WebP: si legge il file e si ruota con l'EXIF.
 * - HEIC: su Mac si converte con `sips`; altrove si prova con sharp.
 */

export type Previews = { preview: Buffer; thumb: Buffer; source: string };

const execFileAsync = promisify(execFile);

/** Applica l'orientamento EXIF (1..8) a un'immagine che non lo contiene. */
export function applyOrientation(img: Sharp, orientation: number | null): Sharp {
  switch (orientation) {
    case 2:
      return img.flop();
    case 3:
      return img.rotate(180);
    case 4:
      return img.flip();
    // sharp specchia (flop) prima di ruotare, quindi 5 e 7 sembrano "scambiati":
    // verificato dai test in tests/import-previews.test.ts.
    case 5:
      return img.rotate(270).flop();
    case 6:
      return img.rotate(90);
    case 7:
      return img.rotate(90).flop();
    case 8:
      return img.rotate(270);
    default:
      return img;
  }
}

async function render(input: Buffer, orientation: number | null, auto: boolean) {
  // Prima si raddrizza (in un buffer), poi si ridimensiona: così l'ordine
  // delle operazioni di sharp non conta.
  const base = auto ? sharp(input, { failOn: "none" }).rotate() : applyOrientation(sharp(input, { failOn: "none" }), orientation);
  const upright = await base.resize(PREVIEW_LONG_SIDE, PREVIEW_LONG_SIDE, { fit: "inside", withoutEnlargement: true }).toBuffer();
  const preview = await sharp(upright).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  const thumb = await sharp(upright)
    .resize(THUMB_LONG_SIDE, THUMB_LONG_SIDE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();
  return { preview, thumb };
}

async function embeddedJpeg(et: ExifTool, file: string): Promise<{ buf: Buffer; tag: string } | null> {
  let best: { buf: Buffer; tag: string } | null = null;
  for (const tag of ["JpgFromRaw", "PreviewImage", "ThumbnailImage"] as const) {
    try {
      const buf = await et.extractBinaryTagToBuffer(tag, file);
      if (buf.length > 1000 && (!best || buf.length > best.buf.length)) best = { buf, tag };
    } catch {
      // tag assente
    }
    if (best && best.buf.length > 200_000) break; // abbastanza grande
  }
  return best;
}

export async function makePreviews(
  et: ExifTool,
  file: string,
  mime: string,
  orientation: number | null,
): Promise<Previews | null> {
  if (mime === "image/x-canon-cr2" || mime === "image/x-adobe-dng") {
    const emb = await embeddedJpeg(et, file);
    if (!emb) return null;
    return { ...(await render(emb.buf, orientation, false)), source: emb.tag };
  }

  try {
    return { ...(await render(await readFile(file), orientation, true)), source: "file" };
  } catch (e) {
    if (!/heic|heif/.test(mime)) throw e;
  }

  // HEIC che sharp non sa leggere
  if (process.platform === "darwin") {
    const dir = await mkdtemp(path.join(tmpdir(), "pa-heic-"));
    try {
      const out = path.join(dir, "out.jpg");
      await execFileAsync("sips", ["-s", "format", "jpeg", file, "--out", out]);
      return { ...(await render(await readFile(out), null, true)), source: "sips" };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const emb = await embeddedJpeg(et, file);
  if (!emb) return null;
  return { ...(await render(emb.buf, orientation, false)), source: emb.tag };
}
