import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scan } from "../scripts/import/scan";

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
    expect(byName["IMG_0002.CR2"]).toEqual({ origin: "disk_folder", ref: "Mare", title: "Mare" });

    const senza = await scan(root, "cr2_disk", { albums: false });
    expect(senza.files.every((f) => f.album === null)).toBe(true);
  });
});
