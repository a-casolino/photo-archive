-- =====================================================================
-- 013: link liberi rivedibili (richiesta di Antonio del 2026-11-09).
--
-- Finora del token dei link liberi c'era solo lo SHA-256 (`token`), quindi
-- il link si vedeva una volta sola. Ora se ne salva anche una copia
-- cifrata (AES-256-GCM, chiave nel .env: SHARE_LINK_SECRET, o in mancanza
-- GOOGLE_TOKEN_SECRET), così il proprietario lo rivede e lo copia
-- dall'elenco delle condivisioni. L'apertura del link continua a usare
-- solo l'hash. I link creati prima restano senza copia: "Nuovo link" la
-- crea.
-- =====================================================================

ALTER TABLE shares
  ADD COLUMN token_enc VARCHAR(255) NULL AFTER token;
