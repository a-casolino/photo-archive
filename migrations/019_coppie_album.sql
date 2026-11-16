-- =====================================================================
-- 019: coppie album Google ↔ cartella del disco (richiesta di Antonio del
-- 2026-11-16, passo 2 dell'unione degli album).
--
-- Un album di primo livello che viene da Google Foto/Drive è una selezione
-- esportata di un evento; gli scatti originali stanno in una o più cartelle
-- del disco (Backup Foto › anno › giorno). L'app propone le coppie
-- (src/lib/album-pair-rules.ts), il proprietario le conferma o le scarta in
-- Import → Coppie album. Il passo successivo (unione) userà solo le coppie
-- confermate. Una cartella appartiene al più a un album.
-- =====================================================================

CREATE TABLE album_pairs (
  google_album_id BIGINT UNSIGNED NOT NULL,
  folder_album_id BIGINT UNSIGNED NOT NULL,
  shared_photos   INT UNSIGNED NOT NULL,           -- foto dell'album Google il cui originale sta nella cartella
  album_photos    INT UNSIGNED NOT NULL,           -- foto dell'album Google al momento del calcolo
  status          ENUM('proposed','confirmed','rejected') NOT NULL DEFAULT 'proposed',
  computed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at      DATETIME NULL,
  PRIMARY KEY (google_album_id, folder_album_id),
  KEY ix_album_pairs_folder (folder_album_id),
  KEY ix_album_pairs_status (status),
  CONSTRAINT fk_album_pairs_google FOREIGN KEY (google_album_id) REFERENCES albums(id) ON DELETE CASCADE,
  CONSTRAINT fk_album_pairs_folder FOREIGN KEY (folder_album_id) REFERENCES albums(id) ON DELETE CASCADE
) ENGINE=InnoDB;
