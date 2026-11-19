import { describe, expect, it } from "vitest";
import {
  cleanMake,
  deviceFilterSql,
  deviceKind,
  deviceLabel,
  deviceOptions,
  parseDeviceFilter,
  type CameraRow,
} from "../src/lib/device-rules";

const cam = (id: number, make: string, model: string, serial = "", display_name: string | null = null): CameraRow => ({
  id,
  make,
  model,
  serial,
  display_name,
});

describe("filtro per dispositivo", () => {
  it("distingue fotocamere e telefoni", () => {
    expect(deviceKind("Canon", "Canon EOS 7D")).toBe("camera");
    expect(deviceKind("NIKON CORPORATION", "NIKON D750")).toBe("camera");
    expect(deviceKind("GoPro", "HERO9 Black")).toBe("camera");
    expect(deviceKind("Apple", "iPhone 12")).toBe("phone");
    expect(deviceKind("samsung", "SM-G991B")).toBe("phone");
    expect(deviceKind("HUAWEI", "ELE-L29")).toBe("phone");
    expect(deviceKind("Google", "Pixel 7")).toBe("phone");
    expect(deviceKind("Sony", "ILCE-7M3")).toBe("camera");
    expect(deviceKind("Sony", "DSC-RX100M5")).toBe("camera");
    expect(deviceKind("Sony", "G8341")).toBe("phone");
  });

  it("nomi leggibili", () => {
    expect(cleanMake("NIKON CORPORATION")).toBe("Nikon");
    expect(cleanMake("OLYMPUS IMAGING CORP.")).toBe("Olympus");
    expect(cleanMake("Canon")).toBe("Canon");
    expect(deviceLabel("Canon", "Canon EOS 7D")).toBe("Canon EOS 7D");
    expect(deviceLabel("Apple", "iPhone 12")).toBe("Apple iPhone 12");
    expect(deviceLabel("samsung", "SM-G991B")).toBe("Samsung SM-G991B");
    expect(deviceLabel("SAMSUNG", "SM-G991B")).toBe("Samsung SM-G991B");
  });

  it("un modello con più seriali è una voce sola; prima le fotocamere", () => {
    const opts = deviceOptions([
      cam(3, "Apple", "iPhone 12"),
      cam(1, "Canon", "Canon EOS 7D", "123"),
      cam(2, "Canon", "Canon EOS 7D", "456"),
      cam(4, "Canon", "Canon EOS 5D Mark II", "9", "La 5D di papà"),
    ]);
    expect(opts.map((o) => [o.slug, o.label, o.kind, o.cameraIds])).toEqual([
      ["canon-eos-7d", "Canon EOS 7D", "camera", [1, 2]],
      ["canon-eos-5d-mark-ii", "La 5D di papà", "camera", [4]],
      ["apple-iphone-12", "Apple iPhone 12", "phone", [3]],
    ]);
  });

  it("dal parametro dell'URL alla condizione SQL", () => {
    const opts = deviceOptions([cam(1, "Canon", "Canon EOS 7D", "1"), cam(2, "Apple", "iPhone 12"), cam(5, "Apple", "iPhone 8")]);
    const phones = parseDeviceFilter("telefoni", opts)!;
    expect(phones.label).toBe("Telefoni");
    expect(deviceFilterSql("p.camera_id", phones)).toEqual({ sql: "p.camera_id IN (?, ?)", params: [5, 2] });
    expect(deviceFilterSql("p.camera_id", parseDeviceFilter("fotocamere", opts)!).params).toEqual([1]);
    expect(deviceFilterSql("c", parseDeviceFilter("sconosciuto", opts)!)).toEqual({ sql: "c IS NULL", params: [] });
    expect(parseDeviceFilter("canon-eos-7d", opts)?.cameraIds).toEqual([1]);
    expect(parseDeviceFilter("nikon-d750", opts)).toBeUndefined();
    expect(parseDeviceFilter(undefined, opts)).toBeUndefined();
    expect(deviceFilterSql("c", parseDeviceFilter("fotocamere", [])!)).toEqual({ sql: "FALSE", params: [] });
  });
});
