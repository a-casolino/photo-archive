/**
 * Crea l'account proprietario (una volta sola, dopo la prima migrazione)
 * e stampa il link per scegliere la password.
 *
 *   npm run owner:create -- --email antonio@example.com --name "Antonio"
 */
import "./load-env";
import { parseArgs } from "node:util";
import mysql, { type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { newToken, sha256 } from "../src/lib/crypto";

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
  const email = values.email?.trim().toLowerCase();
  const name = values.name?.trim();
  if (!email || !name) {
    console.error('Uso: npm run owner:create -- --email tu@esempio.it --name "Nome"');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST ?? "127.0.0.1",
    port: Number(process.env.DATABASE_PORT ?? 3306),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    timezone: "Z",
  });
  try {
    const [owners] = await conn.query<RowDataPacket[]>("SELECT email FROM users WHERE role = 'owner'");
    if (owners.length) {
      console.error(`Esiste già un proprietario (${owners[0].email}).`);
      process.exit(1);
    }
    const [res] = await conn.query<ResultSetHeader>(
      "INSERT INTO users (email, name, role) VALUES (?, ?, 'owner')",
      [email, name],
    );
    const token = newToken();
    await conn.query(
      "INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, 'invite', ?, ?)",
      [res.insertId, sha256(token), new Date(Date.now() + 7 * 86_400_000)],
    );
    const base = process.env.APP_URL ?? "http://localhost:3000";
    console.log(`Proprietario creato. Scegli la password qui (valido 7 giorni):\n${new URL(`/invito/${token}`, base)}`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
