-- 009: dimensioni dei CR2 importati con il programma vecchio dopo la 008.
--
-- Una copia del programma di import non aggiornata ha continuato a salvare
-- le dimensioni già scambiate per i CR2 verticali (Orientation 5-8). Il
-- sensore di una reflex è sempre orizzontale, quindi un CR2 con larghezza
-- minore dell'altezza è sicuramente scambiato: si rimette a posto. Da ora
-- l'app rifiuta le versioni vecchie del programma (MIN_PROGRAM_VERSION).

CREATE TEMPORARY TABLE tmp_dimensioni_cr2 AS
  SELECT id, width, height FROM photos
   WHERE kind = 'raw' AND orientation BETWEEN 5 AND 8 AND width < height;

UPDATE photos p JOIN tmp_dimensioni_cr2 t ON t.id = p.id
   SET p.width = t.height, p.height = t.width;

DROP TEMPORARY TABLE tmp_dimensioni_cr2;
