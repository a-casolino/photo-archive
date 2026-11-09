import { ShareList } from "@/app/ui/gallery/share-list";
import { requireOwner } from "@/lib/session";
import { defaultLinkDays, listShares, shareableUsers } from "@/lib/shares";

export default async function SharesPage() {
  await requireOwner();
  const [shares, people] = await Promise.all([listShares(), shareableUsers()]);
  return (
    <>
      <h1>Condivisioni</h1>
      <p className="muted">
        Le nuove condivisioni si creano dalla pagina dell&apos;album o della foto. Dei link liberi attivi trovi qui
        l&apos;indirizzo da copiare; &quot;Nuovo link&quot; ne crea uno diverso e quello vecchio smette di funzionare.
      </p>
      <section>
        <ShareList shares={shares} showTarget defaultDays={defaultLinkDays()} people={people} />
      </section>
    </>
  );
}
