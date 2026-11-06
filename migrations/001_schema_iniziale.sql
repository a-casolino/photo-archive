-- 001: schema iniziale approvato il 2026-11-06 (docs/schema.sql)
-- =====================================================================
-- Archivio foto di Antonio — modello dati v1 (MySQL 8.0.16+)
-- Proposta del 2026-11-06. Decisi con Antonio: scadenza link liberi 30 gg,
-- download originali in base al ruolo utente.
-- Charset utf8mb4, tutte le date in UTC salvo dove indicato.
-- =====================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- UTENTI E ACCESSO
-- Se usiamo una libreria di auth (es. Better Auth), le tabelle
-- users / sessions / reset le genera lei: in quel caso teniamo solo
-- il campo `role` e le nostre tabelle puntano a users.id.
-- ---------------------------------------------------------------------

CREATE TABLE users (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email           VARCHAR(255) NOT NULL,
  name            VARCHAR(120) NOT NULL,
  password_hash   VARCHAR(255) NULL,               -- NULL finché l'invitato non sceglie la password
  -- Ruolo = livello di accesso ai download (deciso con Antonio il 2026-11-06):
  --   owner   -> Antonio: tutto
  --   trusted -> può scaricare gli originali (CR2) se la condivisione lo permette
  --   viewer  -> vede e scarica al massimo il JPEG grande
  role            ENUM('owner','trusted','viewer') NOT NULL DEFAULT 'viewer',
  email_verified_at DATETIME NULL,
  disabled_at     DATETIME NULL,
  last_login_at   DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Sessioni lato server (revocabili, a differenza di un JWT puro).
CREATE TABLE sessions (
  id              CHAR(64) PRIMARY KEY,            -- hash SHA-256 del token nel cookie
  user_id         BIGINT UNSIGNED NOT NULL,
  expires_at      DATETIME NOT NULL,
  ip              VARCHAR(45) NULL,
  user_agent      VARCHAR(255) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Token monouso per: invito (primo accesso) e reset password.
CREATE TABLE auth_tokens (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  purpose         ENUM('invite','password_reset','email_verify') NOT NULL,
  token_hash      CHAR(64) NOT NULL,               -- mai il token in chiaro
  expires_at      DATETIME NOT NULL,
  used_at         DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_auth_tokens_hash (token_hash),
  CONSTRAINT fk_auth_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- IMPORTAZIONI
-- Ogni esecuzione dello script di migrazione (disco CR2 o Takeout)
-- è un "import": serve a riprendere dopo un errore e a sapere da dove
-- arriva ogni foto.
-- ---------------------------------------------------------------------

CREATE TABLE imports (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source          ENUM('cr2_disk','google_takeout') NOT NULL,
  label           VARCHAR(255) NOT NULL,           -- es. "Disco WD 1TB" o "Takeout 2026-11"
  started_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     DATETIME NULL,
  files_seen      INT UNSIGNED NOT NULL DEFAULT 0,
  files_imported  INT UNSIGNED NOT NULL DEFAULT 0,
  files_skipped   INT UNSIGNED NOT NULL DEFAULT 0, -- duplicati (stesso sha256)
  files_failed    INT UNSIGNED NOT NULL DEFAULT 0,
  log             MEDIUMTEXT NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- FOTOCAMERE
-- Necessaria per il match export Google Foto -> CR2 (data/ora + seriale).
-- ---------------------------------------------------------------------

CREATE TABLE cameras (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  make            VARCHAR(64) NOT NULL,            -- "Canon", "Apple", ...
  model           VARCHAR(128) NOT NULL,           -- "Canon EOS 7D", "iPhone 15", ...
  serial          VARCHAR(64) NOT NULL DEFAULT '', -- EXIF SerialNumber; '' per i telefoni
  display_name    VARCHAR(128) NULL,               -- nome comodo scelto da Antonio
  UNIQUE KEY uq_cameras (make, model, serial)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- FOTO
-- Una riga per ogni file: CR2 originale, foto da cellulare, export
-- modificato. Gli export puntano al loro CR2 con derived_from_id.
-- ---------------------------------------------------------------------

CREATE TABLE photos (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id       CHAR(22) NOT NULL,               -- id casuale usato negli URL (mai l'id numerico)
  kind            ENUM('raw','phone','edit') NOT NULL,
  import_id       BIGINT UNSIGNED NULL,

  -- File originale
  original_filename VARCHAR(255) NOT NULL,         -- "IMG_4821.CR2"
  source_path     VARCHAR(1024) NULL,              -- percorso relativo sul disco o nel Takeout
  sha256          CHAR(64) NOT NULL,               -- deduplica: lo stesso file non entra due volte
  file_size       BIGINT UNSIGNED NOT NULL,
  mime_type       VARCHAR(64) NOT NULL,            -- image/x-canon-cr2, image/jpeg, image/heic, video/mp4
  width           SMALLINT UNSIGNED NULL,
  height          SMALLINT UNSIGNED NULL,
  orientation     TINYINT UNSIGNED NULL,           -- EXIF Orientation 1..8

  -- Google Cloud Storage
  gcs_original_key VARCHAR(512) NOT NULL,          -- es. originals/2014/2014-07-12/IMG_4821.CR2
  gcs_original_class ENUM('ARCHIVE','COLDLINE','NEARLINE','STANDARD') NOT NULL,
  gcs_preview_key VARCHAR(512) NULL,               -- JPEG grande (~2048px lato lungo)
  gcs_thumb_key   VARCHAR(512) NULL,               -- miniatura (~400px) per le griglie

  -- EXIF
  taken_at        DATETIME NULL,                   -- DateTimeOriginal così com'è (ora locale della fotocamera)
  taken_at_subsec SMALLINT UNSIGNED NULL,          -- SubSecTimeOriginal, aiuta a distinguere le raffiche
  taken_at_utc    DATETIME NULL,                   -- se nota (OffsetTime o JSON di Takeout)
  camera_id       INT UNSIGNED NULL,
  lens            VARCHAR(128) NULL,
  focal_length_mm DECIMAL(6,1) NULL,
  aperture        DECIMAL(4,1) NULL,
  exposure_time   VARCHAR(16) NULL,                -- "1/250"
  iso             MEDIUMINT UNSIGNED NULL,
  gps_lat         DECIMAL(9,6) NULL,
  gps_lon         DECIMAL(9,6) NULL,
  exif_json       JSON NULL,                       -- tutto l'output di exiftool, per non perdere nulla

  -- Collegamento export -> CR2 originale
  derived_from_id BIGINT UNSIGNED NULL,
  match_status    ENUM('none','auto','confirmed','rejected') NOT NULL DEFAULT 'none',
  match_method    VARCHAR(32) NULL,                -- 'serial+datetime', 'datetime', 'manual'

  -- Dati editoriali
  title           VARCHAR(255) NULL,
  description     TEXT NULL,
  rating          TINYINT UNSIGNED NULL,           -- 0..5
  google_photos_url VARCHAR(512) NULL,             -- dal JSON di Takeout, se presente

  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,                   -- cestino: niente cancellazioni immediate

  UNIQUE KEY uq_photos_public (public_id),
  UNIQUE KEY uq_photos_sha (sha256),
  KEY ix_photos_taken (taken_at),
  KEY ix_photos_match (camera_id, taken_at, taken_at_subsec),  -- la query del match
  KEY ix_photos_derived (derived_from_id),
  KEY ix_photos_kind (kind, taken_at),
  CONSTRAINT fk_photos_import  FOREIGN KEY (import_id)       REFERENCES imports(id) ON DELETE SET NULL,
  CONSTRAINT fk_photos_camera  FOREIGN KEY (camera_id)       REFERENCES cameras(id),
  CONSTRAINT fk_photos_derived FOREIGN KEY (derived_from_id) REFERENCES photos(id)  ON DELETE SET NULL,
  CONSTRAINT ck_photos_rating  CHECK (rating IS NULL OR rating BETWEEN 0 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
-- ALBUM
-- Un album può nascere da una cartella del disco, da un album di
-- Google Foto (Takeout) o essere creato a mano nell'app.
-- Una foto può stare in più album (N:N).
-- ---------------------------------------------------------------------

CREATE TABLE albums (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id       CHAR(22) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  description     TEXT NULL,
  origin          ENUM('disk_folder','google_photos','manual') NOT NULL,
  origin_ref      VARCHAR(1024) NULL,              -- percorso cartella o nome album nel Takeout
  cover_photo_id  BIGINT UNSIGNED NULL,
  date_from       DATE NULL,                       -- calcolate dalle foto, per ordinare/filtrare
  date_to         DATE NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  UNIQUE KEY uq_albums_public (public_id),
  CONSTRAINT fk_albums_cover FOREIGN KEY (cover_photo_id) REFERENCES photos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE album_photos (
  album_id        BIGINT UNSIGNED NOT NULL,
  photo_id        BIGINT UNSIGNED NOT NULL,
  position        INT UNSIGNED NOT NULL DEFAULT 0, -- ordine manuale; 0 = per data
  added_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (album_id, photo_id),
  KEY ix_album_photos_photo (photo_id),
  CONSTRAINT fk_ap_album FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  CONSTRAINT fk_ap_photo FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- CONDIVISIONI
-- Una condivisione riguarda UNA foto oppure UN album, in una di due
-- modalità:
--   'users' -> protetta: solo gli utenti in share_recipients, dopo login
--   'link'  -> libera: chiunque abbia l'URL con il token casuale
--              (pagina con <meta name="robots" content="noindex">)
-- Condividere un album dà accesso anche alle foto aggiunte dopo.
-- ---------------------------------------------------------------------

CREATE TABLE shares (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  target_type     ENUM('photo','album') NOT NULL,
  photo_id        BIGINT UNSIGNED NULL,
  album_id        BIGINT UNSIGNED NULL,
  mode            ENUM('users','link') NOT NULL,
  token           CHAR(32) NULL,                   -- solo per 'link': 32 caratteri base62 casuali (~190 bit)
  message         TEXT NULL,                       -- nota per i destinatari
  -- Tetto di download della condivisione. Il permesso effettivo è il
  -- minimo tra questo e il ruolo dell'utente:
  --   viewer  -> min(allow_download, 'preview')
  --   trusted -> allow_download
  -- I link liberi non hanno utente, quindi mai 'original' (vedi CHECK).
  allow_download  ENUM('none','preview','original') NOT NULL DEFAULT 'preview',
  expires_at      DATETIME NULL,                   -- NULL = non scade. Default dell'app:
                                                   -- 'link' -> +30 giorni, 'users' -> NULL
  revoked_at      DATETIME NULL,
  created_by      BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  view_count      INT UNSIGNED NOT NULL DEFAULT 0,
  last_viewed_at  DATETIME NULL,
  UNIQUE KEY uq_shares_token (token),
  KEY ix_shares_photo (photo_id),
  KEY ix_shares_album (album_id),
  -- Niente ON DELETE sulle FK usate nei CHECK (limite di MySQL):
  -- foto e album si cancellano "soft", quindi non è un problema.
  CONSTRAINT fk_shares_photo   FOREIGN KEY (photo_id)   REFERENCES photos(id),
  CONSTRAINT fk_shares_album   FOREIGN KEY (album_id)   REFERENCES albums(id),
  CONSTRAINT fk_shares_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_shares_target CHECK (
    (target_type = 'photo' AND photo_id IS NOT NULL AND album_id IS NULL) OR
    (target_type = 'album' AND album_id IS NOT NULL AND photo_id IS NULL)
  ),
  CONSTRAINT ck_shares_token CHECK (
    (mode = 'link'  AND token IS NOT NULL) OR
    (mode = 'users' AND token IS NULL)
  ),
  CONSTRAINT ck_shares_link_no_original CHECK (
    mode = 'users' OR allow_download <> 'original'
  )
) ENGINE=InnoDB;

-- Destinatari di una condivisione protetta: è ciò che popola la
-- dashboard di ogni utente.
CREATE TABLE share_recipients (
  share_id        BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  notified_at     DATETIME NULL,                   -- email "Antonio ha condiviso con te..."
  first_viewed_at DATETIME NULL,                   -- per mostrare "nuovo" in dashboard
  PRIMARY KEY (share_id, user_id),
  KEY ix_share_recipients_user (user_id),
  CONSTRAINT fk_sr_share FOREIGN KEY (share_id) REFERENCES shares(id) ON DELETE CASCADE,
  CONSTRAINT fk_sr_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
) ENGINE=InnoDB;

-- Registro accessi/download (utile se si concede il download degli originali).
CREATE TABLE share_events (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  share_id        BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NULL,            -- NULL per i link liberi
  photo_id        BIGINT UNSIGNED NULL,
  event           ENUM('view','download_preview','download_original') NOT NULL,
  ip              VARCHAR(45) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_share_events_share (share_id, created_at),
  CONSTRAINT fk_se_share FOREIGN KEY (share_id) REFERENCES shares(id) ON DELETE CASCADE
) ENGINE=InnoDB;

