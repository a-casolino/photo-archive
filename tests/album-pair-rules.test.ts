import { describe, expect, it } from "vitest";
import { folderSections, proposePairs, shotKey } from "../src/lib/album-pair-rules";

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
    { id: 2, kind: "edit", camera_id: 7, taken_at: t("2016-07-10T00:20:00"), raw_id: null }, // export con EXIF
    { id: 3, kind: "raw", camera_id: 7, taken_at: t("2016-07-10T00:30:00"), raw_id: null }, // già nell'album
  ];

  it("dietro a un export → source, il resto → extra, quelle già nell'album restano", () => {
    const folder = [
      { id: 100, kind: "raw", camera_id: 7, taken_at: t("2016-07-10T00:18:38"), raw_id: null },
      { id: 101, kind: "raw", camera_id: 7, taken_at: t("2016-07-10T00:20:00"), raw_id: null },
      { id: 102, kind: "edit", camera_id: 7, taken_at: t("2016-07-10T00:20:00"), raw_id: null },
      { id: 103, kind: "raw", camera_id: 7, taken_at: t("2016-07-10T00:25:00"), raw_id: null },
      { id: 104, kind: "edit", camera_id: 7, taken_at: t("2016-07-10T00:26:00"), raw_id: null },
      { id: 3, kind: "raw", camera_id: 7, taken_at: t("2016-07-10T00:30:00"), raw_id: null },
      { id: 103, kind: "raw", camera_id: 7, taken_at: t("2016-07-10T00:25:00"), raw_id: null },
    ];
    expect(folderSections(album, folder)).toEqual({ source: [100, 101, 102], extra: [103, 104] });
  });
});
