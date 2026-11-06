import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import type { NextRequest } from "next/server";
import { localPath, storage, verifyLocal } from "@/lib/storage";

/*
 * Archivio "local" (modalità di prova): lettura e scrittura dei file con
 * URL firmati, al posto di Google Cloud Storage. Con STORAGE_DRIVER=gcs
 * questa route non risponde.
 */

async function resolve(request: NextRequest, ctx: RouteContext<"/api/storage/[...key]">, method: "GET" | "PUT") {
  if (storage().driver !== "local") return null;
  const key = (await ctx.params).key.join("/");
  const exp = Number(request.nextUrl.searchParams.get("exp"));
  const sig = request.nextUrl.searchParams.get("sig") ?? "";
  if (!verifyLocal(method, key, exp, sig)) return null;
  try {
    return localPath(key);
  } catch {
    return null;
  }
}

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  cr2: "image/x-canon-cr2",
};

export async function GET(request: NextRequest, ctx: RouteContext<"/api/storage/[...key]">) {
  const file = await resolve(request, ctx, "GET");
  if (!file) return new Response("Non trovato", { status: 404 });
  try {
    const info = await stat(/* turbopackIgnore: true */ file);
    const ext = file.split(".").pop()?.toLowerCase() ?? "";
    return new Response(Readable.toWeb(createReadStream(/* turbopackIgnore: true */ file)) as ReadableStream, {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "Content-Length": String(info.size),
        "Cache-Control": "private, max-age=600",
      },
    });
  } catch {
    return new Response("Non trovato", { status: 404 });
  }
}

export async function PUT(request: NextRequest, ctx: RouteContext<"/api/storage/[...key]">) {
  const file = await resolve(request, ctx, "PUT");
  if (!file || !request.body) return new Response("Non autorizzato", { status: 403 });
  const tmp = `${file}.${process.pid}.${Date.now()}.part`;
  try {
    await pipeline(Readable.fromWeb(request.body as NodeWebStream), createWriteStream(/* turbopackIgnore: true */ tmp));
    await rename(tmp, file);
    return new Response(null, { status: 200 });
  } catch (e) {
    await rm(tmp, { force: true });
    console.error("[storage local]", e);
    return new Response("Scrittura non riuscita", { status: 500 });
  }
}
