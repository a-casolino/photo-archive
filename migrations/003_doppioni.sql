-- =====================================================================
-- 003: probabili doppioni
--
-- Due CR2 sono "probabili doppioni" quando hanno file diversi (SHA-256
-- diverso) ma vengono dalla stessa fotocamera, nello stesso istante, con
-- lo stesso numero di file Canon (FileNumber, es. "100-3681"); se il
-- numero manca, con lo stesso nome file e gli stessi millisecondi.
-- Le coppie si calcolano al volo (src/lib/duplicates.ts); qui si
-- ricordano solo quelle che Antonio ha giudicato "foto diverse", per non
-- riproporle. Scartare un doppione = cestino (photos.deleted_at).
-- =====================================================================

CREATE TABLE duplicate_dismissals (
  photo_a         BIGINT UNSIGNED NOT NULL,        -- id minore della coppia
  photo_b         BIGINT UNSIGNED NOT NULL,        -- id maggiore
  decided_by      BIGINT UNSIGNED NOT NULL,
  decided_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (photo_a, photo_b),
  CONSTRAINT fk_dd_a    FOREIGN KEY (photo_a)    REFERENCES photos(id) ON DELETE CASCADE,
  CONSTRAINT fk_dd_b    FOREIGN KEY (photo_b)    REFERENCES photos(id) ON DELETE CASCADE,
  CONSTRAINT fk_dd_user FOREIGN KEY (decided_by) REFERENCES users(id),
  CONSTRAINT ck_dd_order CHECK (photo_a < photo_b)
) ENGINE=InnoDB;
