-- 009: unione di album (richiesta di Antonio del 2026-11-08).
--
-- Unendo più album in uno, gli album di partenza vanno nel cestino
-- (deleted_at) e ricordano in quale album sono confluiti. Serve a due cose:
--   - un nuovo import della stessa cartella del disco o dello stesso album
--     di Takeout ritrova l'album "vecchio" (origin_key) e deve mettere le
--     foto in quello unito, non in un album cancellato;
--   - i vecchi indirizzi /album/<id> portano all'album unito.
-- Sempre un solo passaggio: se poi l'album unito confluisce in un altro,
-- l'app aggiorna anche chi puntava a lui.

ALTER TABLE albums
  ADD COLUMN merged_into_id BIGINT UNSIGNED NULL AFTER deleted_at,
  ADD CONSTRAINT fk_albums_merged FOREIGN KEY (merged_into_id) REFERENCES albums(id) ON DELETE SET NULL;
