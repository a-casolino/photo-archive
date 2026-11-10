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
- **Riconoscimento facciale**: vedere tutte le foto di una persona. L'app trova
  i volti e raggruppa quelli simili; Antonio dà un nome ai gruppi e conferma i
  suggerimenti sulle foto nuove. Dettagli in [architettura](architettura.md#volti).
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
| Riconoscimento facciale | Calcolo sulla VPS ogni tanto (`npm run volti`, bassa priorità); modello InsightFace buffalo_l (il progetto non è commerciale); nomi e volti visibili solo al proprietario; suggerimenti sempre da confermare | 2026-11-08 |
| Eliminare foto | Dalla foto o in blocco dall'album (selezione multipla) le foto vanno nel **cestino**, ripristinabili; dopo 30 giorni si eliminano da sole (`npm run cestino` da cron), oppure prima con "Elimina definitivamente" / "Svuota cestino". L'eliminazione definitiva cancella i file dal bucket (CR2, anteprime, volti) e i dati collegati. Un CR2 e il suo export collegato si eliminano insieme | 2026-11-08 |
| Eliminare un album | "Elimina album" manda nel cestino l'album e le foto che stanno solo lì (senza album resterebbero irraggiungibili); quelle presenti anche in altri album restano. Si ripristina o si elimina per sempre come le foto | 2026-11-08 |
| Import da Google Foto e Drive | Niente download e ricarico dal computer: Takeout consegnato su Google Drive e cartelle di Drive importati dalla VPS (`npm run drive`). Poi, a parte, un pulsante "Importa da Google Foto" (Picker API) per le aggiunte piccole | 2026-11-09 |
| Link con nome | Indirizzi perpetui `/l/<nome>` con nome scelto dal proprietario (minuscole, numeri, trattini, 2-30 caratteri), senza scadenza. La destinazione si cambia quando si vuole: un album oggi, un altro album o una singola foto domani. Stesse regole dei link liberi (senza login, mai gli originali). Può anche non puntare a nulla: chi lo apre (come per destinazione nel cestino o link disattivato) vede una pagina vuota che dice di contattare l'amministratore. Disattivabili e riattivabili; eliminabili solo da disattivati. Pagina **Link** e riquadro nella finestra Condividi | 2026-11-10 |
| Sotto-album | Un album può contenere foto e altri album, al massimo 3 livelli (es. Viaggi › 2019 › Roma). Condividere un album include sempre i suoi sotto-album, anche quelli aggiunti dopo. Import da disco e da Drive: le cartelle diventano l'albero (oltre il terzo livello il resto del percorso va nel titolo); Takeout resta piatto. Gli album esistenti restano al primo livello: si sistemano con "Sposta in…" | 2026-11-09 |
| Versioning | `main` stabile + PR, Conventional Commits, SemVer < 1.0, migrazioni numerate | 2026-11-06 |

## Aperti

- **Misure delle anteprime**: 2048 px e 400 px proposte, da confermare.
- **Video** (Takeout): per ora ignorati dall'import.

- **Fusi orari EXIF**: `DateTimeOriginal` è l'ora locale della fotocamera; per il
  match conta l'uguaglianza, per l'ordinamento potrebbe servire l'offset.

## Stato dell'implementazione

- [x] Scheletro Next.js, migrazioni, login, sessioni, inviti, reset password, ruoli
- [x] Gestione utenti per il proprietario, dashboard "Condivisi con me"
- [x] Import dal disco CR2 (programma locale: exiftool, anteprime, upload con URL firmati) e pagina Import
- [x] Import da Google Takeout e match export → CR2 con pagina di revisione
- [x] Import da Google Drive dalla VPS: export di Takeout e cartelle di Drive
- [x] Sotto-album (3 livelli), con "Nuovo sotto-album" e "Sposta in…"
- [ ] Pagina "Organizza": proporre i raggruppamenti degli album già importati
- [ ] Pulsante "Importa da Google Foto" con la Picker API (aggiunte piccole; senza GPS)
- [ ] Bucket Google Cloud Storage (da creare con Antonio; fino ad allora archivio in cartella locale)
- [x] Gallerie e album (griglia masonry senza ritaglio, filtro "solo con regolazioni")
- [x] Condivisioni (protette e link liberi) e download con signed URL
- [x] Link con nome perpetui `/l/<nome>` con destinazione modificabile (migrazione 015)
- [x] Tag su album e foto (solo proprietario)
- [x] Unire due o più album in uno (solo proprietario)
- [ ] Riconoscimento facciale (proposta da preparare)
- [ ] Deploy su xCloud e backup notturno del DB
- [x] Volti: rilevamento e impronte con `npm run volti` (migrazione 006)
- [x] Volti: raggruppamento, "Da riconoscere", suggerimenti, pagina persona
- [ ] Volti: riquadri nel visore della foto
- [x] Cestino ed eliminazione definitiva anche dal bucket (cron giornaliero `npm run cestino` su xCloud dal 2026-11-08)
- [x] Eliminare un intero album (con le foto che stanno solo lì)
| Caricamento dal browser | Pagina "Carica dal browser" per i lotti di tutti i giorni, anche dal telefono (solo foto della galleria); il programma di import resta per il grosso dell'archivio. Prima le anteprime di tutto il lotto (album subito completi), poi gli originali con upload riprendibile; i probabili doppioni si caricano e finiscono nella pagina "Probabili doppioni" | 2026-11-10 |
