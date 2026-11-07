import { describe, expect, it } from "vitest";
import { exifJson, exposureString, mimeFor, photoFields, romeLocalString } from "../scripts/import/metadata";
import { classifyKind, isValidStorageKey, normalizeSubsec, safeFilename, storageKeys } from "../src/lib/import-shared";
import { estimateRemainingMs, formatBytes, formatDuration } from "../src/lib/format";

const exifDate = (raw: string, extra = {}) => {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw)!;
  return { _ctor: "ExifDateTime", year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: +m[6], rawValue: raw, ...extra };
};

describe("photoFields", () => {
  it("CR2 Canon", () => {
    const f = photoFields({
      Make: "Canon",
      Model: "Canon EOS 7D",
      SerialNumber: 123456789,
      DateTimeOriginal: exifDate("2014:07:12 18:59:18"),
      SubSecTimeOriginal: "45",
      Orientation: 6,
      ImageSize: "5184x3456",
      LensModel: "EF-S17-55mm f/2.8 IS USM",
      FocalLength: "55.0 mm",
      FNumber: 2.8,
      ExposureTime: "1/250",
      ISO: 400,
    });
    expect(f).toMatchObject({
      takenAt: "2014-07-12 18:59:18",
      takenAtSubsec: 450,
      takenAtUtc: null,
      camera: { make: "Canon", model: "Canon EOS 7D", serial: "123456789" },
      focalLengthMm: 55,
      aperture: 2.8,
      exposureTime: "1/250",
      iso: 400,
      orientation: 6,
      width: 3456, // verticale: dimensioni scambiate
      height: 5184,
      gpsLat: null,
    });
  });

  it("telefono con fuso orario e GPS", () => {
    const f = photoFields({
      Make: "Apple",
      Model: "iPhone 15",
      DateTimeOriginal: "2023:08:01 10:00:00",
      OffsetTimeOriginal: "+02:00",
      GPSLatitude: 45.4642,
      GPSLongitude: 9.19,
    });
    expect(f.takenAt).toBe("2023-08-01 10:00:00");
    expect(f.takenAtUtc).toBe("2023-08-01T08:00:00.000Z");
    expect(f.camera).toEqual({ make: "Apple", model: "iPhone 15", serial: "" });
    expect(f.gpsLat).toBe(45.4642);
  });

  it("senza EXIF", () => {
    const f = photoFields({});
    expect(f.takenAt).toBeNull();
    expect(f.camera).toBeNull();
    expect(photoFields({ DateTimeOriginal: "0000:00:00 00:00:00" }).takenAt).toBeNull();
  });
});

describe("utilità EXIF", () => {
  it("tempi di esposizione", () => {
    expect(exposureString(0.004)).toBe("1/250");
    expect(exposureString(2)).toBe("2");
    expect(exposureString("1/60")).toBe("1/60");
  });
  it("sottosecondi in millisecondi", () => {
    expect(normalizeSubsec("45")).toBe(450);
    expect(normalizeSubsec("045")).toBe(45);
    expect(normalizeSubsec(7)).toBe(700);
    expect(normalizeSubsec("")).toBeNull();
  });
  it("ora di Roma da UTC (estate e inverno)", () => {
    expect(romeLocalString("2023-08-01T08:00:00Z")).toBe("2023-08-01 10:00:00");
    expect(romeLocalString("2023-12-01T08:00:00Z")).toBe("2023-12-01 09:00:00");
  });
  it("exifJson toglie binari e percorsi", () => {
    const j = exifJson({
      SourceFile: "/Users/a/x.CR2",
      PreviewImage: { _ctor: "BinaryField", bytes: 10 },
      DateTimeOriginal: exifDate("2014:07:12 18:59:18"),
      ISO: 100,
    });
    expect(j).toEqual({ DateTimeOriginal: "2014:07:12 18:59:18", ISO: 100 });
  });
  it("tipi di file", () => {
    expect(mimeFor("IMG_1.CR2")).toBe("image/x-canon-cr2");
    expect(mimeFor("a.HEIC")).toBe("image/heic");
    expect(mimeFor("a.txt")).toBeNull();
  });
});

describe("chiavi dell'archivio", () => {
  const sha = "a".repeat(64);
  it("deterministiche e leggibili", () => {
    expect(storageKeys(sha, "IMG_4821.CR2", "2014-07-12 18:59:18")).toEqual({
      original: `originals/2014/2014-07-12/aaaaaaaa_IMG_4821.CR2`,
      preview: `previews/aa/${sha}.jpg`,
      thumb: `thumbs/aa/${sha}.jpg`,
    });
    expect(storageKeys(sha, "x.jpg", null).original).toBe("originals/senza-data/aaaaaaaa_x.jpg");
  });
  it("nomi strani ripuliti, chiavi pericolose rifiutate", () => {
    expect(safeFilename("Città è bella (1).jpg")).toBe("Citta_e_bella_1_.jpg");
    expect(safeFilename("../../etc")).toBe("etc");
    expect(isValidStorageKey(storageKeys(sha, "../../x", null).original)).toBe(true);
    expect(isValidStorageKey("originals/../x")).toBe(false);
    expect(isValidStorageKey("/etc/passwd")).toBe(false);
    expect(isValidStorageKey("altro/x.jpg")).toBe(false);
    expect(() => storageKeys("zz", "a", null)).toThrow();
  });
});

describe("classifyKind", () => {
  it("CR2, export da fotocamera, telefono", () => {
    expect(classifyKind("cr2_disk", "image/x-canon-cr2", null)).toBe("raw");
    expect(classifyKind("google_takeout", "image/jpeg", { make: "Canon", model: "Canon EOS 7D", serial: "" })).toBe("edit");
    expect(classifyKind("google_takeout", "image/jpeg", { make: "Apple", model: "iPhone 15", serial: "" })).toBe("phone");
    expect(classifyKind("google_takeout", "image/jpeg", null)).toBe("phone");
  });
});

describe("formattazione", () => {
  it("byte e durate", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1_500_000)).toBe("1,5 MB");
    expect(formatBytes(1_000_000_000_000)).toBe("1,0 TB");
    expect(formatDuration(30_000)).toBe("meno di un minuto");
    expect(formatDuration(90 * 60_000)).toBe("1 h 30 min");
  });
  it("tempo stimato", () => {
    expect(estimateRemainingMs(50, 100, 60_000)).toBeCloseTo(60_000);
    expect(estimateRemainingMs(0, 100, 60_000)).toBeNull();
  });
});
