import { describe, expect, it } from "vitest";
import { estimateRemainingMs, formatRate } from "../src/lib/format";
import { activitySchema, progressBody, RateMeter } from "../src/lib/import-shared";

describe("RateMeter", () => {
  it("calcola i byte al secondo sulla finestra mobile", () => {
    let t = 0;
    const m = new RateMeter(10_000, () => t);
    t = 10_000;
    m.add(5_000_000);
    expect(m.rate()).toBeCloseTo(500_000);
    // Dopo la finestra i campioni vecchi non contano più.
    t = 25_000;
    m.add(1_000_000);
    expect(m.rate()).toBeCloseTo(100_000);
  });

  it("all'inizio divide per il tempo trascorso, non per tutta la finestra", () => {
    let t = 0;
    const m = new RateMeter(20_000, () => t);
    t = 2_000;
    m.add(2_000_000);
    expect(m.rate()).toBeCloseTo(1_000_000);
  });

  it("senza byte è zero", () => {
    const m = new RateMeter();
    expect(m.rate()).toBe(0);
  });
});

describe("stima della fine", () => {
  it("usa la velocità recente se c'è", () => {
    // 50 su 100 byte in 60 s: media 50/60 B/s; recente 10 B/s -> 5 s.
    expect(estimateRemainingMs(50, 100, 60_000, 10)).toBeCloseTo(5_000);
    expect(estimateRemainingMs(50, 100, 60_000, 0)).toBeCloseTo(60_000);
  });
});

describe("formatRate", () => {
  it("mostra MB/s e Mbit/s", () => {
    expect(formatRate(2_100_000)).toBe("2,1 MB/s (17 Mbit/s)");
    expect(formatRate(500_000)).toBe("500 KB/s (4 Mbit/s)");
    expect(formatRate(null)).toBe("—");
  });
});

describe("activitySchema", () => {
  it("accetta l'avanzamento con l'attività e senza", () => {
    const activity = {
      workers: [{ file: "2015/Mare/IMG_0101.CR2", step: "upload_original", size: 25_000_000, sent: 1_000 }],
      uploadBps: 1_500_000,
      doneBps: 3_000_000,
      parallel: 3,
    };
    expect(activitySchema.parse(activity)).toEqual(activity);
    expect(progressBody.safeParse({ filesSeen: 1, bytesDone: 10, activity }).success).toBe(true);
    expect(progressBody.safeParse({ filesSeen: 1, bytesDone: 10 }).success).toBe(true);
    expect(activitySchema.safeParse({ ...activity, workers: [{ ...activity.workers[0], step: "boh" }] }).success).toBe(
      false,
    );
  });
});
