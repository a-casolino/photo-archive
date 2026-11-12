# Architettura

## Panoramica

```
Browser ──HTTPS──> OpenLiteSpeed (xCloud) ──> Next.js (Node 24) ──> MySQL 8 (stessa VPS)
                                                    │
                                                    └──> Google Cloud Storage
                                                          ├─ originals/  (CR2, classe Archive)
                                                          └─ previews/   (JPEG, classe Standard, signed URL)

PC di Antonio: npm run import ──exiftool + sharp──> anteprime + EXIF
(oppure il browser: /admin/import/carica, ExifTool in WebAssembly + canvas)
      │  1. chiede all'app se il file c'è già (SHA-256)      ─> API /api/import/v1
      │  2. riceve URL firmati e carica i file direttamente   ─> GCS
      └  3. registra la foto (l'app controlla che il file ci sia) ─> MySQL
```

- I CR2 non vengono mai riletti dal cloud per mostrarli: l'app usa solo le
  anteprime JPEG (estratte in locale durante l'import, `exiftool -b -PreviewImage`).
  La classe Archive costa poco da tenere ma è lenta e cara da leggere.
- Google Foto: dal 31/03/2025 la Library API non legge più la libreria
  dell'utente, quindi l'import passa da **Google Takeout** (zip + JSON),
  consegnato su Google Drive e letto dalla VPS (vedi «Import da Google Drive»).
- Costo stimato su Google: circa 3–5 €/mese di storage, oltre alla VPS.

## Import

Il programma di import (`scripts/import/`) gira sul computer di Antonio, perché
un browser non può leggere 1 TB di CR2 né lanciare exiftool. Si autentica con una
**chiave del computer** creata nella pagina **Import** (`/admin/import`), salvata
in `.env.local` come `IMPORT_KEY` (nel DB solo lo SHA-256, revocabile).

- **Scansione**: foto dal disco, CR2 e JPG/HEIC/PNG (ogni cartella, compresa
  quella scelta, diventa un album `disk_folder`; i CR2 sono `raw`, le altre foto
  `edit` se l'EXIF è di una fotocamera, per esempio gli export di Lightroom, che
  vengono collegati al loro CR2, altrimenti `phone`),
  oppure un Google Takeout già estratto (`--takeout`): foto e JSON di
  accompagnamento (data, descrizione, posizione, link), album dalle cartelle con
  `metadata.json`. I video per ora sono ignorati.
- **Versione del programma**: il programma manda `X-Import-Program`; l'app
  rifiuta le versioni sotto `MIN_PROGRAM_VERSION` (`src/lib/import-shared.ts`)
  e chiede di aggiornare con `git pull`. Si alza quando una copia vecchia
  salverebbe dati sbagliati.
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
- **Probabili doppioni**: i file identici (stesso SHA-256) non entrano mai. In
  più, due CR2 con file diversi ma stessa fotocamera, stesso `taken_at` e stesso
  FileNumber Canon (o, se manca, stesso nome e millisecondi) vanno in
  `/admin/import/doppioni` (`src/lib/duplicates.ts`). "Scarta" mette la foto nel
  cestino (`deleted_at`) e sposta album, copertine ed export collegati su quella
  tenuta; "Sono foto diverse" salva la coppia in `duplicate_dismissals`.
- **Avanzamento**: ogni 2 secondi il programma manda contatori e attività
  (`activity_json`: file in lavorazione con la fase di ognuno, velocità di upload
  e di lavorazione su una finestra mobile). Le pagine di import si aggiornano
  ogni 3 secondi con `router.refresh()`; i link hanno `prefetch={false}` perché
  ogni refresh rifarebbe il prefetch di tutti i link della pagina.
- **Archivio di prova**: con `STORAGE_DRIVER=local` i file finiscono in
  `STORAGE_LOCAL_DIR` sul server, con URL firmati serviti da `/api/storage/...`.
  Solo per prove: in produzione serve il bucket (la VPS ha 40 GB).

Per GCS servono `STORAGE_DRIVER=gcs`, `GCS_BUCKET` e un account di servizio con
chiave (`GCS_KEY_FILE`, oppure il contenuto del JSON in `GCS_KEY_JSON`) con ruolo
"Storage Object Admin" sul solo bucket: firma gli URL e scrive i file.
Bucket deciso con Antonio il 2026-11-07: Google Cloud (non Hetzner né Amazon),
regione europe-west8 (Milano).

## Carica dal browser

Pagina `/admin/import/carica` (solo proprietario), decisa con Antonio il
2026-11-10: per i lotti di tutti i giorni (un servizio, un viaggio, foto dal
telefono). Per il grosso dell'archivio resta il programma di import: la
velocità è la stessa (la linea di casa), ma non dipende da una scheda aperta.

- **Il browser fa il lavoro del programma** (`src/lib/upload/`), con la
  stessa API `/api/import/v1` autenticata dalla sessione del proprietario
  (solo richieste con `Origin` di questa app, vedi `_lib/handler.ts`). Le
  import hanno `device_id` NULL e l'etichetta "Browser · …".
- **Scelta dei file**: trascinamento di file e cartelle (con le sottocartelle,
  `webkitGetAsEntry`) o i pulsanti "Scegli foto" / "Scegli cartella"; sul
  telefono solo foto dalla galleria (iOS converte gli HEIC in JPG). Le
  cartelle diventano album come nel programma (`diskAlbum()` in
  `src/lib/import-albums.ts`, stessi riferimenti: ricaricare una cartella
  ritrova i suoi album); i file sciolti vanno nell'album scritto nel
  riepilogo (`origin_ref` = `browser/<titolo>`) o in nessuno.
- **Riepilogo** prima di partire: impronte SHA-256 di tutti i file in un Web
  Worker e `POST /lookup` per dire quanti ci sono già; albero degli album,
  tipi, file ignorati, stima del tempo dalla velocità degli ultimi import.
- **Tag EXIF con ExifTool in WebAssembly** (`@uswriting/exiftool`, ExifTool
  13.42 su zeroperl) con gli stessi argomenti di exiftool-vendored
  (`EXIFTOOL_ARGS`), così `photoFields()` (`src/lib/photo-metadata.ts`) dà gli
  stessi campi del programma: lo verifica `tests/upload-exiftool.test.ts`. Il
  file `.wasm` (~25 MB, ~7,5 MB con gzip) lo serve
  `/api/import/exiftool` (compresso, il worker lo decomprime con
  `DecompressionStream`), in cache nel browser per un anno: l'URL contiene la
  versione e va cambiato aggiornando il pacchetto.
- **Anteprime nel browser** (Web Worker, `OffscreenCanvas`): dal CR2 si
  legge solo il JPEG incorporato (posizione e lunghezza da ExifTool,
  `embeddedJpegRange()`), lo si ruota a mano con l'orientamento EXIF
  (`orientationTransform()`, verificata contro sharp nei test); JPG e PNG si
  aprono direttamente (il browser applica l'orientamento). 2048 e 400 px in
  JPEG, qualità 82 e 75, come il programma. Gli HEIC li apre Safari; Chrome,
  Edge e Firefox no, e allora li decodifica libheif in WebAssembly
  (`libheif-js`, LGPL, `src/lib/upload/heic.ts`, ~2 MB scaricati solo al
  primo HEIC). libheif applica già la rotazione salvata nel file.
- **Prima le anteprime, poi gli originali**: ogni foto si registra appena
  caricate le anteprime, con `photos.original_pending = 1` (migrazione 014),
  così gli album sono completi dopo pochi minuti. Intanto (1 alla volta, poi
  2) partono gli originali; finché manca, "Scarica originale" è spento e
  `/api/download?v=original` risponde 409. `POST /imports/<id>/original/done`
  controlla la dimensione e azzera il flag.
- **Upload riprendibile**: per ogni originale il server apre una sessione
  riprendibile di Cloud Storage (`resumableSession()` in `storage.ts`, classe
  ARCHIVE, legata all'`Origin` della pagina) e la salva in `upload_sessions`
  (6 giorni; Google le tiene 7). Il browser manda pezzi da 8 MiB con
  `Content-Range` e, dopo un errore, chiede a Google quanti byte ha
  (`src/lib/upload/resumable.ts`, test con un finto server). Chiudendo la
  pagina e scegliendo di nuovo le stesse foto: i file già registrati si
  saltano, gli originali mancanti (`pendingOriginals` di check e lookup)
  ripartono dal byte a cui erano arrivati. Anche il programma di import,
  trovando una foto con l'originale mancante, lo carica.
- **Riprendi senza riscegliere** (Chrome ed Edge sul computer): lì i pulsanti
  e il trascinamento usano le API File System Access, che danno dei
  riferimenti a cartelle e file (`src/lib/upload/files.ts`). Alla partenza
  il browser li salva in IndexedDB con l'import da continuare
  (`src/lib/upload/saved.ts`, uno per pagina: "Carica dal browser" o
  l'album). Riaprendo la pagina compare «Riprendi»: il browser chiede di
  nuovo il permesso di leggere la cartella, rilegge i file e continua lo
  stesso import. Si dimentica quando il caricamento finisce senza errori, con
  "Svuota" o "Lascia perdere". Safari, Firefox e i telefoni non hanno queste
  API: lì si riscelgono le stesse foto.
- **Dentro un album aperto** (pagina dell'album, solo proprietario): file e
  cartelle trascinati in qualunque punto della pagina, o "Aggiungi foto",
  aprono lo stesso caricamento in un pannello (`src/app/ui/upload/`). Le
  foto sciolte vanno nell'album, le cartelle diventano suoi sotto-album nei
  livelli che restano (`folderAlbumInside()` in `import-albums.ts`; un album
  al terzo livello riceve tutto direttamente). Il browser manda `intoAlbum`
  (public_id) a check e commit; i riferimenti dei sotto-album iniziano con
  `album/<public_id>/`, così non si confondono con le stesse cartelle
  caricate altrove.
- **Pausa** ferma gli upload in corso (gli originali riprendono dal punto
  raggiunto); **Riprova gli errori** riapre lo stesso import. Mentre carica lo
  schermo resta acceso (Wake Lock) e chiudere la pagina chiede conferma.
  L'avanzamento va nella pagina Import come per il programma.
- **CORS del bucket**: il browser scrive direttamente su Cloud Storage, quindi
  il bucket deve accettare `PUT` dalla nostra origine. Regola in
  `docs/gcs-cors.json`, da applicare una volta (Cloud Shell, con un account
  che può modificare il bucket; l'account di servizio dell'app non può):
  `gcloud storage buckets update gs://acasolino-foto --cors-file=gcs-cors.json`.
  Senza, il primo upload fallisce con un messaggio che lo dice. Con
  `STORAGE_DRIVER=local` (prove) non serve: gli upload passano dall'app.

## Import da Google Drive

Antonio non vuole scaricare il Takeout e ricaricarlo dal suo computer (upload
~4 Mbit/s). Verificato il 2026-11-09: Google non offre un trasferimento diretto
Google Foto → Cloud Storage. La Library API vede solo le foto create dall'app,
la Data Portability API non comprende Google Foto, Takeout consegna solo su
Drive/Dropbox/OneDrive/Box, e la Picker API toglie la posizione GPS e non dice
l'album. Quindi: **Takeout su Drive, letto dalla VPS**. Lo stesso meccanismo
importa le **cartelle normali di Drive** (album che stanno solo lì).

- **Collegamento**: pagina `/admin/import/drive`, OAuth del proprietario con
  scope `drive.readonly` (client "Applicazione web" del progetto Google Cloud,
  redirect `<APP_URL>/api/google-drive/callback`, `state` in un cookie). Il
  refresh token sta in `google_drive_accounts`, cifrato con AES-256-GCM
  (`GOOGLE_TOKEN_SECRET`). "Scollega" lo revoca presso Google.
- **Coda**: il proprietario sceglie un export di Takeout (riconosciuto dal nome
  `takeout-AAAAMMGGThhmmssZ-NNN.zip`, tutti gli zip insieme) o una cartella
  (con le sottocartelle); finiscono in `drive_imports`.
- **Lavoro**: `npm run drive` (cron sulla VPS ogni 15 minuti, `nice`), un giro
  alla volta (file di blocco in `DRIVE_WORK_DIR`). Gli zip si leggono **a pezzi**
  con richieste `Range` (`scripts/drive/zip-reader.ts`, yauzl con cache a blocchi
  di 64 KB per l'indice): niente zip interi sul disco. Prima si estraggono tutti
  i JSON di tutti gli zip (Google mette a volte foto e JSON in zip diversi), poi
  le foto a lotti di `DRIVE_BATCH_GB`. Per ogni lotto si lancia il normale
  programma di import verso `APP_URL`, con una chiave "VPS · Google Drive" che
  si rinnova a ogni giro; finito il lotto i file si cancellano. Le cartelle di
  Drive si scaricano file per file con la stessa logica a lotti.
- **Ripresa**: `batches_done` conta i lotti finiti; un giro interrotto o
  "Riprova" riparte dal primo lotto non finito. "Annulla" ferma il programma di
  import dopo i file in corso. Prima di ogni lotto si controlla lo spazio libero
  (lotto + 2 GB).
- I video sono saltati come nell'import dal computer. L'app non modifica Drive.
- Dagli zip di Takeout si prendono **solo le foto degli album** (decisione di
  Antonio, 2026-11-11): file e JSON delle cartelle degli anni («Photos from
  AAAA», «Foto da AAAA» nei Takeout in italiano), del cestino e del backup di WhatsApp
  (cartelle con «WhatsApp» nel nome) si saltano.
- **Album di Takeout**: ogni cartella con foto che non è un anno o il cestino è
  un album; il titolo viene dal file dei metadati dell'album (`metadata.json`,
  `metadati.json` in italiano), altrimenti dal nome della cartella. Gli zip con orari nel nome a pochi minuti
  l'uno dall'altro (Google divide a volte lo stesso export in `…T205102Z-001.zip`
  e `…T205103Z-1-001.zip`) sono un export solo.
- **Verifica di un Takeout** (tabella `drive_checks`, migrazione 017): dalla
  riga dell'export già importato, «Verifica» mette in coda un controllo che
  `npm run drive` fa prima degli import. Rilegge solo l'indice degli zip, con le
  stesse regole dell'import (`scripts/drive/check-rules.ts`), e confronta album
  per album con l'archivio (`compareAlbum` in `src/lib/takeout-check.ts`: nome +
  dimensione, poi cestino, poi sola dimensione per le foto già presenti con un
  altro nome). Resoconto in `/admin/import/drive/verifica/<id>`.

## Gallerie e condivisioni

- **Proprietario**: `/album` (elenco con ricerca e filtro per origine),
  `/album/<id>` (griglia), `/foto/<id>?album=<id>` (foto con frecce ← →, Esc
  torna all'album; su telefono swipe a destra/sinistra), `/admin/condivisioni` (tutte le condivisioni).
- **Filtri di Album e Foto** (solo proprietario): `/album` filtra anche per data di
  scatto (`anno`, `mese`, `giorno`, ognuno facoltativo: "agosto" = tutti gli agosti) e
  per `persona`; un album passa se lui o un suo sotto-album ha una foto che soddisfa
  data e persona insieme. `/foto` mostra tutte le foto dalla più recente, in masonry,
  con ricerca (nome file, titolo, descrizione, tag, album, persone), data, `tag`,
  `origine` (dell'album che contiene la foto), `solo=regolazioni` e `persona`
  (volti confermati). Un export collegato a un CR2 non compare da solo: si vede il
  CR2 nella versione dell'export. La foto aperta da `/foto` ha `?da=foto` e gli stessi
  filtri, così frecce, swipe e lightbox scorrono l'elenco filtrato. La data è
  `taken_at` (EXIF, ora locale della fotocamera), senza conversioni di fuso. Regole
  pure in `src/lib/filter-rules.ts`, query in `src/lib/photos.ts`.
- **Lightbox** (`src/app/ui/gallery/lightbox.tsx`): un click sulla foto la apre a
  schermo intero su nero trasparente, in tutte le pagine foto (proprietario,
  condivisioni, link liberi). Swipe e frecce per le foto vicine, Esc / X / tocco
  fuori dalla foto per chiudere, nome del file in basso. Lo stato aperto è nell'URL
  (`?schermo=1`, aperto e chiuso con la History API senza richieste al server);
  sul telefono la foto arriva ai bordi dello schermo.
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
- **Link con nome**: `/l/<nome>` (tabella `named_links`, pagina `/admin/link`
  e riquadro nella finestra Condividi). Nome di 2-30 caratteri `[a-z0-9-]`:
  i token sono di 32, quindi `getLinkShare()` capisce dalla forma se è un
  token o un nome (`linkKeyKind()` in `src/lib/named-link-rules.ts`) e per i
  nomi restituisce una condivisione "virtuale" (mode `link`, senza
  scadenza): pagine e download sono quelli dei link liberi. Si contano solo
  le visite (in `named_links`, non in `share_events`). Destinazione nel
  cestino, link disattivato o senza destinazione ("Nessuna destinazione"
  nei form): pagina vuota "contatta l'amministratore" (`LinkEmpty`); un nome
  che non esiste dà "Link non disponibile".
  Unendo album il link segue l'album tenuto; eliminando per sempre la
  destinazione il nome resta, senza destinazione.
- **Download**: `/api/download?p=<foto>&v=preview|original` (+ `s=` o `t=`)
  controlla il permesso con `effectiveDownload()` e reindirizza a un URL
  firmato di 5 minuti che scarica con il nome del file. "preview" = JPEG da
  2048 px della versione mostrata. Le immagini delle pagine sono URL firmati
  di 15 minuti.
- **Registro**: viste (pagina iniziale della condivisione) e download in
  `share_events`, contatore in `shares.view_count`; il proprietario non viene
  contato.
- **Privacy**: posizione GPS e nome/dimensione del file solo al proprietario.
- **Tag** (solo proprietario): si aggiungono e tolgono dalla pagina
  dell'album o della foto (più tag separati da virgola, con suggerimenti).
  `/tag` elenca i tag, `/tag/<slug>` mostra album e foto con quel tag, con
  rinomina ed eliminazione. La ricerca degli album cerca anche nei tag. Chi
  riceve una condivisione per ora non vede i tag.
- **Copertina dell'album** (solo proprietario): "Usa come copertina" nella
  pagina della foto (per l'album da cui arrivi, altrimenti per ogni album che
  la contiene) o dalla selezione dell'album con una sola foto spuntata salva
  `albums.cover_photo_id`. La copertina mostrata è quella
  scelta se la foto è ancora nell'album e non è nel cestino, altrimenti la
  prima foto dell'album (`albumCoverId()` in `src/lib/gallery.ts`): una foto
  cestinata viene sostituita senza toccare il dato e torna se la ripristini.
  Nell'album la miniatura della copertina ha il badge "Copertina".
- **Ricerca con suggerimenti** (solo proprietario, `src/app/ui/search-suggest.tsx`):
  mentre si scrive nel campo di `/album` compare una tendina con fino a 5
  album, 5 tag e 5 persone il cui nome contiene il testo (maiuscole e accenti
  non contano), prima quelli che iniziano con il testo. Frecce e Invio aprono
  la pagina dell'album, del tag o della persona; Invio senza scelta fa la
  ricerca di prima. I dati arrivano da `/api/suggerimenti?q=` (`src/lib/suggest.ts`),
  che risponde 404 a chi non è il proprietario: tag e persone non escono mai
  verso chi riceve condivisioni.
- **Unire album** (solo proprietario, `/album/unisci`, `src/lib/albums.ts`):
  si spuntano due o più album e si sceglie quale tenere. Nell'album tenuto
  arrivano le foto (senza doppioni) e i tag degli altri; titolo a scelta,
  descrizione e copertina dell'album tenuto (o del primo degli altri, se
  mancano), date ricalcolate. Le condivisioni degli album uniti, se attive,
  si spostano sull'album tenuto (stessi link e destinatari, ma vedono tutte
  le foto) o si revocano: lo sceglie Antonio ogni volta. Gli album uniti vanno
  nel cestino con `merged_into_id` (migrazione 009): i vecchi `/album/<id>`
  portano all'album tenuto e un nuovo import della stessa cartella mette le
  foto lì. Non c'è un "annulla" nell'interfaccia.

## Cestino ed eliminazione

Codice in `src/lib/trash.ts` (regole testabili in `src/lib/trash-rules.ts`),
pagina `/admin/cestino`, azioni in `src/app/actions/trash.ts`.

- **Sposta nel cestino**: dalla pagina della foto (poi si passa alla foto
  successiva dell'album), dal visore a schermo intero (icona del cestino, con
  conferma; il visore resta aperto sulla foto successiva) o in blocco con
  "Seleziona" (`?seleziona=1`, caselle sulla griglia) in un album, in Foto,
  nella pagina di un tag e in quella di una persona. Imposta `photos.deleted_at`: la foto
  sparisce da album, tag, persone e condivisioni ma resta nel database e nel
  bucket. Anche i doppioni scartati finiscono qui.
- **Export collegati**: un CR2 e il suo export (`match_status` `auto` o
  `confirmed`) vanno nel cestino, tornano e si eliminano insieme; nel cestino si
  vede solo il CR2.
- **Ripristina** toglie `deleted_at`: la foto torna nei suoi album, con tag,
  volti e condivisioni. Copertine: le gestisce la lettura degli album.
- **Eliminazione definitiva**: "Elimina definitivamente" (selezione),
  "Svuota cestino" (tutto) o `npm run cestino` (foto nel cestino da più di
  `TRASH_RETENTION_DAYS` giorni, 30), da lanciare con un cron giornaliero di
  xCloud. Prima cancella dal bucket originale, anteprima, miniatura e miniature
  dei volti (8 richieste alla volta); poi, in una transazione, le condivisioni
  della sola foto e la foto (volti, tag, posti negli album, doppioni: `ON DELETE
  CASCADE`; copertine e legami export: `SET NULL`). Nel registro delle
  condivisioni di album resta l'evento senza la foto. Se un file non si
  cancella la foto resta nel cestino e si può riprovare. L'account di servizio
  ha già il permesso (Storage Object Admin).
- **Elimina album** (riquadro "Modifica album"): l'album va nel cestino e,
  con lui, le foto che non stanno in nessun altro album attivo (più i loro
  export collegati, se anche loro non stanno altrove): senza album resterebbero
  irraggiungibili, perché l'app si naviga per album. Le foto presenti anche in
  altri album restano. Le foto andate con l'album hanno
  `photos.trashed_with_album_id` (migrazione 010): nel Cestino si vedono sotto
  l'album, "Ripristina album" riporta esattamente quelle, "Elimina
  definitivamente" (e `npm run cestino` dopo 30 giorni) elimina le foto, file
  compresi, poi l'album con le sue condivisioni e gli album uniti in lui.
  "Svuota cestino" elimina prima gli album, poi le foto rimaste.
- **Più album insieme**: "Seleziona" nell'elenco degli album, con la casella
  di conferma. Un sotto-album scelto insieme al suo album se ne va con lui
  (`topmostSelected`); gli altri album vanno nel cestino uno alla volta come
  con "Elimina album".
- **Annulla**: dopo ogni spostamento nel cestino (foto o album) il messaggio
  offre "Annulla" per 10 minuti. Un cookie httpOnly (`annulla_cestino`) ricorda
  gli id delle foto (numerici, solo nel cookie, mai negli URL) o i `public_id`
  degli album; "Annulla" riporta solo ciò che è ancora nel cestino. Se la
  selezione non ci sta nel cookie resta il Cestino. Dalla pagina della foto
  `?prima=<public_id>` fa tornare alla foto ripristinata.
- **Togli dall'album** (selezione dentro un album): la foto esce da
  quell'album (`album_photos`, con il suo export collegato) ma resta
  nell'archivio e negli altri album; se era la copertina scelta, l'album torna
  alla copertina automatica. Una foto senza album si trova in Foto.
- **Costo**: la classe Archive ha una durata minima di 365 giorni; un CR2
  cancellato prima di un anno dall'upload si paga comunque fino all'anno
  (pochi centesimi al GB).
- Finché una foto è nel cestino il suo SHA-256 resta nel database, quindi un
  nuovo import dello stesso file non la ricarica: va ripristinata. Dopo
  l'eliminazione definitiva un nuovo import la carica di nuovo.

## Volti

`npm run volti` (`scripts/volti/`) gira **sulla VPS**, ogni tanto, lanciato a mano
o con un cron di xCloud. Analizza le foto con `faces_scanned_at` vuoto: legge
l'anteprima 2048 px dall'archivio, trova i volti, calcola l'impronta e salva
riquadro, impronta e una miniatura 160 px (`faces/<sha2>/<sha>_<n>.jpg`, classe
Standard).

- **Modello**: InsightFace `buffalo_l` su `onnxruntime-node` (solo CPU):
  `det_10g.onnx` (SCRFD, volti + 5 punti) e `w600k_r50.onnx` (ArcFace, impronta di
  512 numeri). Licenza dei modelli: uso non commerciale, va bene per l'archivio
  personale. I modelli (~190 MB) non sono nel repository:
  `npm run volti -- --scarica-modelli` li mette in `FACES_MODEL_DIR`.
- **Carichi**: priorità minima (`nice 19`), `FACES_THREADS` thread (2), una foto
  alla volta, `--pausa` tra una foto e l'altra se serve. A fine giro stampa
  tempo medio per foto e memoria massima.
- **Codice**: `src/lib/faces/geometry.ts` replica preprocessing e
  postprocessing di insightface (letterbox, decodifica SCRFD, NMS, allineamento
  ArcFace), così le impronte sono le stesse della libreria Python;
  `engine.ts` carica i modelli; `records.ts` converte in righe della tabella.
- **Rianalisi** (`--rifai` o cambio di modello): un volto ritrovato nello stesso
  punto (IoU ≥ 0,5) tiene id, nome confermato e scarti.
- **Prova senza database**: `npm run volti -- --file a.jpg --file b.jpg` salva in
  `./prova-volti` le immagini con i riquadri e i ritagli, e stampa la somiglianza
  tra i volti (oltre ~0,4 di solito è la stessa persona).
- **Raggruppamento** (`scripts/volti/group.ts`, alla fine di ogni analisi o con
  `--raggruppa`): ricalcola il volto tipo di ogni persona (media delle impronte
  confermate, `people.centroid`); i volti senza nome che somigliano a una persona
  sopra 0,45 diventano `suggested`, saltando le persone in `face_rejections`; gli
  altri vengono raggruppati "a leader" con soglia 0,5 (`src/lib/faces/cluster.ts`)
  e numerati dal gruppo più grande in `cluster_id`. Confermati e ignorati non si
  toccano mai.
- **Pagine** (solo proprietario, `src/lib/people.ts`, `src/app/actions/people.ts`):
  `/persone` (elenco con foto profilo), `/persone/da-riconoscere` (gruppi: nome
  nuovo o esistente per tutto il gruppo, spunta tolta = volto escluso, "Non mi
  interessa" = `ignored`), `/persone/suggerimenti` (conferma o scarta in blocco),
  `/persone/<id>` (foto in ordine di data con la griglia degli album, un export
  collegato a un CR2 della persona compare una volta sola; togli volti, rinomina,
  unisci, elimina). La pagina della foto mostra i nomi delle persone confermate.
- **Eliminare una persona** cancella i suoi volti e le impronte; le foto restano.
  I volti tornano solo rianalizzando la foto con `--rifai`.
- **Privacy**: tutto resta su VPS, MySQL e bucket privato. Pagine di volti e
  persone solo per il proprietario; chi riceve una condivisione non vede i nomi.
  Le query delle pagine non leggono mai `faces.embedding`.

## Luoghi

Sotto la foto il proprietario vede il **luogo** ("Positano, Campania, Italia",
link a OpenStreetMap) e una piccola **mappa** con il punto, quando la foto ha il
GPS (EXIF dei telefoni o JSON di Takeout; i CR2 della 7D di solito non ce
l'hanno). Chi riceve una condivisione o un link non li vede.

- **Nome del luogo** (`photos.place_name`, migrazione 016): la località più
  vicina entro 50 km nell'elenco di **GeoNames** (cities500, CC BY 4.0), con i nomi
  italiani per località e regioni d'Italia e il paese in italiano. Il calcolo è
  tutto sulla VPS: le coordinate non vanno a servizi esterni.
- **Quando**: alla fine di ogni giro di `npm run drive` (cron ogni 15 minuti),
  per le foto con GPS e `place_name` NULL, da qualunque import arrivino. A mano:
  `npm run luoghi`; `--tutte` ricalcola tutto, `--scarica` riscarica l'elenco,
  `--prova <lat> <lon>` stampa il luogo senza database. `''` = nessuna località
  vicina (in mare aperto); finché non c'è il nome la pagina mostra le coordinate.
- **Elenco**: in `PLACES_DATA_DIR` (`./dati-luoghi`), scaricato da solo la prima
  volta da download.geonames.org (`cities500.zip`, `admin1CodesASCII.txt`,
  `alternatenames/IT.zip`, ~30 MB in tutto) e ridotto a `luoghi.tsv`. Se la VPS
  non lo raggiunge si copiano i tre file a mano nella cartella.
- **Mappa**: iframe di openstreetmap.org (`export/embed.html`), caricata solo
  quando arriva sullo schermo; i riquadri della mappa li chiede il browser del
  proprietario a OpenStreetMap.
- **Codice**: `src/lib/place-rules.ts` (lettura dei file, indice a celle di 1°,
  località più vicina; testato), `scripts/luoghi/` (scaricamento e calcolo).

## Statistiche

`/admin/statistiche`, solo proprietario (voce «Statistiche» nel menu).

- **Archivio** dal database (`src/lib/stats.ts`): foto per tipo e peso degli
  originali, album, persone, condivisioni, cestino, foto per anno di scatto e
  caricate per mese, uso delle condivisioni negli ultimi 30 giorni.
- **Bucket** da Cloud Monitoring (`src/lib/gcs-metrics.ts`, API REST v3 con
  `google-auth-library`): spazio e file per classe (`storage/v2/total_bytes`,
  `storage/v2/total_count`, aggiornati da Google una volta al giorno, file
  eliminati temporaneamente compresi), traffico in uscita e in entrata giorno per
  giorno (`network/sent_bytes_count`, `network/received_bytes_count`) e richieste
  per metodo (`api/request_count`) degli ultimi 30 giorni. Tenute in memoria 10
  minuti; `?aggiorna=1` le rilegge. Serve il ruolo **Monitoring Viewer**
  (`roles/monitoring.viewer`) per l'account di servizio dell'app sul progetto
  (concesso da Antonio il 2026-11-11). Senza, lo spazio si stima dal database
  (originali esatti, anteprime con peso medio) e il traffico non è misurato.
- **Costi** (`src/lib/cost-rules.ts`, regole pure testate): listino
  europe-west8 in dollari, cambio fisso in euro, data dell'ultimo controllo in
  `PRICES_CHECKED`. Spazio per classe, traffico verso internet (anche la VPS che
  legge le anteprime per i volti è "internet"), operazioni (le scritture in
  Archive a parte, dal database), recupero dei CR2 scaricati dalle condivisioni.
  Proiezione con ~1 TB di CR2 con peso medio e proporzione delle anteprime di oggi.
  È una stima: il costo fatturato vero richiederebbe l'export della
  fatturazione su BigQuery (non fatto).

## Prestazioni

- **Export collegato** (`linkedExport()` in `src/lib/gallery.ts`): quasi tutte
  le foto hanno `derived_from_id` NULL, e per le statistiche di MySQL ogni
  valore dell'indice `ix_photos_derived` sembra valere migliaia di righe.
  Senza `FORCE INDEX` l'ottimizzatore leggeva tutta `photos` per ogni foto
  mostrata: con 40.000 foto un album impiegava ~5 s, l'elenco album ~3 s e
  la pagina Foto ~11 s, tutti di CPU di `mysqld` (il carico visto il
  2026-11-10). Con l'indice: 2–250 ms. Una nuova query che cerca gli export
  di una foto deve usare `linkedExport()` o lo stesso `FORCE INDEX`.
- **URL firmati stabili** (`src/lib/signing-rules.ts`): le letture senza nome
  di download si firmano con l'ora arrotondata all'ora intera, quindi la
  stessa miniatura ha lo stesso URL per un'ora e il browser la prende dalla
  cache invece di riscaricarla a ogni pagina. Il server tiene in memoria gli
  URL già firmati nella finestra corrente.

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
  di deploy), non nel repository. Email via xCloud Mail Delivery
  (Elastic Email, `smtp.elasticemail.com:2525`, STARTTLS), mittente
  `noreply@foto.acasolino.com`: il sito è associato all'abbonamento in Site →
  Email Config → Mail Delivery e i record DNS di foto.acasolino.com li gestisce
  xCloud su Cloudflare. Le variabili `SMTP_*` si modificano in Site → Node.js →
  Environment.

## Codice

```
migrations/            migrazioni SQL numerate (applicate da scripts/migrate.ts)
scripts/               migrate.ts, create-owner.ts
scripts/import/        programma di import (gira sul computer di Antonio)
scripts/volti/         analisi dei volti (gira sulla VPS)
scripts/luoghi/        nome del luogo dalle coordinate GPS (GeoNames, sulla VPS)
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
  tags.ts              tag su foto e album
  faces/               volti: geometria (SCRFD, ArcFace), motore ONNX, impronte, raggruppamento
  people.ts            persone e volti per le pagine (letture e modifiche)
  place-rules.ts       luoghi: elenco GeoNames e località più vicina al GPS (testate)
  suggest.ts           suggerimenti della ricerca; regole pure in search-rules.ts
  utils.ts             cn() per unire le classi Tailwind
src/components/ui/     componenti shadcn/ui (Button, Dialog, DropdownMenu), modificabili
src/app/
  (auth)/              login, password-dimenticata, reset/[token], invito/[token]
  (app)/               area riservata: dashboard, account, album, foto, tag,
                       condivisi/<id>, admin/utenti, admin/condivisioni, admin/link,
                       admin/import (elenco, dettaglio, collegamenti)
  (public)/l/[token]   link liberi e link con nome (senza login)
  api/download/        download con controllo dei permessi
  api/suggerimenti/    suggerimenti della ricerca (album, tag, persone; solo proprietario)
  api/import/v1/       API usata dal programma di import (chiave del computer)
  api/storage/         file dell'archivio di prova (solo STORAGE_DRIVER=local)
  actions/             Server Actions (auth.ts, users.ts, imports.ts, shares.ts)
  ui/action-form.tsx   form con messaggi di errore/esito
  ui/shell/            testata, navigazione (barra in basso sul telefono), menu utente
  ui/gallery/          masonry, pagina foto, form e elenco condivisioni
  ui/search-suggest.tsx  campo di ricerca con suggerimenti
tests/                 test vitest
docs/                  requisiti, architettura, schema.sql
```

## Interfaccia

Scelta di Antonio dell'8/11/2026: **shadcn/ui + Tailwind CSS v4**, icone
**lucide-react**, font **Geist**, rosso `#FF1500` come colore primario.

- I componenti di shadcn/ui sono copiati in `src/components/ui/` (basati su
  Radix): si possono modificare. Per aggiungerne uno: `npx shadcn@latest add
  <nome>` (usa `components.json`), oppure copiarlo a mano dal sito
  https://ui.shadcn.com.
- Le pagine passano a Tailwind **a poco a poco**. Per non stravolgere quelle
  ancora in CSS scritto a mano, `globals.css` non importa il reset di Tailwind
  (preflight): le vecchie regole stanno nel layer `base`, `gallery.css` nel
  layer `components` e le classi Tailwind (layer `utilities`) vincono sempre.
  Le regole sugli elementi (`button`, `input`, `select`) escludono i componenti
  shadcn (`:not([data-slot])`).
- Colori: le variabili `--bg`, `--fg`, `--muted`, `--card`, `--subtle`,
  `--border`, `--accent` (tema chiaro e scuro, segue il sistema) sono anche i
  colori di Tailwind (`bg-background`, `text-muted-foreground`, `bg-primary`…).
  In shadcn "accent" è lo sfondo leggero al passaggio del mouse; il rosso è
  `primary` (o `brand`).
- La griglia masonry resta in CSS proprio (`gallery.css`).

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
