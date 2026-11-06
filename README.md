# photo-archive

Archivio fotografico personale: RAW Canon e album di Google Foto, con
condivisione protetta (utenti invitati) o libera (link non indicizzato).

Next.js 16 + TypeScript, MySQL 8, Google Cloud Storage per i file.
Dettagli in [docs/](docs/) e in [CLAUDE.md](CLAUDE.md).

## Avvio in locale

Serve Node 22+ e un MySQL 8.

```bash
npm install
cp .env.example .env.local     # poi compila DATABASE_* (SMTP può restare vuoto)
npm run db:migrate
npm run owner:create -- --email tu@esempio.it --name "Il tuo nome"
npm run dev
```

Apri il link stampato da `owner:create` per scegliere la password. Finché SMTP
non è configurato, i link di invito e reset compaiono nel terminale di `npm run dev`.

Database di prova veloce in MySQL:

```sql
CREATE DATABASE photo_archive CHARACTER SET utf8mb4;
CREATE USER 'photo_archive'@'localhost' IDENTIFIED BY 'una-password';
GRANT ALL ON photo_archive.* TO 'photo_archive'@'localhost';
```

## Comandi

| Comando | Cosa fa |
| --- | --- |
| `npm run dev` | server di sviluppo |
| `npm run build` / `npm start` | build e avvio in produzione |
| `npm run typecheck` | controllo TypeScript |
| `npm run lint` | ESLint |
| `npm test` | test unitari (vitest) |
| `npm run db:migrate` | applica le migrazioni mancanti |
| `npm run db:status` | stato delle migrazioni |
| `npm run owner:create` | crea l'account proprietario (una volta) |

## Come si lavora

`main` è sempre stabile e viene pubblicato sulla VPS. Ogni modifica passa da un
branch e una pull request, con commit in stile Conventional Commits. Ogni
modifica al database è una nuova migrazione in `migrations/`.
