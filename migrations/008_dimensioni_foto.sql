-- 008: dimensioni delle foto come sono nel file.
--
-- Il programma di import salvava larghezza e altezza già scambiate per le
-- foto ruotate di 90° (Orientation EXIF 5-8), e le gallerie le scambiavano
-- di nuovo con displaySize(): le miniature verticali risultavano deformate.
-- D'ora in poi width/height sono quelle del file (del sensore per i CR2) e
-- le scambia solo chi le mostra. Qui si correggono le foto già importate.

-- Copia a parte, così lo scambio non dipende dall'ordine delle assegnazioni.
CREATE TEMPORARY TABLE tmp_dimensioni AS
  SELECT id, width, height FROM photos
   WHERE orientation BETWEEN 5 AND 8 AND width IS NOT NULL AND height IS NOT NULL;

UPDATE photos p JOIN tmp_dimensioni t ON t.id = p.id
   SET p.width = t.height, p.height = t.width;

DROP TEMPORARY TABLE tmp_dimensioni;
