-- =====================================================================
-- 018: impronta visiva delle foto (richiesta di Antonio del 2026-11-16).
--
-- `npm run impronte` calcola dalla miniatura un "difference hash" a 64 bit
-- (16 cifre esadecimali, vedi src/lib/phash-rules.ts) e collega al CR2 gli
-- export senza nome né dati della fotocamera (match_method = 'pixel').
--   - NULL: da calcolare (o foto senza miniatura);
--   - '':   miniatura illeggibile (non si riprova; --rifai per riprovare).
-- =====================================================================

ALTER TABLE photos
  ADD COLUMN phash CHAR(16) NULL AFTER gcs_thumb_key;
