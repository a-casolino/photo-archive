-- =====================================================================
-- 011: import da Google Drive, eseguito dalla VPS (richiesta di Antonio
-- del 2026-11-09).
--
-- Antonio non vuole scaricare il Takeout di Google Foto sul suo computer e
-- ricaricarlo: chiede il Takeout "su Drive" e la VPS legge gli zip da lì.
-- Allo stesso modo si importano cartelle normali di Drive (album che
-- stanno solo su Drive). Il lavoro lo fa `npm run drive` (cron sulla VPS).
-- =====================================================================

-- ---------------------------------------------------------------------
-- ACCOUNT GOOGLE DRIVE COLLEGATO
-- Un solo account, del proprietario, in sola lettura (drive.readonly).
-- Il refresh token è cifrato (AES-256-GCM con GOOGLE_TOKEN_SECRET).
-- ---------------------------------------------------------------------

CREATE TABLE google_drive_accounts (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id             BIGINT UNSIGNED NOT NULL,
  email               VARCHAR(320) NULL,
  refresh_token_enc   VARCHAR(2048) NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at        DATETIME NULL,
  UNIQUE KEY uq_google_drive_user (user_id),
  CONSTRAINT fk_google_drive_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
-- CODA DEGLI IMPORT DA DRIVE
-- Il proprietario sceglie un export di Takeout (tutti i suoi zip) o una
-- cartella; `npm run drive` li lavora uno alla volta, a lotti, e per ogni
-- lotto lancia il normale programma di import (righe in `imports`).
-- ---------------------------------------------------------------------

CREATE TABLE drive_imports (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id       CHAR(22) NOT NULL,
  kind            ENUM('takeout','folder') NOT NULL,
  label           VARCHAR(255) NOT NULL,           -- "Takeout del 09/11/2026" o il nome della cartella
  drive_ids       JSON NOT NULL,                   -- takeout: id degli zip; folder: [id della cartella]
  status          ENUM('queued','running','finished','failed','cancelled') NOT NULL DEFAULT 'queued',
  message         VARCHAR(1024) NULL,              -- fase in corso, oppure il motivo dell'errore
  batches_total   INT UNSIGNED NULL,
  batches_done    INT UNSIGNED NOT NULL DEFAULT 0, -- lotti completati: alla ripresa si saltano
  files_total     INT UNSIGNED NULL,               -- foto da importare (video e altri file esclusi)
  bytes_total     BIGINT UNSIGNED NULL,
  created_by      BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at      DATETIME NULL,
  finished_at     DATETIME NULL,
  heartbeat_at    DATETIME NULL,                   -- ultimo segnale di `npm run drive`
  UNIQUE KEY uq_drive_imports_public (public_id),
  KEY ix_drive_imports_status (status, created_at),
  CONSTRAINT fk_drive_imports_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
