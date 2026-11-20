import { describe, expect, it } from "vitest";
import { HashIndex, cameraGroups, fileStem, folderSections, promotedTitle, proposePairs, shotKey } from "../src/lib/album-pair-rules";
import { parseHash } from "../src/lib/phash-rules";

const votes = (spec: [number, number][]) => spec.flatMap(([folder, n]) => Array.from({ length: n }, () => [folder]));

describe("proposePairs", () => {
  it("un album, una cartella con tutte le foto", () => {
    const r = proposePairs([{ albumId: 1, photos: 106, folders: votes([[10, 106]]) }]);
    expect(r).toEqual([{ googleId: 1, folderId: 10, shared: 106, photos: 106 }]);
  });

  it("evento su due giorni: due cartelle", () => {
    const r = proposePairs([{ albumId: 1, photos: 236, folders: votes([[10, 186], [11, 50]]) }]);
    expect(r.map((p) => p.folderId)).toEqual([10, 11]);
  });

  it("raccolta di molti eventi: nessuna cartella arriva al 20%", () => {
    const folders = Array.from({ length: 30 }, (_, i) => [100 + i, 10] as [number, number]);
    expect(proposePairs([{ albumId: 1, photos: 300, folders: votes(folders) }])).toEqual([]);
  });

  it("foto senza originale contano nel totale", () => {
    const r = proposePairs([{ albumId: 1, photos: 100, folders: [...votes([[10, 15]]), ...Array(85).fill([])] }]);
    expect(r).toEqual([]);
  });

  it("servono almeno 3 foto in comune", () => {
    expect(proposePairs([{ albumId: 1, photos: 2, folders: votes([[10, 2]]) }])).toEqual([]);
  });

  it("una foto in due cartelle vota per entrambe, una volta sola per cartella", () => {
    const r = proposePairs([{ albumId: 1, photos: 4, folders: Array(4).fill([10, 10, 11]) }]);
    expect(r.map((p) => [p.folderId, p.shared])).toEqual([
      [10, 4],
      [11, 4],
    ]);
  });

  it("cartella contesa: va all'album con più foto in comune", () => {
    const r = proposePairs([
      { albumId: 1, photos: 106, folders: votes([[10, 106]]) },
      { albumId: 2, photos: 300, folders: votes([[10, 86], [11, 200]]) },
    ]);
    expect(r).toEqual([
      { googleId: 1, folderId: 10, shared: 106, photos: 106 },
      { googleId: 2, folderId: 11, shared: 200, photos: 300 },
    ]);
  });
});

describe("shotKey", () => {
  it("serve fotocamera e data", () => {
    expect(shotKey(null, new Date(0))).toBeNull();
    expect(shotKey(3, null)).toBeNull();
    expect(shotKey(3, new Date("2016-07-10T00:18:38Z"))).toBe("3|1468109918000");
  });
});

describe("folderSections", () => {
  const t = (s: string) => new Date(`${s}Z`);
  const album = [
    { id: 1, kind: "edit", camera_id: null, taken_at: t("2016-07-10T16:08:36"), raw_id: 100 }, // export rinominato
    { id: 2, kind: "edit", camera_id: 7, taken_at: t("2016-07-10T00:20:00"), raw_id: null }, // export con EXIF, senza CR2
    { id: 3, kind: "raw", camera_id: 7, taken_at: t("2016-07-10T00:30:00"), raw_id: null }, // già nell'album
  ];

  it("dietro a un export → fuori, il resto → Altri scatti, quelle già nell'album restano", () => {
    const folder = [
      { id: 100, kind: "raw", camera_id: 7, taken_at: t("2016-07-10T00:18:38"), raw_id: null },
      { id: 101, kind: "raw", camera_id: 7, taken_at: t("2016-07-10T00:20:00"), raw_id: null },
      { id: 102, kind: "edit", camera_id: 7, taken_at: t("2016-07-10T00:20:00"), raw_id: null },
      { id: 103, kind: "raw", camera_id: 7, taken_at: t("2016-07-10T00:25:00"), raw_id: null },
      { id: 104, kind: "edit", camera_id: 7, taken_at: t("2016-07-10T00:26:00"), raw_id: null },
      { id: 3, kind: "raw", camera_id: 7, taken_at: t("2016-07-10T00:30:00"), raw_id: null },
      { id: 103, kind: "raw", camera_id: 7, taken_at: t("2016-07-10T00:25:00"), raw_id: null },
    ];
    expect(folderSections(album, folder)).toEqual({
      behind: [100, 101, 102],
      extra: [103, 104],
      main: [],
      links: [{ exportId: 2, rawId: 101 }],
    });
  });

  it("raffica: due CR2 dello stesso istante, nessun collegamento", () => {
    const folder = [
      { id: 101, kind: "raw", camera_id: 7, taken_at: t("2016-07-10T00:20:00"), raw_id: null },
      { id: 105, kind: "raw", camera_id: 7, taken_at: t("2016-07-10T00:20:00"), raw_id: null },
    ];
    expect(folderSections(album, folder).links).toEqual([]);
  });
});

describe("promotedTitle", () => {
  it("mese-giorno sotto un anno → data completa", () => {
    expect(promotedTitle("2016", "07-10 compleanno catia")).toBe("2016-07-10 compleanno catia");
    expect(promotedTitle("2007", "12-15")).toBe("2007-12-15");
  });
  it("altri titoli: l'anno tra parentesi, se manca", () => {
    expect(promotedTitle("2017", "Battesimo Annalisa")).toBe("Battesimo Annalisa (2017)");
    expect(promotedTitle("2011", "carnevale venezia 2011")).toBe("carnevale venezia 2011");
  });
  it("genitore che non è un anno: titolo invariato", () => {
    expect(promotedTitle("Matrimonio", "Rachele")).toBe("Rachele");
    expect(promotedTitle(null, "03-20")).toBe("03-20");
  });
});

describe("cameraGroups", () => {
  it("stessa marca e modello, seriale diverso → stesso id", () => {
    const g = cameraGroups([
      { id: 18365, make: "Panasonic", model: "DC-G9" },
      { id: 17961, make: "Panasonic", model: "DC-G9" },
      { id: 1, make: "Canon", model: "Canon EOS 7D" },
    ]);
    expect(g.get(18365)).toBe(17961);
    expect(g.get(17961)).toBe(17961);
    expect(g.get(1)).toBe(1);
  });
});

describe("HashIndex", () => {
  const h = (hex: string) => parseHash(hex);
  it("trova l'immagine quasi uguale e scarta le raffiche", () => {
    const idx = new HashIndex<{ id: number; hash: ReturnType<typeof h> }>();
    idx.add({ id: 1, hash: h("431232667656e4e4") });
    idx.add({ id: 2, hash: h("e9899c5d9f4f66d6") });
    expect(idx.nearest(h("c3123266767664e4"))?.id).toBe(1); // 3 bit
    expect(idx.nearest(h("ffffffffffffffff"))).toBeNull();
    idx.add({ id: 3, hash: h("431232667656e4e5") }); // quasi identica alla 1
    expect(idx.nearest(h("c3123266767664e4"))).toBeNull();
  });
});

describe("folderSections con soli JPEG (2026-11-20)", () => {
  const t = (s: string) => new Date(`${s}Z`);
  it("copia Google ritagliata: resta in primo piano, collegata al JPEG della fotocamera", () => {
    const album = [
      { id: 1, kind: "edit", camera_id: 5, taken_at: t("2018-04-22T17:32:04"), raw_id: null, phash: "cace0eb396cbe9d0" },
    ];
    const folder = [
      { id: 10, kind: "edit", camera_id: 5, taken_at: t("2018-04-22T17:32:04"), raw_id: null, phash: "9382ce8693566930" },
      { id: 11, kind: "edit", camera_id: 5, taken_at: t("2018-04-22T17:40:00"), raw_id: null, phash: "0000000000000000" },
    ];
    expect(folderSections(album, folder)).toEqual({ behind: [10], extra: [11], main: [], links: [{ exportId: 1, rawId: 10 }] });
  });

  it("copia senza EXIF: riconosciuta dall'impronta", () => {
    const album = [{ id: 1, kind: "phone", camera_id: null, taken_at: t("2018-12-07T18:27:56"), raw_id: null, phash: "c3123266767664e4" }];
    const folder = [
      { id: 10, kind: "edit", camera_id: 5, taken_at: t("2018-12-06T22:59:03"), raw_id: null, phash: "431232667656e4e4" },
      { id: 11, kind: "edit", camera_id: 5, taken_at: t("2018-12-06T22:58:25"), raw_id: null, phash: "e9899c5d9f4f66d6" },
    ];
    expect(folderSections(album, folder)).toEqual({ behind: [10], extra: [11], main: [], links: [{ exportId: 1, rawId: 10 }] });
  });

  it("export Lightroom senza EXIF accanto a CR2+JPEG: collegato al CR2, il JPEG della fotocamera sta dietro", () => {
    const album = [{ id: 1, kind: "phone", camera_id: null, taken_at: t("2025-09-21T19:53:57"), raw_id: null, phash: "925332b373b2b3ab" }];
    const folder = [
      { id: 10, kind: "raw", camera_id: 1, taken_at: t("2025-09-13T13:04:03"), raw_id: null, phash: "925332b373b2b3ab" },
      { id: 11, kind: "edit", camera_id: 1, taken_at: t("2025-09-13T13:04:03"), raw_id: null, phash: "009273333232b232" },
    ];
    expect(folderSections(album, folder)).toEqual({ behind: [10, 11], extra: [], main: [], links: [{ exportId: 1, rawId: 10 }] });
  });
});

describe("fileStem", () => {
  it("toglie estensione e suffissi delle copie", () => {
    expect(fileStem("ADV_3459.CR2")).toBe("adv_3459");
    expect(fileStem("ADV_3459.jpg")).toBe("adv_3459");
    expect(fileStem("ADV_3459-modificato (1).jpg")).toBe("adv_3459");
    expect(fileStem(null)).toBeNull();
  });
});

describe("folderSections per nome del file (2026-11-20)", () => {
  const t = (s: string) => new Date(`${s}Z`);
  const ph = "0000000000000000";
  it("raffica Lumix: la copia Google senza EXIF si collega al JPEG con lo stesso nome", () => {
    const album = [{ id: 1, kind: "phone", camera_id: null, taken_at: t("2018-12-07T18:28:27"), raw_id: null, phash: "c7c73311111195a5", name: "P1022656.jpg" }];
    const folder = [
      { id: 10, kind: "edit", camera_id: 5, taken_at: t("2018-12-06T23:01:22"), raw_id: null, phash: "47e333131199b5a5", name: "P1022656.JPG" },
      { id: 11, kind: "edit", camera_id: 5, taken_at: t("2018-12-06T23:01:34"), raw_id: null, phash: "47432213111195a5", name: "P1022658.JPG" },
      { id: 12, kind: "edit", camera_id: 5, taken_at: t("2018-12-06T22:58:25"), raw_id: null, phash: ph, name: "P1022648.JPG" },
    ];
    expect(folderSections(album, folder)).toEqual({ behind: [10], extra: [11, 12], main: [], links: [{ exportId: 1, rawId: 10 }] });
  });

  it("export ritagliato con la data di caricamento: al CR2 con lo stesso nome; export della cartella in primo piano", () => {
    const album = [{ id: 1, kind: "phone", camera_id: null, taken_at: t("2025-09-21T19:53:57"), raw_id: null, phash: "925332b373b2b3ab", name: "ADV_3459.jpg" }];
    const folder = [
      { id: 10, kind: "raw", camera_id: 1, taken_at: t("2025-09-13T13:04:03"), raw_id: null, phash: "009253333232b232", name: "ADV_3459.CR2" },
      { id: 11, kind: "edit", camera_id: 1, taken_at: t("2025-09-13T13:04:03"), raw_id: null, phash: "009273333232b232", name: "ADV_3459.JPG" },
      { id: 20, kind: "raw", camera_id: 1, taken_at: t("2025-09-13T13:08:55"), raw_id: null, phash: "cbb7b27161626071", name: "ADV_3484.CR2" },
      { id: 21, kind: "edit", camera_id: 1, taken_at: t("2025-09-13T13:08:55"), raw_id: null, phash: "8bb7b27161626071", name: "ADV_3484.JPG" },
      { id: 22, kind: "phone", camera_id: null, taken_at: null, raw_id: null, phash: "ca36b27160626474", name: "ADV_3484.jpg" },
      { id: 30, kind: "raw", camera_id: 1, taken_at: t("2025-09-13T13:09:43"), raw_id: null, phash: "a829696964ec6064", name: "ADV_3487.CR2" },
      { id: 31, kind: "edit", camera_id: null, taken_at: null, raw_id: 30, phash: "a929696564e46066", name: "ADV_3487.jpg" },
      { id: 40, kind: "raw", camera_id: 1, taken_at: t("2025-09-13T15:55:25"), raw_id: null, phash: ph, name: "ADV_3497.CR2" },
      { id: 41, kind: "edit", camera_id: 1, taken_at: t("2025-09-13T15:55:25"), raw_id: null, phash: ph, name: "ADV_3497.JPG" },
    ];
    expect(folderSections(album, folder)).toEqual({
      behind: [10, 11, 20, 21, 30],
      extra: [40, 41],
      main: [22, 31],
      links: [
        { exportId: 1, rawId: 10 },
        { exportId: 22, rawId: 20 },
      ],
    });
  });

  it("stesso nome ma un'altra fotocamera (iPhone IMG_ e Canon IMG_): nessun collegamento", () => {
    const album = [{ id: 1, kind: "phone", camera_id: 9, taken_at: t("2020-01-01T10:00:00"), raw_id: null, phash: ph, name: "IMG_1234.jpg" }];
    const folder = [{ id: 10, kind: "raw", camera_id: 1, taken_at: t("2020-01-01T12:00:00"), raw_id: null, phash: "ffffffffffffffff", name: "IMG_1234.CR2" }];
    expect(folderSections(album, folder)).toEqual({ behind: [], extra: [10], main: [], links: [] });
  });
});
