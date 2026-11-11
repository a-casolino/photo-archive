import { describe, expect, it } from "vitest";
import {
  countryName,
  parseAdmin1,
  parseCities,
  parseItalianNames,
  parsePlaces,
  PlaceIndex,
  placeLabel,
  serializePlaces,
} from "../src/lib/place-rules";

// Righe nel formato dei file di GeoNames (accorciate dove non servono).
const city = (id: string, name: string, lat: number, lon: number, feature: string, cc: string, admin1: string) =>
  [id, name, name, "", lat, lon, "P", feature, cc, "", admin1, "", "", "", "1000", "", "0", "Europe/Rome", "2024-01-01"].join(
    "\t",
  );

const CITIES = [
  city("3169070", "Rome", 41.89193, 12.51133, "PPLC", "IT", "07"),
  city("3170102", "Positano", 40.62829, 14.48427, "PPL", "IT", "04"),
  city("6545158", "Trastevere", 41.8883, 12.4699, "PPLX", "IT", "07"),
  city("2988507", "Paris", 48.85341, 2.3488, "PPLC", "FR", "11"),
  city("2993458", "Monaco", 43.73333, 7.41667, "PPLC", "MC", "00"),
].join("\n");

const ADMIN1 = [
  "IT.07\tLatium\tLatium\t3174976",
  "IT.04\tCampania\tCampania\t3181042",
  "FR.11\tÎle-de-France\tIle-de-France\t3012874",
  "MC.00\tMonaco\tMonaco\t2993457",
].join("\n");

const ALT = [
  "1\t3169070\ten\tRome\t1\t\t\t\t\t",
  "2\t3169070\tit\tRomae\t\t\t\t1\t\t", // storico: scartato
  "3\t3169070\tit\tRoma\t1\t\t\t\t\t",
  "4\t3174976\tit\tLazio\t\t\t\t\t\t",
].join("\n");

describe("place-rules", () => {
  const admin1 = parseAdmin1(ADMIN1);
  const italian = parseItalianNames(ALT);
  const places = parseCities(CITIES, admin1, italian);

  it("usa i nomi italiani e salta i quartieri", () => {
    expect(places.map((p) => p.label)).toEqual([
      "Roma, Lazio, Italia",
      "Positano, Campania, Italia",
      "Paris, Île-de-France, Francia",
      "Monaco",
    ]);
  });

  it("nomi dei paesi in italiano e parti non ripetute", () => {
    expect(countryName("DE")).toBe("Germania");
    expect(placeLabel("Monaco", "Monaco", "Monaco")).toBe("Monaco");
    expect(placeLabel("Roma", "", "Italia")).toBe("Roma, Italia");
  });

  it("trova la località più vicina entro 50 km", () => {
    const index = new PlaceIndex(parsePlaces(serializePlaces(places)));
    expect(index.size).toBe(4);
    // Piazza Navona: vicino a Roma (Trastevere è escluso).
    expect(index.nearest(41.8992, 12.4731)?.label).toBe("Roma, Lazio, Italia");
    // Spiaggia Grande di Positano.
    expect(index.nearest(40.6281, 14.4857)?.label).toBe("Positano, Campania, Italia");
    // In mezzo al Tirreno: niente.
    expect(index.nearest(40.0, 12.0)).toBeNull();
  });

  it("cerca anche nelle celle vicine", () => {
    const index = new PlaceIndex([{ lat: 45.01, lon: 9.99, label: "A" }]);
    expect(index.nearest(44.99, 10.01)?.label).toBe("A");
  });
});
