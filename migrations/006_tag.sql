-- =====================================================================
-- 006: tag su album e foto (richiesta di Antonio del 2026-11-08)
--
-- Etichette libere ("montagna", "famiglia", "Marco"...) per ritrovare
-- foto e album. Per ora le vede e le gestisce solo il proprietario.
-- Il nome si scrive come si vuole; `slug` (minuscolo, senza accenti) lo
-- rende univoco e va negli URL (/tag/<slug>): non è un id numerico.
-- =====================================================================

CREATE TABLE tags (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(64) NOT NULL,            -- come l'ha scritto Antonio
  slug            VARCHAR(80) NOT NULL,            -- "montagna", "lago-di-garda"
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tags_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE photo_tags (
  photo_id        BIGINT UNSIGNED NOT NULL,
  tag_id          INT UNSIGNED NOT NULL,
  added_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (photo_id, tag_id),
  KEY ix_photo_tags_tag (tag_id, photo_id),
  CONSTRAINT fk_pt_photo FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  CONSTRAINT fk_pt_tag   FOREIGN KEY (tag_id)   REFERENCES tags(id)   ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE album_tags (
  album_id        BIGINT UNSIGNED NOT NULL,
  tag_id          INT UNSIGNED NOT NULL,
  added_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (album_id, tag_id),
  KEY ix_album_tags_tag (tag_id, album_id),
  CONSTRAINT fk_at_album FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  CONSTRAINT fk_at_tag   FOREIGN KEY (tag_id)   REFERENCES tags(id)   ON DELETE CASCADE
) ENGINE=InnoDB;
