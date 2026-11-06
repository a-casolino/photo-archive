/**
 * Applica le migrazioni in migrations/*.sql in ordine di nome.
 * Ogni file applicato viene registrato in `schema_migrations`.
 *
 *   npm run db:migrate           applica quelle mancanti
 *   npm run db:migrate -- --status   mostra lo stato senza applicare
 *
 * Nota: in MySQL le istruzioni DDL non sono transazionali. Se una migrazione
 * fallisce a metà va sistemata a mano prima di rilanciare.
 */
import "./load-env";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";

const dir = path.join(process.cwd(), "migrations");
const statusOnly = process.argv.includes("--status");

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST ?? "127.0.0.1",
    port: Number(process.env.DATABASE_PORT ?? 3306),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    multipleStatements: true,
    timezone: "Z",
  });
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);

    const [rows] = await conn.query<RowDataPacket[]>("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.version as string));
    const files = (await readdir(dir)).filter((f) => /^\d{3,}_.+\.sql$/.test(f)).sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        if (statusOnly) console.log(`  applicata   ${file}`);
        continue;
      }
      if (statusOnly) {
        console.log(`  DA APPLICARE ${file}`);
        continue;
      }
      process.stdout.write(`→ ${file} … `);
      await conn.query(await readFile(path.join(dir, file), "utf8"));
      await conn.query("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
      console.log("ok");
      count++;
    }
    if (!statusOnly) console.log(count ? `${count} migrazioni applicate.` : "Database già aggiornato.");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error("\nMigrazione fallita:", e.message ?? e);
  process.exit(1);
});
