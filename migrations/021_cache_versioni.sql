-- =====================================================================
-- 021: versioni della cache in memoria dell'app (richiesta di Antonio del
-- 2026-11-20, thread "Aggiungere una cache per velocizzare l'app").
--
-- L'app tiene in memoria i conteggi pesanti (album, persone, volti) e li
-- svuota quando li cambia lei. I programmi da riga di comando (volti,
-- drive, cestino, impronte) girano in processi separati: quando scrivono
-- aumentano la versione dell'etichetta ('album', 'volti') e l'app, vista
-- la versione nuova, svuota le voci di quell'etichetta.
-- =====================================================================

CREATE TABLE cache_versions (
  tag        VARCHAR(32) NOT NULL PRIMARY KEY,
  version    BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB;
