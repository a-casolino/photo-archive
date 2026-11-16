import { describe, expect, it } from "vitest";
import { exportGapLabel, matchByName, nameStem } from "../src/lib/match-rules";

const d = (s: string) => new Date(`${s}Z`);

describe("nameStem", () => {
  it("toglie estensione, maiuscole e suffissi di modifica o copia", () => {
    expect(nameStem("ADV_1626.jpg")).toBe("adv_1626");
    expect(nameStem("ADV_1626.CR2")).toBe("adv_1626");
    expect(nameStem("IMG_0178-edit.jpg")).toBe("img_0178");
    expect(nameStem("IMG_0178_Edit.JPG")).toBe("img_0178");
    expect(nameStem("IMG_0178 edited.jpg")).toBe("img_0178");
    expect(nameStem("IMG_0178-modificato.jpg")).toBe("img_0178");
    expect(nameStem("IMG_0178(1).jpg")).toBe("img_0178");
    expect(nameStem("IMG_0178-edit (2).jpg")).toBe("img_0178");
  });

  it("non tocca i nomi con punti o trattini interni", () => {
    expect(nameStem("20081011-IMG_4017.jpg")).toBe("20081011-img_4017");
    expect(nameStem("viaggio.roma.jpg")).toBe("viaggio.roma");
  });
});

describe("matchByName", () => {
  const raws = [
    { id: 1, name: "ADV_1626.CR2", taken: d("2019-04-27T20:52:11") },
    { id: 2, name: "IMG_0398.CR2", taken: d("2013-07-27T23:13:19") },
    { id: 3, name: "IMG_0398.CR2", taken: d("2016-02-01T10:00:00") },
    { id: 4, name: "IMG_5000.CR2", taken: d("2015-01-01T10:00:00") },
    { id: 5, name: "IMG_5000.CR2", taken: d("2015-01-01T12:00:00") },
  ];

  it("collega in automatico se l'export arriva entro 2 giorni dopo un solo CR2", () => {
    const r = matchByName([{ id: 10, name: "ADV_1626.jpg", taken: d("2019-04-28T09:43:08") }], raws);
    expect(r.auto).toEqual([{ exportId: 10, rawId: 1 }]);
    expect(r.possible).toEqual([]);
  });

  it("export prima del CR2 o oltre 2 giorni: solo possibile", () => {
    const before = matchByName([{ id: 11, name: "ADV_1626.jpg", taken: d("2019-04-27T20:00:00") }], raws);
    expect(before.auto).toEqual([]);
    expect(before.possible).toEqual([{ exportId: 11, rawIds: [1] }]);
    const late = matchByName([{ id: 12, name: "ADV_1626.jpg", taken: d("2019-05-02T00:00:00") }], raws);
    expect(late.auto).toEqual([]);
    expect(late.possible).toEqual([{ exportId: 12, rawIds: [1] }]);
  });

  it("propone i CR2 con lo stesso nome dal più vicino nel tempo", () => {
    const r = matchByName([{ id: 13, name: "IMG_0398.jpg", taken: d("2019-06-07T10:59:08") }], raws);
    expect(r.possible).toEqual([{ exportId: 13, rawIds: [3, 2] }]);
  });

  it("più CR2 nella finestra: si sceglie a mano tra quelli", () => {
    const r = matchByName([{ id: 14, name: "IMG_5000.jpg", taken: d("2015-01-02T10:00:00") }], raws);
    expect(r.auto).toEqual([]);
    expect(r.possible).toEqual([{ exportId: 14, rawIds: [5, 4] }]);
  });

  it("senza data o senza CR2 con quel nome", () => {
    const r = matchByName(
      [
        { id: 15, name: "ADV_1626.jpg", taken: null },
        { id: 16, name: "IMG_9999.jpg", taken: d("2019-01-01T00:00:00") },
      ],
      raws,
    );
    expect(r.auto).toEqual([]);
    expect(r.possible).toEqual([{ exportId: 15, rawIds: [1] }]);
  });
});

describe("exportGapLabel", () => {
  it("dice la distanza in ore, giorni o anni", () => {
    expect(exportGapLabel(d("2019-04-28T09:43:08"), d("2019-04-27T20:52:11"))).toBe("export 13 ore dopo");
    expect(exportGapLabel(d("2013-12-31T22:00:00"), d("2013-07-27T21:00:00"))).toBe("export 157 giorni dopo");
    expect(exportGapLabel(d("2019-06-07T10:00:00"), d("2013-07-27T23:00:00"))).toBe("export 6 anni dopo");
    expect(exportGapLabel(d("2019-04-27T20:00:00"), d("2019-04-27T20:52:11"))).toBe("export 1 ora prima");
    expect(exportGapLabel(null, d("2019-04-27T20:52:11"))).toBeNull();
  });
});
