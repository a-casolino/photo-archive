import Link from "next/link";
import { addTagsAction, removeTagAction } from "@/app/actions/tags";
import type { Tag } from "@/lib/tags";

/** Tag di una foto o di un album, con aggiunta e rimozione (solo proprietario). */
export function TagEditor({
  kind,
  targetId,
  tags,
  allTags,
}: {
  kind: "photo" | "album";
  targetId: string;
  tags: Tag[];
  allTags: Pick<Tag, "id" | "name">[];
}) {
  const listId = `tags-${kind}-${targetId}`;
  const current = new Set(tags.map((t) => t.id));
  return (
    <div className="tag-editor">
      <ul className="tag-list" aria-label="Tag">
        {tags.map((t) => (
          <li key={t.id} className="tag-chip">
            <Link href={`/tag/${encodeURIComponent(t.slug)}`}>#{t.name}</Link>
            <form action={removeTagAction}>
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="targetId" value={targetId} />
              <input type="hidden" name="tagId" value={t.id} />
              <button type="submit" className="tag-remove" aria-label={`Togli il tag ${t.name}`} title="Togli">
                ×
              </button>
            </form>
          </li>
        ))}
      </ul>
      <form action={addTagsAction} className="tag-add">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="targetId" value={targetId} />
        <input
          name="names"
          list={listId}
          placeholder={tags.length ? "Aggiungi un tag" : "Aggiungi tag (separati da virgola)"}
          aria-label="Nuovi tag"
          maxLength={500}
          autoComplete="off"
        />
        <datalist id={listId}>
          {allTags
            .filter((t) => !current.has(t.id))
            .map((t) => (
              <option key={t.id} value={t.name} />
            ))}
        </datalist>
        <button type="submit" className="small">
          Aggiungi
        </button>
      </form>
    </div>
  );
}
