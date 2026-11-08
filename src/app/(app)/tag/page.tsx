import Link from "next/link";
import { formatCount } from "@/lib/format";
import { requireOwner } from "@/lib/session";
import { listTags } from "@/lib/tags";

export default async function TagsPage() {
  await requireOwner();
  const tags = await listTags();
  return (
    <>
      <h1>Tag</h1>
      {tags.length === 0 ? (
        <p className="muted">
          Non ci sono ancora tag. Si aggiungono dalla pagina di un album o di una foto, per esempio
          &quot;montagna, famiglia&quot;.
        </p>
      ) : (
        <ul className="tag-cloud">
          {tags.map((t) => (
            <li key={t.id}>
              <Link href={`/tag/${encodeURIComponent(t.slug)}`} className="tag-chip">
                #{t.name}
                <span className="muted">
                  {[
                    t.album_count ? `${formatCount(t.album_count)} album` : null,
                    t.photo_count ? `${formatCount(t.photo_count)} foto` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "vuoto"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
