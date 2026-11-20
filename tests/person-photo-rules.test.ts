import { describe, expect, it } from "vitest";
import { parsePersonPhotoSort, personAlbumOptions, type AlbumNode } from "../src/lib/person-photo-rules";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const albums: AlbumNode[] = [
  { id: 1, public_id: "sicilia", title: "Sicilia", parent_id: null, date_from: d("2020-08-01") },
  { id: 2, public_id: "palermo", title: "Palermo", parent_id: 1, date_from: d("2020-08-02") },
  { id: 3, public_id: "catania", title: "Catania", parent_id: 1, date_from: d("2020-08-05") },
  { id: 4, public_id: "mercato", title: "Mercato", parent_id: 2, date_from: d("2020-08-02") },
  { id: 5, public_id: "trentino", title: "Trentino 2023", parent_id: null, date_from: d("2023-07-01") },
  { id: 6, public_id: "vuoto", title: "Senza la persona", parent_id: null, date_from: d("2024-01-01") },
];

describe("parsePersonPhotoSort", () => {
  it("riconosce i valori e altrimenti usa le più recenti", () => {
    expect(parsePersonPhotoSort("vecchie")).toBe("vecchie");
    expect(parsePersonPhotoSort("recenti")).toBe("recenti");
    expect(parsePersonPhotoSort("boh")).toBe("recenti");
    expect(parsePersonPhotoSort(undefined)).toBe("recenti");
  });
});

describe("personAlbumOptions", () => {
  const links = [
    { album_id: 4, photo_id: 10 },
    { album_id: 2, photo_id: 10 }, // la stessa foto anche nel genitore: contata una volta
    { album_id: 3, photo_id: 11 },
    { album_id: 5, photo_id: 20 },
    { album_id: 5, photo_id: 21 },
  ];
  const opts = personAlbumOptions(links, albums);

  it("mostra gli album con la persona e i loro antenati, in ordine d'albero", () => {
    expect(opts.map((o) => [o.label, o.depth])).toEqual([
      ["Trentino 2023", 1],
      ["Sicilia", 1],
      ["Sicilia › Catania", 2],
      ["Sicilia › Palermo", 2],
      ["Sicilia › Palermo › Mercato", 3],
    ]);
  });

  it("un album comprende le foto dei sotto-album, senza doppioni", () => {
    const by = new Map(opts.map((o) => [o.public_id, o]));
    expect([...by.get("sicilia")!.photoIds].sort()).toEqual([10, 11]);
    expect(by.get("sicilia")!.count).toBe(2);
    expect(by.get("palermo")!.count).toBe(1);
    expect(by.get("mercato")!.count).toBe(1);
    expect(by.get("trentino")!.count).toBe(2);
    expect(by.has("vuoto")).toBe(false);
  });

  it("ignora gli album che non ci sono più (cestino)", () => {
    expect(personAlbumOptions([{ album_id: 99, photo_id: 1 }], albums)).toEqual([]);
  });
});
