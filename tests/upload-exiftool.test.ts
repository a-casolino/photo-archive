import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseMetadata } from "@uswriting/exiftool";
import { ExifTool } from "exiftool-vendored";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { photoFields } from "../src/lib/photo-metadata";
import { EXIFTOOL_ARGS } from "../src/lib/upload/worker-protocol";

// La pagina "Carica dal browser" legge i tag con ExifTool in WebAssembly, il
// programma di import con exiftool-vendored: gli stessi argomenti devono
// dare gli stessi campi (data, fotocamera e seriale, GPS, orientamento…),
// altrimenti doppioni e collegamenti export → CR2 non si troverebbero.

const et = new ExifTool();
afterAll(() => et.end());

describe("ExifTool nel browser come nel programma di import", () => {
  it("stessi campi per un JPEG con EXIF di fotocamera e GPS", { timeout: 60_000 }, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pa-exif-"));
    try {
      const file = path.join(dir, "IMG_0001.jpg");
      await writeFile(file, await sharp({ create: { width: 64, height: 48, channels: 3, background: "#888" } }).jpeg().toBuffer());
      await et.write(
        file,
        {
          Make: "Canon",
          Model: "Canon EOS 7D",
          SerialNumber: "0420301234",
          DateTimeOriginal: "2019:05:03 10:00:03",
          SubSecTimeOriginal: "45",
          OffsetTimeOriginal: "+02:00",
          ExposureTime: 0.004,
          FNumber: 5.6,
          ISO: 400,
          FocalLength: 35,
          LensModel: "EF-S17-55mm f/2.8 IS USM",
          Orientation: 6,
        } as never,
        { writeArgs: ["-overwrite_original", "-n"] },
      );
      await et.write(file, { GPSLatitude: 41.9028, GPSLatitudeRef: "N", GPSLongitude: 12.4964, GPSLongitudeRef: "E" } as never, {
        writeArgs: ["-overwrite_original"],
      });
      const vendored = photoFields((await et.read(file)) as never);
      const wasm = await parseMetadata<Record<string, unknown>[]>(
        { name: "foto.jpg", data: new Uint8Array(await readFile(file)) },
        { args: EXIFTOOL_ARGS, transform: (d) => JSON.parse(d) },
      );
      expect(wasm.success).toBe(true);
      const browser = photoFields(wasm.data![0]);
      expect(browser).toEqual(vendored);
      expect(browser).toMatchObject({
        takenAt: "2019-05-03 10:00:03",
        takenAtSubsec: 450,
        takenAtUtc: "2019-05-03T08:00:03.000Z",
        camera: { make: "Canon", model: "Canon EOS 7D", serial: "0420301234" },
        orientation: 6,
        gpsLat: 41.9028,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
