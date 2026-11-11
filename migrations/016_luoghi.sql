-- =====================================================================
-- 016: nome del luogo sotto la foto (richiesta di Antonio del 2026-11-11).
--
-- Dalle coordinate GPS (EXIF o JSON di Takeout) `npm run luoghi` cerca la
-- località più vicina nell'elenco di GeoNames, in locale sulla VPS, e salva
-- qui il nome leggibile ("Positano, Campania, Italia").
--   - NULL: da cercare (o foto senza GPS);
--   - '':   cercata, nessuna località entro 50 km (in mare aperto, …).
-- =====================================================================

ALTER TABLE photos
  ADD COLUMN place_name VARCHAR(255) NULL AFTER gps_lon;
