-- =====================================================================
-- 002: import dal computer di Antonio
--
-- Il programma di import gira sul computer di Antonio, legge il disco
-- (CR2) o le cartelle di Google Takeout, crea le anteprime e carica i
-- file direttamente su Google Cloud Storage con URL firmati che gli dà
-- l'app. L'app tiene traccia di import, avanzamento ed errori.
-- =====================================================================

-- ---------------------------------------------------------------------
-- CHIAVI DEI COMPUTER
-- Il programma di import si autentica con una chiave creata dal
-- proprietario nella pagina Import. Nel DB solo lo SHA-256.
-- ---------------------------------------------------------------------

CREATE TABLE import_devices (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,           -- "MacBook di Antonio"
  token_hash      CHAR(64) NOT NULL,
  token_hint      CHAR(4) NOT NULL,                -- ultimi 4 caratteri, per riconoscerla
  created_by      BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at    DATETIME NULL,
  revoked_at      DATETIME NULL,
  UNIQUE KEY uq_import_devices_token (token_hash),
  CONSTRAINT fk_import_devices_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
-- IMPORT: stato e avanzamento
-- ---------------------------------------------------------------------

ALTER TABLE imports
  ADD COLUMN public_id        CHAR(22) NULL AFTER id,
  ADD COLUMN status           ENUM('running','finished','interrupted','failed') NOT NULL DEFAULT 'running' AFTER label,
  ADD COLUMN device_id        INT UNSIGNED NULL AFTER status,
  ADD COLUMN root_path        VARCHAR(1024) NULL AFTER device_id,  -- cartella letta sul computer
  ADD COLUMN files_total      INT UNSIGNED NULL AFTER files_seen,  -- file trovati dalla scansione
  ADD COLUMN bytes_total      BIGINT UNSIGNED NULL,                -- dimensione di tutti i file trovati
  ADD COLUMN bytes_done       BIGINT UNSIGNED NOT NULL DEFAULT 0,  -- dimensione dei file già trattati
  ADD COLUMN bytes_uploaded   BIGINT UNSIGNED NOT NULL DEFAULT 0,  -- dimensione caricata davvero
  ADD COLUMN current_file     VARCHAR(1024) NULL,
  ADD COLUMN last_seen_at     DATETIME NULL,                       -- ultimo segnale dal programma
  ADD UNIQUE KEY uq_imports_public (public_id),
  ADD KEY ix_imports_started (started_at),
  ADD CONSTRAINT fk_imports_device FOREIGN KEY (device_id) REFERENCES import_devices(id) ON DELETE SET NULL;

-- Gli import creati prima di questa migrazione (non ce ne sono in
-- produzione, ma per sicurezza) ricevono un public_id e risultano chiusi.
UPDATE imports
   SET public_id = LEFT(REPLACE(UUID(), '-', ''), 22),
       status = IF(finished_at IS NULL, 'interrupted', 'finished')
 WHERE public_id IS NULL;

ALTER TABLE imports MODIFY public_id CHAR(22) NOT NULL;

-- ---------------------------------------------------------------------
-- ERRORI DI IMPORT
-- Un file che non è entrato, con il motivo. Visibili nel dettaglio
-- dell'import. Rilanciando l'import il file viene ritentato; l'errore
-- resta come storico di quell'import.
-- ---------------------------------------------------------------------

CREATE TABLE import_errors (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  import_id       BIGINT UNSIGNED NOT NULL,
  source_path     VARCHAR(1024) NOT NULL,
  message         VARCHAR(2000) NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_import_errors_import (import_id, id),
  CONSTRAINT fk_import_errors_import FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
-- ALBUM: un album nato da una cartella o da un album di Takeout si
-- ritrova con (origin, origin_ref), così un secondo import non lo duplica.
-- ---------------------------------------------------------------------

ALTER TABLE albums
  ADD COLUMN origin_key CHAR(64) GENERATED ALWAYS AS (
    IF(origin = 'manual', NULL, SHA2(CONCAT(origin, ':', origin_ref), 256))
  ) STORED,
  ADD UNIQUE KEY uq_albums_origin (origin_key);
