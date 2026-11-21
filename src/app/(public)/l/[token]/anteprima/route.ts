import sharp from "sharp";
import type { NextRequest } from "next/server";
import { getPhoto } from "@/lib/gallery";
import { PREVIEW_IMAGE_HEIGHT, PREVIEW_IMAGE_WIDTH } from "@/lib/link-preview-rules";
import { getLinkShare, shareCoversPhoto } from "@/lib/shares";
import { storage } from "@/lib/storage";

/*
 * Immagine di anteprima di un link libero per i social (og:image):
 *   /l/<token o nome>/anteprima?p=<foto>
 * Gli URL firmati delle anteprime scadono dopo pochi minuti, mentre WhatsApp
 * e Facebook tengono l'immagine per giorni: qui l'URL è stabile e l'app
 * risponde con il JPEG. Si controlla ogni volta che il link sia ancora valido
 * e che la foto ne faccia parte: un link revocato o scaduto non mostra più
 * niente. Il JPEG è ricavato dall'anteprima grande (l'export di Lightroom se
 * c'è), ritagliato a 1200×630 sulla parte più interessante e leggero (sotto
 * i ~300 KB che WhatsApp accetta).
 */

const MAX_CACHED = 60;
const g = globalThis as { __linkPreviewImages?: Map<string, Buffer> };

function cacheMap(): Map<string, Buffer> {
  return (g.__linkPreviewImages ??= new Map());
}

function notFound() {
  return new Response("Non trovato", { status: 404, headers: { "Cache-Control": "no-store" } });
}

async function render(key: string): Promise<Buffer> {
  const c = cacheMap();
  const hit = c.get(key);
  if (hit) return hit;
  const source = await storage().read(key);
  const out = await sharp(source, { failOn: "none" })
    .rotate()
    .resize(PREVIEW_IMAGE_WIDTH, PREVIEW_IMAGE_HEIGHT, { fit: "cover", position: sharp.strategy.attention })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  c.set(key, out);
  if (c.size > MAX_CACHED) {
    const oldest = c.keys().next().value;
    if (oldest !== undefined) c.delete(oldest);
  }
  return out;
}

export async function GET(request: NextRequest, ctx: RouteContext<"/l/[token]/anteprima">) {
  const { token } = await ctx.params;
  const share = await getLinkShare(token);
  if (!share) return notFound();
  const photo = await getPhoto(request.nextUrl.searchParams.get("p") ?? "");
  if (!photo || !(await shareCoversPhoto(share, photo.id))) return notFound();
  const key = photo.preview_key ?? photo.thumb_key;
  if (!key) return notFound();
  try {
    const body = await render(key);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(body.length),
        // Breve: se il link viene revocato, l'immagine smette presto di essere servita.
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    console.error("[anteprima link]", key, e);
    return notFound();
  }
}
