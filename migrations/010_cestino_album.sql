-- 010: eliminare un intero album (richiesta di Antonio del 2026-11-08).
--
-- "Elimina album" manda nel cestino l'album e, con lui, le foto che non
-- stanno in nessun altro album (altrimenti resterebbero irraggiungibili:
-- l'app si naviga per album). Le foto presenti anche in altri album restano.
-- Questa colonna ricorda quali foto sono andate nel cestino con quale
-- album, così "Ripristina album" riporta esattamente quelle e l'album si
-- elimina definitivamente insieme a loro.

ALTER TABLE photos
  ADD COLUMN trashed_with_album_id BIGINT UNSIGNED NULL AFTER deleted_at,
  ADD KEY ix_photos_trashed_album (trashed_with_album_id),
  ADD CONSTRAINT fk_photos_trashed_album FOREIGN KEY (trashed_with_album_id) REFERENCES albums(id) ON DELETE SET NULL;
