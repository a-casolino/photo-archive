-- =====================================================================
-- 014: caricamento dal browser (richiesta di Antonio del 2026-11-10).
--
-- La pagina "Carica dal browser" registra ogni foto appena sono arrivate
-- le anteprime, così l'album è completo dopo pochi minuti; i CR2 (e gli
-- altri originali) arrivano dopo, con l'upload riprendibile di Cloud
-- Storage.
--   - photos.original_pending: 1 finché l'originale non è nell'archivio.
--     Il download dell'originale resta spento; ricaricando la stessa
--     cartella (o rilanciando il programma di import) l'originale riparte.
--   - upload_sessions: sessioni riprendibili di Cloud Storage aperte per
--     gli originali (valgono 7 giorni). Permettono di riprendere un file a
--     metà anche dopo aver chiuso la pagina. L'indirizzo della sessione
--     consente solo di caricare quel file.
-- =====================================================================

ALTER TABLE photos
  ADD COLUMN original_pending TINYINT(1) NOT NULL DEFAULT 0 AFTER gcs_original_class;

CREATE TABLE upload_sessions (
  object_key   VARCHAR(512) NOT NULL PRIMARY KEY,
  sha256       CHAR(64) NOT NULL,
  size         BIGINT UNSIGNED NOT NULL,
  session_url  TEXT NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME NOT NULL,
  KEY ix_upload_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
