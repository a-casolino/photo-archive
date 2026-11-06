import { describe, expect, it } from "vitest";
import { hashPassword, randomBase62, sha256, verifyPassword, newToken } from "../src/lib/crypto";

describe("password", () => {
  it("verifica la password giusta e rifiuta quella sbagliata", async () => {
    const h = await hashPassword("una-password-lunga");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("una-password-lunga", h)).toBe(true);
    expect(await verifyPassword("un'altra-password", h)).toBe(false);
  });

  it("usa un sale diverso a ogni hash", async () => {
    expect(await hashPassword("x".repeat(12))).not.toBe(await hashPassword("x".repeat(12)));
  });

  it("rifiuta formati sconosciuti", async () => {
    expect(await verifyPassword("x", "bcrypt$abc")).toBe(false);
  });
});

describe("token", () => {
  it("genera token e id casuali della lunghezza giusta", () => {
    expect(newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomBase62(22)).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(sha256("abc")).toHaveLength(64);
  });
});
