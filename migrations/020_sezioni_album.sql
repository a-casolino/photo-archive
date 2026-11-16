-- =====================================================================
-- 020: sezioni delle foto in un album (richiesta di Antonio del
-- 2026-11-16, passo 3: unione album Google + cartella del disco).
--
-- 'main'   = in primo piano (tutte le foto finora);
-- 'extra'  = "Altri scatti": CR2 e JPEG della cartella non esportati,
--            mostrati dopo, in una sezione a parte;
-- 'source' = originali dietro a un export dell'album (CR2 o JPEG della
--            fotocamera): non si mostrano nelle griglie, si aprono dal link
--            al RAW dell'export e restano coperti dalle condivisioni.
-- album_pairs.merged_at: quando la coppia è stata unita.
-- =====================================================================

ALTER TABLE album_photos
  ADD COLUMN section ENUM('main','extra','source') NOT NULL DEFAULT 'main' AFTER position;

ALTER TABLE album_pairs
  ADD COLUMN merged_at DATETIME NULL AFTER decided_at;
