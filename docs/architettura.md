# Architettura

## Panoramica

```
Browser ──HTTPS──> OpenLiteSpeed (xCloud) ──> Next.js (Node 24) ──> MySQL 8 (stessa VPS)
                                                    │
                                                    └──> Google Cloud Storage
                                                          ├─ originals/  (CR2, classe Archive)
                                                          └─ previews/   (JPEG, classe Standard, signed URL)

PC di Antonio: script di import ──exiftool──> anteprime + EXIF ──> GCS + MySQL
```

- I CR2 non vengono mai riletti dal cloud per mostrarli: l'app usa solo le
  anteprime JPEG (estratte in locale durante l'import, `exiftool -b -PreviewImage`).
  La classe Archive costa poco da tenere ma è lenta e cara da leggere.
- Google Foto: dal 31/03/2025 la Library API non legge più la libreria
  dell'utente, quindi l'import passa da **Google Takeout** (zip + JSON).
- Costo stimato su Google: circa 3–5 €/mese di storage, oltre alla VPS.

## Infrastruttura

- VPS Hetzner (Falkenstein) gestita con xCloud: Ubuntu 22.04, OpenLiteSpeed,
  MySQL 8, Node 24, 4 core, ~7,7 GB RAM, 40 GB disco. Ospita già altri siti.
- Niente Docker. L'app è un sito Node collegato al repository GitHub, branch `main`.
- Deploy previsto: `npm ci && npm run build && npm run db:migrate`, poi
  `npm start` (porta in `PORT`). Da configurare insieme ad Antonio.

## Codice

```
migrations/            migrazioni SQL numerate (applicate da scripts/migrate.ts)
scripts/               migrate.ts, create-owner.ts
src/lib/
  env.ts               configurazione da variabili d'ambiente (validata con zod)
  db.ts                pool mysql2 e helper query/queryOne/execute
  crypto.ts            hash password (scrypt), token, id casuali base62
  session.ts           sessioni: createSession, getCurrentUser, requireUser, requireOwner
  auth-tokens.ts       token monouso di invito e reset (solo hash nel DB)
  mail.ts              invio email via SMTP (o log se non configurato)
  roles.ts             ruoli e permesso di download effettivo
  rate-limit.ts        limite tentativi in memoria
src/app/
  (auth)/              login, password-dimenticata, reset/[token], invito/[token]
  (app)/               area riservata: dashboard, account, admin/utenti
  actions/             Server Actions (auth.ts, users.ts)
  ui/action-form.tsx   form con messaggi di errore/esito
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
