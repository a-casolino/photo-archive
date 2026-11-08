/** Periodo di un album: "12 lug 2014" oppure "12 lug – 3 ago 2014". */
const day = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function albumDates(a: { date_from: Date | null; date_to: Date | null }): string {
  if (!a.date_from) return "";
  const from = day.format(a.date_from);
  if (!a.date_to || a.date_to.getTime() === a.date_from.getTime()) return from;
  return `${from} – ${day.format(a.date_to)}`;
}
