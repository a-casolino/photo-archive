import { describe, expect, it } from "vitest";
import { albumMetadataFile, findSidecar, isNonAlbumFolder, parseSidecar } from "../scripts/import/takeout";

describe("findSidecar", () => {
  it("nome esatto", () => {
    expect(findSidecar("IMG_1234.JPG", ["IMG_1234.JPG.json", "metadata.json"])).toBe("IMG_1234.JPG.json");
  });
  it("supplemental-metadata, intero e troncato", () => {
    expect(findSidecar("IMG_1.jpg", ["IMG_1.jpg.supplemental-metadata.json"])).toBe("IMG_1.jpg.supplemental-metadata.json");
    expect(findSidecar("PXL_20230101_120000123.jpg", ["PXL_20230101_120000123.jpg.supplemental-me.json"])).toBe(
      "PXL_20230101_120000123.jpg.supplemental-me.json",
    );
  });
  it("duplicati con (1)", () => {
    const jsons = ["IMG_1.jpg.json", "IMG_1.jpg(1).json"];
    expect(findSidecar("IMG_1(1).jpg", jsons)).toBe("IMG_1.jpg(1).json");
    expect(findSidecar("IMG_1.jpg", jsons)).toBe("IMG_1.jpg.json");
    expect(findSidecar("IMG_2(1).jpg", ["IMG_2.jpg.supplemental-metadata(1).json"])).toBe(
      "IMG_2.jpg.supplemental-metadata(1).json",
    );
  });
  it("versione modificata usa il JSON dell'originale", () => {
    expect(findSidecar("IMG_1-modificato.jpg", ["IMG_1.jpg.json"])).toBe("IMG_1.jpg.json");
    expect(findSidecar("IMG_1-edited.jpg", ["IMG_1.jpg.supplemental-metadata.json"])).toBe(
      "IMG_1.jpg.supplemental-metadata.json",
    );
  });
  it("nome del file troncato", () => {
    const name = "Screenshot_20230101-120000_WhatsApp_lungo.jpg";
    expect(findSidecar(name, ["Screenshot_20230101-120000_Wha.json"])).toBe("Screenshot_20230101-120000_Wha.json");
  });
  it("niente JSON", () => {
    expect(findSidecar("IMG_9.jpg", ["IMG_1.jpg.json", "metadata.json"])).toBeNull();
  });
});

describe("parseSidecar", () => {
  it("legge data, descrizione, posizione e link", () => {
    const s = parseSidecar({
      description: " Tramonto ",
      url: "https://photos.google.com/photo/abc",
      photoTakenTime: { timestamp: "1700000000" },
      geoData: { latitude: 0, longitude: 0 },
      geoDataExif: { latitude: 45.1, longitude: 9.2 },
    });
    expect(s).toEqual({
      takenAtUtc: "2023-11-14T22:13:20.000Z",
      description: "Tramonto",
      googlePhotosUrl: "https://photos.google.com/photo/abc",
      gpsLat: 45.1,
      gpsLon: 9.2,
    });
  });
  it("posizione 0,0 = assente", () => {
    expect(parseSidecar({ geoData: { latitude: 0, longitude: 0 } }).gpsLat).toBeNull();
  });
});

describe("isNonAlbumFolder", () => {
  it("riconosce cartelle degli anni e cestino", () => {
    expect(isNonAlbumFolder("Photos from 2019")).toBe(true);
    expect(isNonAlbumFolder("Foto dal 2019")).toBe(true);
    expect(isNonAlbumFolder("Foto da 2025")).toBe(true);
    expect(isNonAlbumFolder("Stoccolma Capodanno 2015")).toBe(false);
    expect(isNonAlbumFolder("Cestino")).toBe(true);
    expect(isNonAlbumFolder("Matrimonio Luca")).toBe(false);
  });
});

describe("albumMetadataFile", () => {
  it("riconosce il file dell'album anche in italiano", () => {
    expect(albumMetadataFile(["IMG_1.jpg", "metadata.json"])).toBe("metadata.json");
    expect(albumMetadataFile(["IMG_1.jpg", "IMG_1.jpg.json", "metadati.json"])).toBe("metadati.json");
    expect(albumMetadataFile(["IMG_1.jpg", "IMG_1.jpg.json"])).toBeNull();
  });
});
