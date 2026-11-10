import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { getCurrentUser } from "@/lib/session";

/*
 * ExifTool in WebAssembly (zeroperl, ~25 MB, ~7,5 MB compresso) per la
 * pagina "Carica dal browser": legge i tag dei CR2 e delle foto nel
 * browser, come exiftool nel programma di import. Servito dall'app (solo al
 * proprietario) e tenuto in cache dal browser: l'URL cambia con la versione.
 */

const g = globalThis as unknown as { __exiftoolWasmGz?: Promise<Buffer> };

function wasmGz(): Promise<Buffer> {
  g.__exiftoolWasmGz ??= (async () => {
    // Il pacchetto (dipendenza di @uswriting/exiftool) non esporta il file:
    // lo si legge da node_modules, che sulla VPS c'è (npm ci a ogni deploy).
    const file = path.join(process.cwd(), "node_modules", "@6over3", "zeroperl-ts", "dist", "esm", "zeroperl.wasm");
    return gzipSync(await readFile(file), { level: 6 });
  })().catch((e) => {
    g.__exiftoolWasmGz = undefined;
    throw e;
  });
  return g.__exiftoolWasmGz;
}

export async function GET() {
  const user = await getCurrentUser();
  if (user?.role !== "owner") return new Response("Non autorizzato.", { status: 403 });
  const body = await wasmGz();
  // Compresso con gzip ma senza Content-Encoding (Next.js lo toglierebbe):
  // lo decomprime il worker con DecompressionStream.
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": "application/gzip", "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
