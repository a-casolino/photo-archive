import { describe, expect, it } from "vitest";
import { albumSummary, looseAlbum, planUpload, uploadLabel, type PickedFile } from "../src/lib/upload/plan";
import { diskAlbum } from "../scripts/import/scan";

const pick = (path: string, size = 10): PickedFile => ({ file: new File([new Uint8Array(size)], path.split("/").pop()!), path });

describe("planUpload", () => {
  it("cartelle come nel programma di import, file sciolti senza album", () => {
    const plan = planUpload([
      pick("Viaggi/IMG_1.CR2"),
      pick("Viaggi/2019/Roma/IMG_2.CR2"),
      pick("Viaggi/2019/Roma/giorno 2/sera/IMG_3.JPG"),
      pick("telefono.jpg"),
    ]);
    expect(plan.roots).toEqual(["Viaggi"]);
    const byName = Object.fromEntries(plan.items.map((i) => [i.name, i]));
    expect(byName["IMG_1.CR2"].album).toEqual(diskAlbum("Viaggi", ""));
    expect(byName["IMG_2.CR2"].album).toEqual(diskAlbum("Viaggi", "2019/Roma"));
    // Oltre il terzo livello il resto del percorso va nel titolo.
    expect(byName["IMG_3.JPG"].album).toMatchObject({ title: "Roma › giorno 2 › sera", parents: [{ title: "Viaggi" }, { title: "2019" }] });
    expect(byName["IMG_3.JPG"].mime).toBe("image/jpeg");
    expect(byName["telefono.jpg"]).toMatchObject({ loose: true, album: null });
  });

  it("salta video, file sconosciuti e file di sistema; un file scelto due volte conta una volta", () => {
    const plan = planUpload([
      pick("A/video.MOV"),
      pick("A/IMG_1.xmp"),
      pick("A/.DS_Store"),
      pick("A/$RECYCLE.BIN/x.jpg"),
      pick("A/Thumbs.db"),
      pick("A/IMG_1.CR2"),
      pick("A/IMG_1.CR2"),
      pick("A\\sotto\\IMG_2.png"),
    ]);
    expect(plan.skipped).toEqual({ video: 1, other: 1, system: 3 });
    expect(plan.items.map((i) => i.path)).toEqual(["A/IMG_1.CR2", "A/sotto/IMG_2.png"]);
  });
});

describe("albumSummary", () => {
  it("albero in ordine, con i titoli veri anche oltre il terzo livello", () => {
    const plan = planUpload([
      pick("Viaggi/IMG_1.CR2", 100),
      pick("Viaggi/2019/Roma/giorno 2/IMG_3.CR2", 5),
      pick("Viaggi/2019/Roma/IMG_2.CR2", 7),
      pick("Altro/IMG_9.jpg", 1),
    ]);
    const s = albumSummary(plan.items);
    expect(s.map((a) => [a.title, a.depth, a.files])).toEqual([
      ["Altro", 1, 1],
      ["Viaggi", 1, 1],
      ["2019", 2, 0],
      ["Roma", 3, 1],
      ["Roma › giorno 2", 3, 1],
    ]);
  });
});

describe("looseAlbum e uploadLabel", () => {
  it("album per i file sciolti, vuoto = nessuno", () => {
    expect(looseAlbum("  Caricate oggi ")).toEqual({ origin: "disk_folder", ref: "browser/Caricate oggi", title: "Caricate oggi" });
    expect(looseAlbum("   ")).toBeNull();
  });

  it("etichetta leggibile nella pagina Import", () => {
    expect(uploadLabel(["Viaggi"], 0)).toBe("Browser · Viaggi");
    expect(uploadLabel(["A", "B", "C", "D", "E"], 1)).toBe("Browser · A, B, C, altre 2, 1 foto sciolta");
    expect(uploadLabel([], 12)).toBe("Browser · 12 foto sciolte");
    expect(uploadLabel(["Roma"], 2, "Viaggi")).toBe("Browser · Roma, 2 foto sciolte in «Viaggi»");
  });
});

describe("planUpload dentro un album aperto", () => {
  const into = (levels: number) => ({ publicId: "A".repeat(22), title: "Viaggi", levels });
  const base = "album/" + "A".repeat(22);

  it("le foto sciolte vanno nell'album, le cartelle diventano suoi sotto-album", () => {
    const plan = planUpload([pick("sciolta.jpg"), pick("Roma/IMG_1.CR2"), pick("Roma/giorno 2/IMG_2.CR2")], into(2));
    const byName = Object.fromEntries(plan.items.map((i) => [i.name, i]));
    expect(byName["sciolta.jpg"]).toMatchObject({ loose: true, album: null });
    expect(byName["IMG_1.CR2"].album).toEqual({ origin: "disk_folder", ref: `${base}/Roma`, title: "Roma" });
    expect(byName["IMG_2.CR2"].album).toEqual({
      origin: "disk_folder",
      ref: `${base}/Roma/giorno 2`,
      title: "giorno 2",
      parents: [{ ref: `${base}/Roma`, title: "Roma" }],
    });
    expect(albumSummary(plan.items).map((a) => [a.title, a.depth, a.files])).toEqual([
      ["Roma", 1, 1],
      ["giorno 2", 2, 1],
    ]);
  });

  it("con un solo livello libero il percorso va nel titolo; con nessuno tutto nell'album", () => {
    const one = planUpload([pick("Roma/giorno 2/IMG_2.CR2")], into(1));
    expect(one.items[0].album).toEqual({ origin: "disk_folder", ref: `${base}/Roma/giorno 2`, title: "Roma › giorno 2" });
    const none = planUpload([pick("Roma/giorno 2/IMG_2.CR2")], into(0));
    expect(none.items[0]).toMatchObject({ loose: false, album: null });
  });
});
