import { FILTER_PARAMS, MONTH_NAMES, type DateFilter } from "@/lib/filter-rules";

/*
 * Campi dei filtri condivisi da Album e Foto, da mettere dentro un <form>
 * in GET: ogni select è un parametro dell'URL (vedi FILTER_PARAMS).
 * Solo pagine del proprietario: le persone hanno i nomi.
 */

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/** Anno, mese e giorno di scatto: ognuno facoltativo. */
export function DateSelects({ value, years }: { value: DateFilter; years: number[] }) {
  // Un anno nell'URL che non ha (più) foto resta comunque scelto.
  const yearOptions = value.year !== undefined && !years.includes(value.year) ? [value.year, ...years] : years;
  return (
    <span className="filter-date" role="group" aria-label="Data di scatto">
      <select name={FILTER_PARAMS.year} defaultValue={value.year ?? ""} aria-label="Anno">
        <option value="">Anno</option>
        {yearOptions.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <select name={FILTER_PARAMS.month} defaultValue={value.month ?? ""} aria-label="Mese">
        <option value="">Mese</option>
        {MONTH_NAMES.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <select name={FILTER_PARAMS.day} defaultValue={value.day ?? ""} aria-label="Giorno">
        <option value="">Giorno</option>
        {DAYS.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </span>
  );
}

export function PersonSelect({
  value,
  people,
}: {
  value: string | undefined;
  people: { public_id: string; name: string }[];
}) {
  if (people.length === 0) return null;
  return (
    <select name={FILTER_PARAMS.person} defaultValue={value ?? ""} aria-label="Persona">
      <option value="">Tutte le persone</option>
      {people.map((p) => (
        <option key={p.public_id} value={p.public_id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
