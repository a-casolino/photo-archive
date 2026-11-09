-- =====================================================================
-- 012: sotto-album (richiesta di Antonio del 2026-11-09).
--
-- Un album può contenere, oltre alle sue foto, altri album: al massimo
-- 3 livelli in tutto (es. Viaggi › 2019 › Roma). Il limite lo controlla
-- l'app (MAX_ALBUM_DEPTH in src/lib/album-tree-rules.ts), non il database.
--   - parent_id: l'album che lo contiene (NULL = primo livello). Gli album
--     già esistenti restano al primo livello.
--   - trashed_with_album_id: "Elimina album" manda nel cestino tutto il
--     ramo; i sotto-album ricordano con quale album ci sono andati, così
--     "Ripristina" e "Elimina per sempre" agiscono sul ramo intero.
-- Condividere un album dà accesso anche ai suoi sotto-album (anche a
-- quelli aggiunti dopo), come già per le foto.
-- =====================================================================

ALTER TABLE albums
  ADD COLUMN parent_id BIGINT UNSIGNED NULL AFTER origin_ref,
  ADD COLUMN trashed_with_album_id BIGINT UNSIGNED NULL AFTER merged_into_id,
  ADD KEY ix_albums_parent (parent_id),
  ADD KEY ix_albums_trashed_with (trashed_with_album_id),
  ADD CONSTRAINT fk_albums_parent FOREIGN KEY (parent_id) REFERENCES albums(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_albums_trashed_with FOREIGN KEY (trashed_with_album_id) REFERENCES albums(id) ON DELETE SET NULL;
