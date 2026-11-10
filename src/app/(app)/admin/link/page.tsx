import { parentsLabel } from "@/app/ui/gallery/album-tree";
import type { TargetOption } from "@/app/ui/gallery/named-link-forms";
import { NamedLinkCreateForm } from "@/app/ui/gallery/named-link-forms";
import { NamedLinkList } from "@/app/ui/gallery/named-link-list";
import { PATH_SEP } from "@/lib/album-tree-rules";
import { albumTreeIndex } from "@/lib/gallery";
import { appUrl } from "@/lib/mail";
import { listNamedLinks } from "@/lib/named-links";
import { requireOwner } from "@/lib/session";

/** Link con nome: indirizzi perpetui /l/<nome> con destinazione modificabile (solo proprietario). */
export default async function NamedLinksPage() {
  await requireOwner();
  const [links, nodes] = await Promise.all([listNamedLinks(), albumTreeIndex()]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const options: TargetOption[] = nodes
    .map((n) => ({
      value: `album:${n.public_id}`,
      label: n.parent_id ? `${parentsLabel(n.id, byId)}${PATH_SEP}${n.title}` : n.title,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "it"));

  return (
    <>
      <h1>Link</h1>
      <p className="muted">
        Indirizzi perpetui con un nome scelto da te, come <code>{appUrl("/l/vizzarri")}</code>. Non scadono e puoi
        farli puntare a un altro album o a una singola foto quando vuoi: chi ha il link vede sempre la destinazione
        di oggi. Valgono come i link liberi: senza login, mai gli originali. Per puntare un link a una foto usa
        Condividi dalla pagina della foto.
      </p>
      <section className="card named-link-new">
        <h2>Nuovo link</h2>
        <NamedLinkCreateForm baseUrl={appUrl("/l/")} options={options} />
      </section>
      <section>
        <NamedLinkList links={links} options={options} />
      </section>
    </>
  );
}
