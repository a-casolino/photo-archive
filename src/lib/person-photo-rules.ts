/*
 * Regole pure della pagina di una persona (niente database), verificate dai
 * test in tests/person-photo-rules.test.ts.
 *
 * Ordine: per data di scatto, scelto dal proprietario e ricordato in un
 * cookie del browser (come l'ordine di Persone e degli album).
 * Album: il filtro tiene le foto della persona che stanno nell'album scelto
 * o in uno dei suoi sotto-album. Una foto "sta" in un album anche quando
 * nell'album c'è il suo export collegato (dopo l'unione degli album i CR2
 * non sono nell'album, c'è il JPEG lavorato).
 */

import { PATH_SEP, subtreeOf } from "./album-tree-rules";

export const PERSON_PHOTO_SORT_COOKIE = "persona_foto_ordine";

export const PERSON_PHOTO_SORTS = ["recenti", "vecchie"] as const;
export type PersonPhotoSort = (typeof PERSON_PHOTO_SORTS)[number];

export const PERSON_PHOTO_SORT_LABEL: Record<PersonPhotoSort, string> = {
  recenti: "Data: più recenti prima",
  vecchie: "Data: meno recenti prima",
};

export function parsePersonPhotoSort(value: string | undefined): PersonPhotoSort {
  return PERSON_PHOTO_SORTS.find((s) => s === value) ?? "recenti";
}

/** Parametro dell'URL con il public_id dell'album scelto. */
export const PERSON_ALBUM_PARAM = "album";

export type AlbumNode = {
  id: number;
  public_id: string;
  title: string;
  parent_id: number | null;
  date_from: Date | null;
};

export type PersonAlbumOption = {
  id: number;
  public_id: string;
  title: string;
  /** Titolo con il percorso degli album che lo contengono ("Sicilia › Palermo"). */
  label: string;
  /** 1 = primo livello. */
  depth: number;
  /** Foto della persona nell'album e nei suoi sotto-album, senza doppioni. */
  count: number;
  /** Le stesse foto (id delle foto mostrate nella pagina della persona). */
  photoIds: Set<number>;
};

const collator = new Intl.Collator("it", { sensitivity: "base", numeric: true });

/**
 * Album da proporre nel filtro: quelli che contengono foto della persona e
 * gli album che li contengono (anche se lì la persona compare solo nei
 * sotto-album). In ordine d'albero: album di primo livello dal più recente,
 * ognuno seguito dai suoi sotto-album.
 *
 * `links`: coppie album → foto mostrata (photo_id è già la foto della
 * persona, anche quando nell'album c'è il suo export).
 */
export function personAlbumOptions(
  links: { album_id: number; photo_id: number }[],
  albums: AlbumNode[],
): PersonAlbumOption[] {
  const byId = new Map(albums.map((a) => [a.id, a]));
  const direct = new Map<number, Set<number>>();
  for (const l of links) {
    if (!byId.has(l.album_id)) continue; // album nel cestino o sparito
    let set = direct.get(l.album_id);
    if (!set) direct.set(l.album_id, (set = new Set()));
    set.add(l.photo_id);
  }

  // Gli album con foto e i loro antenati (fermandosi sui cicli).
  const shown = new Set<number>();
  for (const id of direct.keys()) {
    for (let cur = byId.get(id); cur && !shown.has(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined) {
      shown.add(cur.id);
    }
  }
  const nodes = albums.filter((a) => shown.has(a.id));

  const photosOf = (id: number) => {
    const out = new Set<number>();
    for (const s of subtreeOf(id, nodes)) for (const p of direct.get(s) ?? []) out.add(p);
    return out;
  };

  const children = new Map<number | null, AlbumNode[]>();
  for (const a of nodes) {
    // Un genitore non mostrato (non dovrebbe succedere) fa diventare l'album di primo livello.
    const parent = a.parent_id !== null && shown.has(a.parent_id) ? a.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), a]);
  }
  const byDate = (a: AlbumNode, b: AlbumNode) => {
    if (a.date_from && b.date_from && a.date_from.getTime() !== b.date_from.getTime())
      return b.date_from.getTime() - a.date_from.getTime();
    if (a.date_from && !b.date_from) return -1;
    if (!a.date_from && b.date_from) return 1;
    return collator.compare(a.title, b.title);
  };
  const byTitle = (a: AlbumNode, b: AlbumNode) => collator.compare(a.title, b.title) || byDate(a, b);

  const out: PersonAlbumOption[] = [];
  const visited = new Set<number>();
  const walk = (parent: number | null, path: string, depth: number) => {
    // Primo livello dal più recente; i sotto-album per nome (spesso sono date o luoghi).
    const list = [...(children.get(parent) ?? [])].sort(depth === 1 ? byDate : byTitle);
    for (const a of list) {
      if (visited.has(a.id)) continue;
      visited.add(a.id);
      const label = path ? `${path}${PATH_SEP}${a.title}` : a.title;
      const photoIds = photosOf(a.id);
      out.push({ id: a.id, public_id: a.public_id, title: a.title, label, depth, count: photoIds.size, photoIds });
      walk(a.id, label, depth + 1);
    }
  };
  walk(null, "", 1);
  return out;
}
