import { describe, expect, it } from "vitest";
import { compareAlbum, sortAlbumChecks, type AlbumCheck } from "../src/lib/takeout-check";
import { expectedFromEntries } from "../scripts/drive/check-rules";

describe("expectedFromEntries", () => {
  it("applica le regole dell'import: solo album, niente anni, cestino, WhatsApp e video", () => {
    const exp = expectedFromEntries([
      { fileName: "Takeout/Google Foto/Termoli/IMG_1.jpg", size: 10 },
      { fileName: "Takeout/Google Foto/Termoli/IMG_1.jpg.supplemental-metadata.json", size: 1 },
      { fileName: "Takeout/Google Foto/Termoli/metadati.json", size: 1 },
      { fileName: "Takeout/Google Foto/Termoli/VID_2.mp4", size: 99 },
      { fileName: "Takeout/Google Foto/Termoli(1)/IMG_3.HEIC", size: 20 },
      { fileName: "Takeout/Google Foto/Foto da 2015/IMG_4.jpg", size: 30 },
      { fileName: "Takeout/Google Foto/Cestino/IMG_5.jpg", size: 30 },
      { fileName: "Takeout/Google Foto/WhatsApp Images/IMG-20171221-WA0007.jpeg", size: 30 },
      { fileName: "Takeout/archive_browser.html", size: 5 },
      { fileName: "Takeout/Google Foto/", size: 0 },
    ]);
    expect([...exp.albums.keys()]).toEqual(["Termoli", "Termoli(1)"]);
    expect(exp.albums.get("Termoli")).toEqual({ files: [{ name: "IMG_1.jpg", size: 10 }], videos: 1 });
    expect(exp.outsideAlbums).toBe(3);
    expect(exp.videos).toBe(1);
    expect(exp.others).toBe(1);
  });
});

describe("compareAlbum", () => {
  it("abbina per nome e dimensione, poi il cestino, poi per sola dimensione", () => {
    const r = compareAlbum(
      [
        { name: "a.jpg", size: 1 },
        { name: "b.jpg", size: 2 },
        { name: "c.jpg", size: 3 }, // stessa foto già nell'archivio con un altro nome
        { name: "d.jpg", size: 4 }, // mancante
      ],
      [
        { name: "a.jpg", size: 1, trashed: false },
        { name: "b.jpg", size: 2, trashed: true },
        { name: "IMG_9.jpg", size: 3, trashed: false },
        { name: "altro.jpg", size: 7, trashed: false }, // aggiunta a mano
      ],
    );
    expect(r).toEqual({ expected: 4, found: 2, trashed: 1, missing: 1, missingNames: ["d.jpg"], extra: 1 });
  });

  it("con l'album assente tutto è mancante", () => {
    const r = compareAlbum([{ name: "a.jpg", size: 1 }], []);
    expect(r.missing).toBe(1);
    expect(r.found).toBe(0);
  });

  it("due copie identiche nello zip contano due volte", () => {
    const r = compareAlbum(
      [
        { name: "a.jpg", size: 1 },
        { name: "a(1).jpg", size: 1 },
      ],
      [{ name: "a.jpg", size: 1, trashed: false }],
    );
    expect(r.found).toBe(1);
    expect(r.missing).toBe(1);
  });
});

describe("sortAlbumChecks", () => {
  const album = (ref: string, missing: number, albumState: AlbumCheck["albumState"] = "ok"): AlbumCheck => ({
    ref,
    title: ref,
    albumState,
    expected: 5,
    found: 5 - missing,
    trashed: 0,
    missing,
    missingNames: [],
    extra: 0,
    videos: 0,
  });

  it("mette prima gli album con problemi", () => {
    const sorted = sortAlbumChecks([album("B", 0), album("A", 0), album("C", 1), album("D", 3), album("E", 0, "cestino")]);
    expect(sorted.map((a) => a.ref)).toEqual(["D", "C", "E", "A", "B"]);
  });
});
