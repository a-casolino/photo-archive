-- =====================================================================
-- 003: condivisioni (gallerie e link liberi)
--
-- 1. Le condivisioni ricevono un public_id casuale da usare negli URL
--    delle condivisioni protette (/condivisi/<public_id>), come foto e
--    album: mai l'id numerico negli URL.
-- 2. Il token dei link liberi non si salva più in chiaro ma come SHA-256
--    (regola del progetto per tutti i token): la colonna passa da 32 a
--    64 caratteri. Il link si vede una volta sola, alla creazione; per
--    riaverlo si genera un link nuovo (quello vecchio smette di valere).
--    In produzione non ci sono ancora condivisioni, quindi nessun dato da
--    convertire.
-- =====================================================================

ALTER TABLE shares
  ADD COLUMN public_id CHAR(22) NULL AFTER id,
  MODIFY token CHAR(64) NULL;   -- SHA-256 (hex) del token del link libero

UPDATE shares
   SET public_id = LEFT(REPLACE(UUID(), '-', ''), 22)
 WHERE public_id IS NULL;

ALTER TABLE shares
  MODIFY public_id CHAR(22) NOT NULL,
  ADD UNIQUE KEY uq_shares_public (public_id),
  ADD KEY ix_shares_created (created_at);
