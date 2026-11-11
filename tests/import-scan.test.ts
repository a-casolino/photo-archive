import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diskAlbum, scan } from "../scripts/import/scan";

describe("scan del disco", () => {
  it("mette in un album anche i CR2 direttamente nella cartella scelta", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "pa-scan-"));
    const root = path.join(base, "panciona");
    await mkdir(path.join(root, "Mare"), { recursive: true });
    await writeFile(path.join(root, "IMG_0001.CR2"), "x");
    await writeFile(path.join(root, "Mare", "IMG_0002.CR2"), "x");
    await writeFile(path.join(root, "Mare", "IMG_0002.jpg"), "x");
    await writeFile(path.join(root, "note.txt"), "x");

    const { files, ignored } = await scan(root, "cr2_disk", { albums: true });
    // Anche i JPG entrano; gli altri file no.
    expect(files.map((f) => f.name).sort()).toEqual(["IMG_0001.CR2", "IMG_0002.CR2", "IMG_0002.jpg"]);
    expect(files.find((f) => f.name === "IMG_0002.jpg")?.mime).toBe("image/jpeg");
    expect(ignored).toBe(1);
    const byName = Object.fromEntries(files.map((f) => [f.name, f.album]));
    expect(byName["IMG_0001.CR2"]).toEqual({ origin: "disk_folder", ref: "panciona", title: "panciona" });
    // Le sottocartelle diventano sotto-album della cartella scelta.
    expect(byName["IMG_0002.CR2"]).toEqual({
      origin: "disk_folder",
      ref: "Mare",
      title: "Mare",
      parents: [{ ref: "panciona", title: "panciona" }],
    });

    const senza = await scan(root, "cr2_disk", { albums: false });
    expect(senza.files.every((f) => f.album === null)).toBe(true);
  });
});

describe("album delle cartelle del disco (sotto-album)", () => {
  it("costruisce i livelli dalla cartella scelta, con i riferimenti di sempre", () => {
    expect(diskAlbum("Foto", "")).toEqual({ origin: "disk_folder", ref: "Foto", title: "Foto" });
    expect(diskAlbum("Foto", "Viaggi/Roma")).toEqual({
      origin: "disk_folder",
      ref: "Viaggi/Roma",
      title: "Roma",
      parents: [
        { ref: "Foto", title: "Foto" },
        { ref: "Viaggi", title: "Viaggi" },
      ],
    });
  });

  it("oltre il terzo livello resta nel terzo, con il percorso nel titolo", () => {
    expect(diskAlbum("Foto", "Viaggi/Roma/Giorno 1")).toEqual({
      origin: "disk_folder",
      ref: "Viaggi/Roma/Giorno 1",
      title: "Roma › Giorno 1",
      parents: [
        { ref: "Foto", title: "Foto" },
        { ref: "Viaggi", title: "Viaggi" },
      ],
    });
  });

  it("dalla radice di un disco (senza nome) il primo livello è la prima cartella", () => {
    expect(diskAlbum("", "2019/Roma/Giorno 1")).toEqual({
      origin: "disk_folder",
      ref: "2019/Roma/Giorno 1",
      title: "Giorno 1",
      parents: [
        { ref: "2019", title: "2019" },
        { ref: "2019/Roma", title: "Roma" },
      ],
    });
  });
});

describe("scan di Takeout", () => {
  it("riconosce gli album di un Takeout in italiano", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pa-takeout-"));
    const foto = path.join(root, "Takeout", "Google Foto");
    await mkdir(path.join(foto, "Stoccolma Capodanno 2015"), { recursive: true });
    await mkdir(path.join(foto, "Termoli(1)"), { recursive: true });
    await mkdir(path.join(foto, "Foto da 2015"), { recursive: true });
    await writeFile(path.join(foto, "Stoccolma Capodanno 2015", "IMG_1.jpg"), "x");
    await writeFile(path.join(foto, "Stoccolma Capodanno 2015", "metadati.json"), JSON.stringify({ title: "Stoccolma!" }));
    await writeFile(path.join(foto, "Termoli(1)", "IMG_2.jpg"), "x");
    await writeFile(path.join(foto, "Foto da 2015", "IMG_3.jpg"), "x");
    const { files } = await scan(root, "google_takeout", { albums: true });
    const byName = Object.fromEntries(files.map((f) => [f.name, f.album]));
    expect(byName["IMG_1.jpg"]).toEqual({ origin: "google_photos", ref: "Stoccolma Capodanno 2015", title: "Stoccolma!" });
    expect(byName["IMG_2.jpg"]).toEqual({ origin: "google_photos", ref: "Termoli(1)", title: "Termoli(1)" });
    expect(byName["IMG_3.jpg"]).toBeNull();
  });
});
