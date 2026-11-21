import { describe, expect, it } from "vitest";
import { eventSides, folderSections } from "../src/lib/album-pair-rules";

const t = (s: string) => new Date(`2026-11-15T${s}Z`);
const photo = (id: number, kind: string, path: string, at: string | null, raw_id: number | null = null) => ({
  id,
  kind,
  path,
  name: path.split("/").pop()!,
  camera_id: 7,
  taken_at: at ? t(at) : null,
  raw_id,
});

describe("album di un evento", () => {
  it("export in primo piano, CR2 collegati dietro, gli altri CR2 negli Altri scatti", () => {
    const photos = [
      photo(1, "raw", "Scatti/IMG_0001.CR2", "10:00:00"),
      photo(2, "raw", "Scatti/IMG_0002.CR2", "10:00:05"),
      photo(3, "raw", "Scatti/IMG_0003.CR2", "10:00:09"),
      photo(10, "edit", "Lavorate/IMG_0001.jpg", "10:00:00", 1),
      photo(11, "edit", "Lavorate/IMG_0003.jpg", "10:00:09", 3),
    ];
    const sides = eventSides(photos)!;
    expect(sides.exports.map((p) => p.id)).toEqual([10, 11]);
    expect(sides.camera.map((p) => p.id)).toEqual([1, 2, 3]);
    const s = folderSections(sides.exports, sides.camera);
    expect(s.behind.sort()).toEqual([1, 3]);
    expect(s.extra).toEqual([2]);
    expect(s.links).toEqual([]);
  });

  it("il JPEG della fotocamera accanto al CR2 non è un export", () => {
    const photos = [
      photo(1, "raw", "Scatti/IMG_0001.CR2", "10:00:00"),
      photo(2, "edit", "Scatti/IMG_0001.JPG", "10:00:00"),
      photo(10, "edit", "Lavorate/altro nome.jpg", "11:00:00"),
    ];
    const sides = eventSides(photos)!;
    expect(sides.exports.map((p) => p.id)).toEqual([10]);
    expect(sides.camera.map((p) => p.id)).toEqual([1, 2]);
    expect(folderSections(sides.exports, sides.camera).extra.sort()).toEqual([1, 2]);
  });

  it("l'export non ancora collegato si collega al CR2 dello stesso scatto", () => {
    const photos = [photo(1, "raw", "Scatti/IMG_0001.CR2", "10:00:00"), photo(10, "edit", "Lavorate/x.jpg", "10:00:00")];
    const sides = eventSides(photos)!;
    const s = folderSections(sides.exports, sides.camera);
    expect(s.links).toEqual([{ exportId: 10, rawId: 1 }]);
    expect(s.behind).toEqual([1]);
  });

  it("senza export l'album resta com'è", () => {
    expect(eventSides([photo(1, "raw", "IMG_0001.CR2", "10:00:00")])).toBeNull();
  });
});
