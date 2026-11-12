-- =====================================================================
-- 017: verifica di un export di Takeout già importato (richiesta di
-- Antonio del 2026-11-12, prima di cancellare gli zip da Drive).
--
-- Dalla pagina Import → Google Drive il proprietario mette in coda una
-- verifica; `npm run drive` (cron sulla VPS) legge solo l'indice degli zip
-- e confronta album per album le foto attese con quelle nell'archivio. Il
-- resoconto (JSON, vedi src/lib/takeout-check.ts) resta qui.
-- =====================================================================

CREATE TABLE drive_checks (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id       CHAR(22) NOT NULL,
  label           VARCHAR(255) NOT NULL,           -- "Takeout del 09/11/2026, 21:51"
  drive_ids       JSON NOT NULL,                   -- id degli zip su Drive
  status          ENUM('queued','running','finished','failed') NOT NULL DEFAULT 'queued',
  message         VARCHAR(1024) NULL,              -- fase in corso, oppure il motivo dell'errore
  report          JSON NULL,                       -- resoconto, a verifica finita
  created_by      BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     DATETIME NULL,
  UNIQUE KEY uq_drive_checks_public (public_id),
  KEY ix_drive_checks_status (status, created_at),
  CONSTRAINT fk_drive_checks_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
