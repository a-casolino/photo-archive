-- 004: dettagli sull'attività in corso di un import.
--
-- Il programma di import manda ogni pochi secondi cosa sta facendo: i file
-- in lavorazione (uno per lavoro in parallelo) con la fase di ognuno, la
-- velocità di upload e quella di lavorazione. Si tiene solo l'ultimo
-- stato, come JSON; a fine import torna NULL.

ALTER TABLE imports
  ADD COLUMN activity_json JSON NULL AFTER current_file;
