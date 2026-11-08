# Requisiti e decisioni

Raccolti con Antonio a novembre 2026. Le voci "deciso" sono approvate; il resto
è da confermare.

## Obiettivo

Una web app per gestire l'archivio fotografico di Antonio e condividerne parti
con altre persone.

## Fonti delle foto

1. **Disco locale con i RAW** della reflex Canon (`.CR2`), circa 1 TB (stima),
   da migrare su Google Cloud Storage.
2. **Google Foto**: album dal cellulare, e album che sono selezioni o export
   modificati di album dell'archivio RAW.

## Requisiti

- **Corrispondenza export Google Foto → CR2 originale** (nice to have): per ogni
  foto esportata/modificata, risalire al CR2 da cui nasce. Metodo: EXIF
  `DateTimeOriginal` (+ sottosecondi) e numero di serie della fotocamera; se ci
  sono più candidati (raffiche) la scelta è manuale.
- **Versione modificata al posto di quella nativa**: molti CR2 hanno un export
  JPEG con le regolazioni di Lightroom, caricato in un album di Google Foto.
  Quando un CR2 ha un export collegato (`photos.derived_from_id`, match
  `auto` o `confirmed`), nell'album della cartella l'app mostra e condivide
  quel JPEG al posto dell'anteprima incorporata nel CR2 (che è quella della
  fotocamera, senza regolazioni). Il CR2 resta l'originale scaricabile.
  Filtro nell'album: **tutte le foto** / **solo quelle con regolazioni**.
  Lo schema v1 basta: non serve una migrazione.
- **Condivisione** di una singola foto o di un album, in due modalità:
  - **protetta**: solo utenti registrati scelti da Antonio;
  - **libera**: chiunque abbia l'URL, che non è indicizzato (`noindex`) e
    contiene un token casuale lungo.
- **Gestione utenti**: ogni utente ha un account e una dashboard con tutto ciò
  che è stato condiviso con lui. Gli utenti non si registrano da soli: li invita
  Antonio.

## Decisioni

| Tema | Decisione | Data |
| --- | --- | --- |
| Login | Email e password, gestiti dall'app (niente Firebase) | 2026-11-06 |
| Scadenza link liberi | 30 giorni, modificabile e rinnovabile | 2026-11-06 |
| Scadenza condivisioni a utenti | Nessuna | 2026-11-06 |
| Ruoli | **Proprietario** (Antonio, tutto), **Fidato** (può scaricare i CR2 dove la condivisione lo permette), **Visualizzatore** (al massimo il JPEG grande) | 2026-11-06 |
| Link liberi | Mai gli originali, al massimo il JPEG grande | 2026-11-06 |
| Permesso effettivo | Il minimo tra quanto concede la condivisione e il ruolo dell'utente | 2026-11-06 |
| Stack | Next.js + MySQL 8 sulla VPS xCloud, GCS solo per i file (vedi [architettura](architettura.md)) | 2026-11-06 |
| Modello dati | [schema.sql](schema.sql), v1 | 2026-11-06 |
| Griglia degli album | Masonry, foto intere senza ritaglio | 2026-11-08 |
| Versioning | `main` stabile + PR, Conventional Commits, SemVer < 1.0, migrazioni numerate | 2026-11-06 |

## Aperti

- **Misure delle anteprime**: 2048 px e 400 px proposte, da confermare.
- **Video** (Takeout): per ora ignorati dall'import.

- **Provider SMTP** per inviti e reset password: lo indicherà Antonio
  (probabilmente non Brevo).
- **Fusi orari EXIF**: `DateTimeOriginal` è l'ora locale della fotocamera; per il
  match conta l'uguaglianza, per l'ordinamento potrebbe servire l'offset.

## Stato dell'implementazione

- [x] Scheletro Next.js, migrazioni, login, sessioni, inviti, reset password, ruoli
- [x] Gestione utenti per il proprietario, dashboard "Condivisi con me"
- [x] Import dal disco CR2 (programma locale: exiftool, anteprime, upload con URL firmati) e pagina Import
- [x] Import da Google Takeout e match export → CR2 con pagina di revisione
- [ ] Bucket Google Cloud Storage (da creare con Antonio; fino ad allora archivio in cartella locale)
- [x] Gallerie e album (griglia masonry senza ritaglio, filtro "solo con regolazioni")
- [x] Condivisioni (protette e link liberi) e download con signed URL
- [ ] Tag su album e foto
- [ ] Riconoscimento facciale (proposta da preparare)
- [ ] Deploy su xCloud e backup notturno del DB
