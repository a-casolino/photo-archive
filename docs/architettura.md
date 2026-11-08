# Architettura

## Panoramica

```
Browser ──HTTPS──> OpenLiteSpeed (xCloud) ──> Next.js (Node 24) ──> MySQL 8 (stessa VPS)
                                                    │
                                                    └──> Google Cloud Storage
                                                          ├─ originals/  (CR2, classe Archive)
                                                          └─ previews/   (JPEG, classe Standard, signed URL)

PC di Antonio: npm run import ──exiftool + sharp──> anteprime + EXIF
      │  1. chiede all'app se il file c'è già (SHA-256)      ─> API /api/import/v1
      │  2. riceve URL firmati e carica i file direttamente   ─> GCS
      └  3. registra la foto (l'app controlla che il file ci sia) ─> MySQL
```

- I CR2 non vengono mai riletti dal cloud per mostrarli: l'app usa solo le
  anteprime JPEG (estratte in locale durante l'import, `exiftool -b -PreviewImage`).
  La classe Archive costa poco da tenere ma è lenta e cara da leggere.
- Google Foto: dal 31/03/2025 la Library API non legge più la libreria
  dell'utente, quindi l'import passa da **Google Takeout** (zip + JSON).
- Costo stimato su Google: circa 3–5 €/mese di storage, oltre alla VPS.

## Import

Il programma di import (`scripts/import/`) gira sul computer di Antonio, perché
un browser non può leggere 1 TB di CR2 né lanciare exiftool. Si autentica con una
**chiave del computer** creata nella pagina **Import** (`/admin/import`), salvata
in `.env.local` come `IMPORT_KEY` (nel DB solo lo SHA-256, revocabile).

- **Scansione**: CR2 dal disco (ogni cartella diventa un album `disk_folder`),
  oppure un Google Takeout già estratto (`--takeout`): foto e JSON di
  accompagnamento (data, descrizione, posizione, link), album dalle cartelle con
  `metadata.json`. I video per ora sono ignorati.
- **Doppioni**: impronta SHA-256 di ogni file; quelle già calcolate restano in
  `~/.photo-archive/hash.jsonl`, così una ripresa non rilegge tutto il disco.
- **Anteprime**: dal JPEG incorporato nel CR2 (`PreviewImage`/`JpgFromRaw`),
  ruotato secondo l'EXIF (mappatura in `scripts/import/previews.ts`, verificata dai
  test), poi 2048 px e 400 px in JPEG senza metadati. HEIC: `sips` su Mac.
- **Upload**: l'app firma gli URL (`PUT`) e il programma carica direttamente su
  GCS: CR2 e originali in classe `ARCHIVE`, anteprime in `STANDARD`. Le chiavi sono
  deterministiche (`originals/AAAA/AAAA-MM-GG/<sha8>_<nome>`,
  `previews/<sha2>/<sha>.jpg`, `thumbs/...`), quindi ripetere un upload non duplica.
- **Ripresa**: Ctrl+C chiude l'import come interrotto; rilanciando lo stesso
  comando riprende lo stesso import (`~/.photo-archive/imports.json`).
- **Tipi**: dal disco `raw`; da Takeout `edit` se l'EXIF viene da una fotocamera
  (marca o numero di serie), altrimenti `phone`.
- **Collegamento export → CR2**: stesso `taken_at` (e millisecondi se entrambi li
  hanno), stessa marca e modello, stesso seriale se l'export lo conserva. Un solo
  candidato → `auto`; più candidati (raffiche) → scelta manuale nella pagina
  `/admin/import/collegamenti`, dove si conferma, si sceglie o si scarta.
  Il calcolo gira a fine import e con il pulsante "Ricalcola".
- **Archivio di prova**: con `STORAGE_DRIVER=local` i file finiscono in
  `STORAGE_LOCAL_DIR` sul server, con URL firmati serviti da `/api/storage/...`.
  Solo per prove: in produzione serve il bucket (la VPS ha 40 GB).

Per GCS servono `STORAGE_DRIVER=gcs`, `GCS_BUCKET` e un account di servizio con
chiave (`GCS_KEY_FILE`, oppure il contenuto del JSON in `GCS_KEY_JSON`) con ruolo
"Storage Object Admin" sul solo bucket: firma gli URL e scrive i file.
Bucket deciso con Antonio il 2026-11-07: Google Cloud (non Hetzner né Amazon),
regione europe-west3 (Francoforte).

## Gallerie e condivisioni

- **Proprietario**: `/album` (elenco con ricerca e filtro per origine),
  `/album/<id>` (griglia), `/foto/<id>?album=<id>` (foto con frecce ← →, Esc
  torna all'album), `/admin/condivisioni` (tutte le condivisioni).
- **Griglia masonry senza ritaglio** (`src/app/ui/gallery/masonry.tsx`):
  ogni foto con le sue proporzioni (da `width`/`height`, lati scambiati se
  Orientation 5–8); ogni foto va nella colonna più bassa, così l'ordine per
  data si legge da sinistra a destra. Colonne secondo la larghezza (2 su
  telefono, fino a 6). 200 foto per pagina.
- **Versione mostrata**: se un CR2 ha un export collegato (`match_status`
  `auto` o `confirmed`) si usano miniatura e anteprima dell'export; filtro
  "Tutte / Solo con regolazioni". Il download "originale" resta il CR2.
- **Condivisioni protette**: `/condivisi/<public_id>`, solo per i destinatari
  (il proprietario le può aprire per vedere cosa vedono gli altri). Email ai
  destinatari (nel log se manca l'SMTP). La dashboard "Condivisi con me" le
  elenca con la copertina; "nuovo" finché non le apre.
- **Link liberi**: `/l/<token>`, senza login, noindex; nel DB solo lo SHA-256
  del token, quindi il link si vede una volta sola ("Nuovo link" lo
  sostituisce). Scadenza `SHARE_LINK_TTL_DAYS` (30), "Rinnova" la sposta di
  nuovo a 30 giorni da oggi. Link scaduti, revocati e sbagliati danno la
  stessa pagina "Link non disponibile".
- **Download**: `/api/download?p=<foto>&v=preview|original` (+ `s=` o `t=`)
  controlla il permesso con `effectiveDownload()` e reindirizza a un URL
  firmato di 5 minuti che scarica con il nome del file. "preview" = JPEG da
  2048 px della versione mostrata. Le immagini delle pagine sono URL firmati
  di 15 minuti.
- **Registro**: viste (pagina iniziale della condivisione) e download in
  `share_events`, contatore in `shares.view_count`; il proprietario non viene
  contato.
- **Privacy**: posizione GPS e nome/dimensione del file solo al proprietario.

## Infrastruttura

- VPS Hetzner (Falkenstein) gestita con xCloud: Ubuntu 22.04, OpenLiteSpeed,
  MySQL 8, Node 24, 4 core, ~7,7 GB RAM, 40 GB disco. Ospita già altri siti.
- Niente Docker. L'app è un sito Node collegato al repository GitHub, branch `main`.
- **Pubblicata il 2026-11-06** su https://foto.acasolino.com (sito xCloud
  "foto.acasolino.com", utente di sistema `foto`, cartella
  `/var/www/foto.acasolino.com`). DNS e certificato gestiti da xCloud tramite
  Cloudflare (record proxied).
- Deploy automatico a ogni push su `main`. Lo script di deploy di xCloud è:

  ```
  npm ci
  npm run db:migrate
  npm run build
  ```

  Attenzione: quando c'è uno script di deploy, xCloud **non** esegue da solo
  install e build, quindi devono stare nello script. Poi PM2 avvia
  `npm run start -- -p 3200` e OpenLiteSpeed fa da proxy sulla porta 3200.
- Database MySQL `photo_archive` con utente `photo_archive` (solo locale).
- Le variabili d'ambiente stanno nel `.env` gestito da xCloud (Site → impostazioni
  di deploy), non nel repository. SMTP e Google Cloud ancora vuoti: i link di
  invito e reset finiscono nel log PM2 del sito.

## Codice

```
migrations/            migrazioni SQL numerate (applicate da scripts/migrate.ts)
scripts/               migrate.ts, create-owner.ts
scripts/import/        programma di import (gira sul computer di Antonio)
src/lib/
  env.ts               configurazione da variabili d'ambiente (validata con zod)
  db.ts                pool mysql2 e helper query/queryOne/execute
  crypto.ts            hash password (scrypt), token, id casuali base62
  session.ts           sessioni: createSession, getCurrentUser, requireUser, requireOwner
  auth-tokens.ts       token monouso di invito e reset (solo hash nel DB)
  mail.ts              invio email via SMTP (o log se non configurato)
  roles.ts             ruoli e permesso di download effettivo
  rate-limit.ts        limite tentativi in memoria
  storage.ts           archivio file: Google Cloud Storage o cartella locale, URL firmati
  imports.ts           import lato server: chiavi computer, registrazione foto, album, match
  import-shared.ts     schemi e funzioni condivise con il programma di import
  format.ts            formattazione (byte, durate, date) per l'interfaccia
  gallery.ts           album e foto per le gallerie (versione mostrata, vicine, URL firmati)
  gallery-rules.ts     regole pure: stato condivisioni, proporzioni, masonry (testate)
  shares.ts            condivisioni: accesso, creazione, destinatari, registro
src/app/
  (auth)/              login, password-dimenticata, reset/[token], invito/[token]
  (app)/               area riservata: dashboard, account, album, foto,
                       condivisi/<id>, admin/utenti, admin/condivisioni,
                       admin/import (elenco, dettaglio, collegamenti)
  (public)/l/[token]   link liberi (senza login)
  api/download/        download con controllo dei permessi
  api/import/v1/       API usata dal programma di import (chiave del computer)
  api/storage/         file dell'archivio di prova (solo STORAGE_DRIVER=local)
  actions/             Server Actions (auth.ts, users.ts, imports.ts, shares.ts)
  ui/action-form.tsx   form con messaggi di errore/esito
  ui/gallery/          masonry, pagina foto, form e elenco condivisioni
tests/                 test vitest
docs/                  requisiti, architettura, schema.sql
```

## Autenticazione

- **Password**: scrypt di Node (N=2^15, r=8, p=1), formato
  `scrypt$N$r$p$salt$hash`. Minimo 10 caratteri.
- **Sessione**: token casuale da 256 bit nel cookie `pa_session` (httpOnly,
  SameSite=Lax, Secure in produzione); nel DB solo lo SHA-256. Durata 30 giorni
  (`SESSION_TTL_DAYS`). Cambio o reset della password chiudono tutte le sessioni.
- **Inviti**: il proprietario crea l'utente (senza password) e l'app manda un link
  valido 7 giorni; l'utente sceglie la password e entra.
- **Reset password**: link valido 1 ora. La risposta è la stessa che l'email
  esista o no.
- **Tentativi**: massimo 10 login ogni 15 minuti per IP+email, 5 richieste di
  reset per IP. In memoria (un solo processo).
- **Primo accesso**: `npm run owner:create` crea il proprietario e stampa il link
  per scegliere la password.

## Ruoli e download

Vedi `src/lib/roles.ts` e i test in `tests/roles.test.ts`.

| Ruolo | Condivisione `none` | `preview` | `original` |
| --- | --- | --- | --- |
| Proprietario | originale | originale | originale |
| Fidato | solo visione | JPEG | CR2 |
| Visualizzatore | solo visione | JPEG | JPEG |
| Link libero (nessun utente) | solo visione | JPEG | non ammesso dallo schema |

## Configurazione

Tutte le variabili sono in [`.env.example`](../.env.example).
