-- =====================================================================
-- 015: link con nome (richiesta di Antonio del 2026-11-10).
--
-- Indirizzi perpetui scelti dal proprietario, es. /l/vizzarri. La
-- destinazione si cambia quando si vuole: oggi un album, domani un altro
-- album o una singola foto. Valgono come i link liberi (nessun login, mai
-- gli originali), ma senza scadenza.
--
-- Tabella a parte rispetto a `shares`: un link con nome deve sopravvivere
-- alla destinazione. Se l'album o la foto finiscono nel cestino il link
-- mostra "Link non disponibile"; quando vengono eliminati per sempre la
-- destinazione torna NULL (ON DELETE SET NULL) e il nome resta di Antonio,
-- pronto per una nuova destinazione.
--   - slug: il nome nell'URL, solo minuscole, numeri e trattini, 2-30
--     caratteri (i token dei link liberi ne hanno 32: non si confondono).
--   - photo_id / album_id: al massimo uno dei due (lo controlla l'app:
--     MySQL non ammette CHECK su colonne con ON DELETE SET NULL).
--   - disabled_at: link disattivato dal proprietario (riattivabile).
-- =====================================================================

CREATE TABLE named_links (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id       CHAR(22) NOT NULL,
  slug            VARCHAR(30) NOT NULL,
  photo_id        BIGINT UNSIGNED NULL,
  album_id        BIGINT UNSIGNED NULL,
  allow_download  ENUM('none','preview') NOT NULL DEFAULT 'preview',
  disabled_at     DATETIME NULL,
  created_by      BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pointed_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,  -- ultimo cambio di destinazione
  view_count      INT UNSIGNED NOT NULL DEFAULT 0,
  last_viewed_at  DATETIME NULL,
  UNIQUE KEY uq_named_links_public (public_id),
  UNIQUE KEY uq_named_links_slug (slug),
  KEY ix_named_links_photo (photo_id),
  KEY ix_named_links_album (album_id),
  CONSTRAINT fk_nl_photo   FOREIGN KEY (photo_id)   REFERENCES photos(id) ON DELETE SET NULL,
  CONSTRAINT fk_nl_album   FOREIGN KEY (album_id)   REFERENCES albums(id) ON DELETE SET NULL,
  CONSTRAINT fk_nl_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
