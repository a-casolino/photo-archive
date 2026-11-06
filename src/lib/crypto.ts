import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

/*
 * Password: scrypt di Node (nessuna dipendenza nativa da compilare sulla VPS).
 * Formato salvato: scrypt$N$r$p$salt_b64$hash_b64
 */
const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEYLEN,
      { N: n, r, p, maxmem: 256 * n * r },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const key = await scryptAsync(password, Buffer.from(saltB64, "base64"), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hash per non salvare mai in chiaro i token di sessione, invito e reset. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Token opaco per cookie di sessione o link email (256 bit). */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Stringa base62 casuale: public_id (22 caratteri) e token dei link liberi (32). */
export function randomBase62(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += BASE62[randomInt(62)];
  return out;
}
