import { describe, expect, it } from "vitest";
import { tagsForSql, updatedColumns } from "../src/lib/cache-rules";

describe("tagsForSql", () => {
  it("le letture non svuotano niente", () => {
    expect(tagsForSql("SELECT * FROM photos")).toEqual([]);
    expect(tagsForSql("  \n SELECT 1")).toEqual([]);
  });
  it("tabelle degli album e dei volti", () => {
    expect(tagsForSql("INSERT INTO album_photos (album_id, photo_id) VALUES (?, ?)")).toEqual(["album"]);
    expect(tagsForSql("INSERT IGNORE INTO album_tags SET album_id = ?")).toEqual(["album"]);
    expect(tagsForSql("UPDATE albums SET title = ? WHERE id = ?")).toEqual(["album"]);
    expect(tagsForSql("UPDATE faces SET status = 'confirmed' WHERE id IN (?)")).toEqual(["volti"]);
    expect(tagsForSql("DELETE FROM people WHERE id = ?")).toEqual(["volti"]);
    expect(tagsForSql("DELETE f FROM faces f JOIN photos p ON p.id = f.photo_id")).toEqual(["volti"]);
  });
  it("le foto toccano album e volti", () => {
    expect(tagsForSql("UPDATE photos SET deleted_at = UTC_TIMESTAMP() WHERE id IN (?)")).toEqual(["album", "volti"]);
    expect(tagsForSql("INSERT INTO photos (public_id) VALUES (?)")).toEqual(["album", "volti"]);
  });
  it("impronte e luoghi non svuotano niente, la scansione dei volti solo i volti", () => {
    expect(tagsForSql("UPDATE photos SET place_name = ? WHERE id IN (?)")).toEqual([]);
    expect(
      tagsForSql(`UPDATE photos p JOIN (SELECT ? AS id, ? AS h UNION ALL SELECT ?, ?) v ON v.id = p.id
          SET p.phash = v.h`),
    ).toEqual([]);
    expect(tagsForSql("UPDATE photos SET faces_scanned_at = UTC_TIMESTAMP(), faces_model = ? WHERE id = ?")).toEqual([
      "volti",
    ]);
    // Collegamento export → CR2: cambia la copertina mostrata, quindi anche gli album.
    expect(
      tagsForSql(`UPDATE photos p JOIN (SELECT ? AS eid, ? AS rid) m ON m.eid = p.id
          SET p.kind = 'edit', p.derived_from_id = m.rid, p.match_status = 'auto', p.match_method = 'pixel'`),
    ).toEqual(["album", "volti"]);
  });
  it("tabelle che non c'entrano con la cache", () => {
    expect(tagsForSql("UPDATE sessions SET last_seen_at = ? WHERE id = ?")).toEqual([]);
    expect(tagsForSql("INSERT INTO shares (public_id) VALUES (?)")).toEqual([]);
    expect(tagsForSql("UPDATE drive_imports SET status = 'queued'")).toEqual([]);
  });
});

describe("updatedColumns", () => {
  it("legge le colonne anche con funzioni e alias", () => {
    expect(updatedColumns("UPDATE photos SET a = COALESCE(b, c), p.d = ? WHERE id = 1")).toEqual(["a", "d"]);
  });
  it("con una sottoquery nella SET considera tutte le colonne", () => {
    expect(updatedColumns("UPDATE albums SET photo_count = (SELECT COUNT(*) FROM album_photos) WHERE id = 1")).toEqual([]);
  });
});
