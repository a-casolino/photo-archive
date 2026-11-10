import { describe, expect, it } from "vitest";
import { stableSignWindow } from "../src/lib/signing-rules";

describe("stableSignWindow", () => {
  const h = 3600 * 1000;
  const base = Date.UTC(2026, 10, 10, 13, 0, 0);

  it("dà lo stesso intervallo dentro la stessa finestra", () => {
    const a = stableSignWindow(base + 1000, 900);
    const b = stableSignWindow(base + h - 1, 900);
    expect(a).toEqual(b);
    expect(a.accessibleAt).toBe(base);
  });

  it("cambia nella finestra successiva", () => {
    expect(stableSignWindow(base + h, 900).accessibleAt).toBe(base + h);
  });

  it("lascia sempre almeno il ttl richiesto", () => {
    for (const t of [0, 1, h / 2, h - 1]) {
      const { expires } = stableSignWindow(base + t, 900);
      expect(expires - (base + t)).toBeGreaterThanOrEqual(900 * 1000);
    }
  });

  it("resta sotto i 7 giorni concessi da Google", () => {
    const { accessibleAt, expires } = stableSignWindow(base + 123, 15 * 60);
    expect(expires - accessibleAt).toBeLessThan(7 * 24 * h);
  });
});
