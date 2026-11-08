-- =====================================================================
-- 006: volti e persone
--
-- `npm run volti` (sulla VPS) trova i volti nelle anteprime con
-- InsightFace, ne calcola l'impronta e li registra qui. Antonio dà un
-- nome ai gruppi di volti simili; la pagina di una persona mostra tutte
-- le foto in cui compare. Tutto visibile solo al proprietario.
--
-- Le impronte (faces.embedding) sono dati biometrici: non escono mai dal
-- server. Eliminare una persona o una foto elimina anche i suoi volti.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PERSONE: quelle a cui Antonio ha dato un nome
-- ---------------------------------------------------------------------

CREATE TABLE people (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id       CHAR(22) NOT NULL,               -- negli URL, mai l'id numerico
  name            VARCHAR(255) NOT NULL,
  cover_face_id   BIGINT UNSIGNED NULL,            -- volto usato come foto profilo
  centroid        VARBINARY(2048) NULL,            -- media normalizzata delle impronte confermate, per i suggerimenti
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_people_public (public_id),
  KEY ix_people_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
-- VOLTI: uno per ogni volto trovato in una foto
-- ---------------------------------------------------------------------

CREATE TABLE faces (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  photo_id        BIGINT UNSIGNED NOT NULL,
  -- Riquadro in frazioni (0..1) dell'anteprima già ruotata: vale per
  -- anteprima, miniatura e visore qualunque sia la loro dimensione.
  box_x           FLOAT NOT NULL,
  box_y           FLOAT NOT NULL,
  box_w           FLOAT NOT NULL,
  box_h           FLOAT NOT NULL,
  landmarks       JSON NULL,                       -- 5 punti (occhi, naso, bocca) nelle stesse frazioni
  det_score       FLOAT NOT NULL,                  -- quanto il rilevatore è sicuro che sia un volto
  embedding       VARBINARY(2048) NOT NULL,        -- 512 float32: l'impronta del volto (dato biometrico)
  model           VARCHAR(32) NOT NULL,            -- 'buffalo_l': impronte di modelli diversi non si confrontano
  gcs_face_key    VARCHAR(512) NULL,               -- miniatura del volto (160 px)
  cluster_id      INT UNSIGNED NULL,               -- gruppo di volti simili ancora senza nome
  person_id       BIGINT UNSIGNED NULL,
  -- unknown   = nessun nome
  -- suggested = l'app propone person_id, Antonio deve confermare
  -- confirmed = Antonio ha confermato person_id
  -- ignored   = sconosciuto o non interessante: non viene più proposto
  status          ENUM('unknown','suggested','confirmed','ignored') NOT NULL DEFAULT 'unknown',
  suggest_score   FLOAT NULL,                      -- somiglianza con la persona suggerita
  confirmed_at    DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_faces_photo (photo_id),
  KEY ix_faces_person (person_id, status),
  KEY ix_faces_cluster (status, cluster_id),
  CONSTRAINT fk_faces_photo  FOREIGN KEY (photo_id)  REFERENCES photos(id) ON DELETE CASCADE,
  CONSTRAINT fk_faces_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
  -- Niente CHECK su status/person_id: MySQL non lo permette su una colonna
  -- con ON DELETE SET NULL. Quando si elimina una persona, l'app elimina
  -- anche i suoi volti (le impronte non devono restare).
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE people
  ADD CONSTRAINT fk_people_cover FOREIGN KEY (cover_face_id) REFERENCES faces(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- SCARTI: "non è questa persona", per non riproporre lo stesso volto
-- ---------------------------------------------------------------------

CREATE TABLE face_rejections (
  face_id         BIGINT UNSIGNED NOT NULL,
  person_id       BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (face_id, person_id),
  KEY ix_face_rejections_person (person_id),
  CONSTRAINT fk_fr_face   FOREIGN KEY (face_id)   REFERENCES faces(id)  ON DELETE CASCADE,
  CONSTRAINT fk_fr_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- FOTO: quali sono già state analizzate
-- Distingue "nessun volto" da "non ancora analizzata", così
-- `npm run volti` riprende da dove si era fermato.
-- ---------------------------------------------------------------------

ALTER TABLE photos
  ADD COLUMN faces_scanned_at DATETIME NULL,
  ADD COLUMN faces_model      VARCHAR(32) NULL,
  ADD KEY ix_photos_faces (faces_model, faces_scanned_at);
