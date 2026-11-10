/*
 * HEIC (foto degli iPhone) per i browser che non sanno aprirli: Chrome,
 * Edge e Firefox. Safari li apre da solo e qui non si arriva.
 *
 * Si usa libheif in WebAssembly (pacchetto libheif-js, licenza LGPL,
 * caricato a parte solo quando serve: circa 2 MB). libheif applica già la
 * rotazione salvata nel file (box irot/imir), come fa Safari, quindi
 * l'immagine esce dritta e l'orientamento EXIF non va riapplicato.
 */
import type { LibHeif } from "libheif-js/libheif-wasm/libheif-bundle.mjs";

let lib: Promise<LibHeif> | null = null;

function loadLibHeif(): Promise<LibHeif> {
  lib ??= import("libheif-js/libheif-wasm/libheif-bundle.mjs")
    .then(async (m) => {
      const l = m.default();
      if (l.ready) await l.ready;
      return l;
    })
    .catch((e) => {
      lib = null;
      throw e;
    });
  return lib;
}

/** Decodifica l'immagine principale del file HEIC in una bitmap per il canvas. */
export async function decodeHeic(file: Blob): Promise<ImageBitmap> {
  const libheif = await loadLibHeif();
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(await file.arrayBuffer()));
  const image = images.find((i) => i.is_primary()) ?? images[0];
  if (!image) throw new Error("HEIC illeggibile: nessuna immagine nel file.");
  try {
    const width = image.get_width();
    const height = image.get_height();
    const target = new ImageData(width, height);
    const decoded = await new Promise<ImageData | null>((resolve) => image.display(target, resolve));
    if (!decoded) throw new Error("HEIC illeggibile (file rovinato o formato non supportato).");
    return await createImageBitmap(decoded);
  } finally {
    for (const i of images) i.free();
  }
}
