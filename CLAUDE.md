# photo-archive — guida per Claude

Web app per l'archivio fotografico personale di Antonio: i RAW Canon (.CR2) del
disco locale e gli album di Google Foto, con condivisione protetta (utenti) o
libera (link non indicizzato). Antonio scrive in italiano: rispondi in italiano,
e scrivi in italiano anche testi dell'interfaccia, commenti e documentazione.

Prima di lavorare leggi:
- [docs/requisiti.md](docs/requisiti.md): cosa deve fare l'app e le decisioni prese.
- [docs/architettura.md](docs/architettura.md): stack, infrastruttura, come è fatto il codice.
- [docs/schema.sql](docs/schema.sql): il modello dati approvato, commentato.

@AGENTS.md

## Stack (approvato da Antonio il 2026-11-06)

- **Next.js 16 + TypeScript** (App Router, Server Actions), eseguito come sito Node
  sulla VPS di Antonio gestita con xCloud. Niente Vercel, niente Docker.
- **MySQL 8** già presente sulla VPS. Accesso con `mysql2`, SQL scritto a mano
  (niente ORM). Helper in `src/lib/db.ts`.
- **Login nell'app**: email + password, nessun servizio esterno (niente Firebase).
  Password con scrypt di Node, sessioni lato server nella tabella `sessions`.
- **Google Cloud Storage solo per i file**: CR2 originali in classe Archive,
  anteprime JPEG in Standard servite con signed URL brevi. Backup notturno del
  DB su un bucket. Non ancora implementato.
- **Email** via SMTP generico (nodemailer). Il provider **non è ancora scelto**
  (probabilmente non Brevo): senza `SMTP_HOST` le email finiscono nel log.

## Infrastruttura

- VPS Hetzner (Falkenstein) gestita con **xCloud**: Ubuntu 22.04, OpenLiteSpeed,
  MySQL 8, Node 24, 4 core, ~7,7 GB RAM, 40 GB disco, ospita già altri ~10 siti.
- L'app è pubblicata su https://foto.acasolino.com come sito Node xCloud collegato
  a questo repository (branch `main`, deploy a ogni push). Dettagli in
  `docs/architettura.md`.
- **Non toccare la VPS** (deploy, database, configurazione) senza che Antonio lo
  chieda esplicitamente: ci sono altri siti in produzione.

## Regole di lavoro (approvate da Antonio il 2026-11-06)

- **Branch**: `main` è sempre stabile ed è ciò che xCloud pubblica. Ogni modifica
  nasce su un branch (`feat/condivisioni`, `fix/login`, `docs/...`) ed entra in
  `main` solo con una pull request.
- **Commit**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`,
  `test:`), descrizione in italiano.
- **Versioni**: SemVer con tag Git (`v0.1.0`, `v0.2.0`, …), sotto la 1.0 finché
  l'app non è completa.
- **Database**: ogni modifica allo schema è una nuova migrazione numerata in
  `migrations/` (`002_...sql`, `003_...sql`). Mai modifiche a mano sul MySQL, mai
  modificare una migrazione già applicata. Aggiorna anche `docs/schema.sql`.

## Comandi

```bash
npm run dev          # sviluppo su http://localhost:3000
npm run typecheck    # genera i tipi delle route e controlla TypeScript
npm run lint
npm test             # vitest (test unitari in tests/)
npm run build
npm run db:migrate   # applica le migrazioni mancanti
npm run db:status    # mostra quali migrazioni sono applicate
npm run owner:create -- --email ... --name "..."   # crea il proprietario, una volta
npm run import -- "/cartella" [--takeout] [--prova]  # programma di import (sul computer di Antonio)
npm run volti [-- --max N] [--rifai]   # trova i volti nelle anteprime e li raggruppa (sulla VPS, bassa priorità)
npm run volti -- --raggruppa           # solo raggruppamento e suggerimenti, senza analizzare
npm run volti -- --scarica-modelli [--zip buffalo_l.zip]  # modelli InsightFace in FACES_MODEL_DIR (da GitHub o da uno zip già scaricato)
npm run volti -- --file foto.jpg        # prova su file locali, senza database
npm run drive                           # lavora la coda Import → Google Drive: Takeout e cartelle di Drive (cron sulla VPS ogni 15 min)
npm run cestino [-- --giorni N]         # elimina per sempre (anche dal bucket) album e foto nel cestino da più di 30 giorni (cron sulla VPS)
```

Prima di aprire una PR: `npm run typecheck && npm run lint && npm test && npm run build`.

## Convenzioni del codice

- Tutto ciò che legge sessione o database è codice server (`import "server-only"`).
- Autorizzazione **sempre lato server**: `requireUser()` / `requireOwner()` da
  `src/lib/session.ts`, anche dentro ogni Server Action (non fidarti del layout).
- Permessi di download solo tramite `effectiveDownload()` in `src/lib/roles.ts`.
- Volti e persone solo per il proprietario. Le impronte (`faces.embedding`) sono dati
  biometrici: mai al browser, mai a servizi esterni; eliminando una persona si
  eliminano anche i suoi volti.
- Negli URL solo `public_id` casuali, mai gli id numerici.
- Token (sessione, invito, reset, link liberi) salvati solo come hash SHA-256.
- Date in UTC nel database; in interfaccia fuso `Europe/Rome`.
- `cacheComponents` è disattivato in `next.config.ts`: quasi ogni pagina dipende
  dall'utente collegato.
- Next.js 16 ha API diverse dalle versioni precedenti: in caso di dubbio leggi la
  guida in `node_modules/next/dist/docs/`.

## Punti aperti

- Provider SMTP (lo indicherà Antonio).
- Fusi orari EXIF (DateTimeOriginal è ora locale della fotocamera).
- Bucket GCS da creare (chiedere ad Antonio prima: costa). Senza bucket l'archivio
  è una cartella locale (`STORAGE_DRIVER=local`), solo per prove.
- Import da Google Drive (`/admin/import/drive`, `npm run drive`): servono client OAuth
  Google, variabili `GOOGLE_*` e cron sulla VPS (da attivare con Antonio).
- Da fare: backup DB. Il cron giornaliero di `npm run cestino` è attivo su xCloud (3:30, dal 2026-11-08).
- Volti: fatti calcolo, raggruppamento, pagine Persone / Da riconoscere /
  Suggerimenti / persona. Misurato sulla VPS (8/11): ~1 s per foto, ~1 GB di memoria.
  Da fare: riquadri dei volti nel visore ("Mostra volti"), soglie da tarare su foto vere.
