/** Formattazione per l'interfaccia (italiano, fuso Europe/Rome). */

export const dateTimeFmt = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Number(bytes);
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  return `${v.toLocaleString("it-IT", { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "meno di un minuto";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} giorni ${h % 24} h`;
}

export function formatCount(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : Number(n).toLocaleString("it-IT");
}

/**
 * Tempo stimato alla fine: dalla velocità recente se c'è, altrimenti dalla
 * velocità media da quando è iniziato. null se non si può ancora stimare.
 */
export function estimateRemainingMs(
  bytesDone: number,
  bytesTotal: number | null,
  elapsedMs: number,
  /** Velocità recente in byte/s, se il programma la manda: più fedele della media. */
  recentBps?: number | null,
): number | null {
  if (!bytesTotal || bytesDone <= 0 || elapsedMs < 10_000) return null;
  const rate = recentBps && recentBps > 0 ? recentBps / 1000 : bytesDone / elapsedMs;
  return Math.max(0, (bytesTotal - bytesDone) / rate);
}

/** Velocità: "2,1 MB/s (17 Mbit/s)", i Mbit/s sono l'unità delle offerte internet. */
export function formatRate(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond === null || bytesPerSecond === undefined || !Number.isFinite(bytesPerSecond)) return "—";
  const mbit = (bytesPerSecond * 8) / 1_000_000;
  const digits = mbit >= 10 ? 0 : 1;
  return `${formatBytes(Math.round(bytesPerSecond))}/s (${mbit.toLocaleString("it-IT", { maximumFractionDigits: digits })} Mbit/s)`;
}

/**
 * Ora di scatto EXIF: è l'ora locale della fotocamera, salvata così com'è
 * (il driver la legge come UTC), quindi si mostra senza conversioni.
 */
export function formatTakenAt(takenAt: Date | null, subsecMs?: number | null): string {
  if (!takenAt) return "data sconosciuta";
  const s = new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(takenAt);
  return subsecMs === null || subsecMs === undefined ? s : `${s},${String(subsecMs).padStart(3, "0")}`;
}
