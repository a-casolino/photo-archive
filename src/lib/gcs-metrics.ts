import "server-only";
import { normalizeClass, operationClass, type StorageClass } from "./cost-rules";
import { env } from "./env";

/*
 * Metriche reali del bucket da Cloud Monitoring (API REST v3), per la pagina
 * Statistiche. Usa lo stesso account di servizio dell'archivio, che deve avere
 * il ruolo "Monitoring Viewer" (roles/monitoring.viewer) sul progetto: senza,
 * la pagina ripiega sulle stime dal database.
 *
 * Google aggiorna spazio e numero di file una volta al giorno; traffico e
 * richieste ogni minuto (con qualche minuto di ritardo).
 */

export type DailyBytes = { date: string; bytes: number };

export type BucketMetrics = {
  /** Byte e file per classe (oggetti vivi + eliminati temporaneamente, che Google fattura). */
  storage: { cls: StorageClass; bytes: number; objects: number }[];
  /** Ultimi 30 giorni, giorno per giorno (UTC). */
  egressDaily: DailyBytes[];
  ingressDaily: DailyBytes[];
  opsA: number;
  opsB: number;
  /** Quando Google ha misurato lo spazio l'ultima volta. */
  measuredAt: Date | null;
};

export type MetricsResult =
  | { ok: true; metrics: BucketMetrics }
  | { ok: false; reason: "local" | "no-bucket" | "permission" | "error"; message: string };

const CACHE_MS = 10 * 60 * 1000;
const DAY_S = 86400;

const g = globalThis as unknown as {
  __gcsMetrics?: { at: number; result: MetricsResult };
  __monitoringAuth?: unknown;
};

type TimeSeries = {
  metric?: { labels?: Record<string, string> };
  points?: { interval: { startTime: string; endTime: string }; value: { int64Value?: string; doubleValue?: number } }[];
};

type AuthLike = {
  getProjectId(): Promise<string>;
  request<T>(opts: { url: string; params?: Record<string, string> }): Promise<{ data: T }>;
};

async function auth(): Promise<AuthLike> {
  if (!g.__monitoringAuth) {
    const { GoogleAuth } = await import("google-auth-library");
    const { GCS_KEY_FILE: keyFile, GCS_KEY_JSON: keyJson } = env();
    const scopes = ["https://www.googleapis.com/auth/monitoring.read"];
    g.__monitoringAuth = keyJson
      ? new GoogleAuth({ credentials: JSON.parse(keyJson), scopes })
      : new GoogleAuth({ keyFilename: keyFile, scopes });
  }
  return g.__monitoringAuth as AuthLike;
}

const pointValue = (p: NonNullable<TimeSeries["points"]>[number]) =>
  Number(p.value.int64Value ?? p.value.doubleValue ?? 0);

async function timeSeries(
  client: AuthLike,
  project: string,
  metric: string,
  opts: { days: number; period: number; aligner: string; groupBy: string[] },
): Promise<TimeSeries[]> {
  const end = new Date();
  const start = new Date(end.getTime() - opts.days * DAY_S * 1000);
  const params: Record<string, string> = {
    filter: `metric.type="storage.googleapis.com/${metric}" AND resource.label.bucket_name="${env().GCS_BUCKET}"`,
    "interval.startTime": start.toISOString(),
    "interval.endTime": end.toISOString(),
    "aggregation.alignmentPeriod": `${opts.period}s`,
    "aggregation.perSeriesAligner": opts.aligner,
    "aggregation.crossSeriesReducer": "REDUCE_SUM",
  };
  const query = new URLSearchParams(params);
  for (const f of opts.groupBy) query.append("aggregation.groupByFields", f);
  const series: TimeSeries[] = [];
  let pageToken = "";
  do {
    const url = `https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${query}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const { data } = await client.request<{ timeSeries?: TimeSeries[]; nextPageToken?: string }>({ url });
    series.push(...(data.timeSeries ?? []));
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return series;
}

/** Serie giornaliera (somma di tutte le serie), un punto per giorno UTC. */
function daily(series: TimeSeries[]): DailyBytes[] {
  const byDay = new Map<string, number>();
  for (const s of series) {
    for (const p of s.points ?? []) {
      // Il punto copre il giorno che finisce in endTime.
      const day = new Date(new Date(p.interval.endTime).getTime() - 1000).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + pointValue(p));
    }
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, bytes]) => ({ date, bytes }));
}

/** Ultimo valore di ogni serie, raggruppato per classe. */
function latestByClass(series: TimeSeries[]): { values: Map<StorageClass, number>; at: Date | null } {
  const values = new Map<StorageClass, number>();
  let at: Date | null = null;
  for (const s of series) {
    const last = s.points?.[0]; // l'API restituisce i punti dal più recente
    if (!last) continue;
    const cls = normalizeClass(s.metric?.labels?.storage_class);
    values.set(cls, (values.get(cls) ?? 0) + pointValue(last));
    const t = new Date(last.interval.endTime);
    if (!at || t > at) at = t;
  }
  return { values, at };
}

async function load(): Promise<MetricsResult> {
  const e = env();
  if (e.STORAGE_DRIVER !== "gcs")
    return { ok: false, reason: "local", message: "L'archivio è una cartella locale: niente Google Cloud." };
  if (!e.GCS_BUCKET) return { ok: false, reason: "no-bucket", message: "GCS_BUCKET non impostato." };

  try {
    const client = await auth();
    const project = await client.getProjectId();
    const gauge = { days: 3, period: DAY_S, aligner: "ALIGN_MEAN", groupBy: ["metric.label.storage_class"] };
    const delta = { days: 30, period: DAY_S, aligner: "ALIGN_SUM", groupBy: [] };
    const [bytes, objects, sent, received, requests] = await Promise.all([
      timeSeries(client, project, "storage/v2/total_bytes", gauge),
      timeSeries(client, project, "storage/v2/total_count", gauge),
      timeSeries(client, project, "network/sent_bytes_count", delta),
      timeSeries(client, project, "network/received_bytes_count", delta),
      timeSeries(client, project, "api/request_count", {
        days: 30,
        period: 30 * DAY_S,
        aligner: "ALIGN_SUM",
        groupBy: ["metric.label.method"],
      }),
    ]);

    // Le metriche v2 esistono dal 2024; se il bucket non le ha ancora si usano le v1.
    const [bytesSeries, objectSeries] = bytes.length
      ? [bytes, objects]
      : await Promise.all([
          timeSeries(client, project, "storage/total_bytes", gauge),
          timeSeries(client, project, "storage/object_count", gauge),
        ]);
    const b = latestByClass(bytesSeries);
    const o = latestByClass(objectSeries);
    const classes = new Set<StorageClass>([...b.values.keys(), ...o.values.keys()]);
    let opsA = 0;
    let opsB = 0;
    for (const s of requests) {
      const n = (s.points ?? []).reduce((sum, p) => sum + pointValue(p), 0);
      const kind = operationClass(s.metric?.labels?.method ?? "");
      if (kind === "A") opsA += n;
      else if (kind === "B") opsB += n;
    }
    return {
      ok: true,
      metrics: {
        storage: [...classes].map((cls) => ({ cls, bytes: b.values.get(cls) ?? 0, objects: o.values.get(cls) ?? 0 })),
        egressDaily: daily(sent),
        ingressDaily: daily(received),
        opsA,
        opsB,
        measuredAt: b.at,
      },
    };
  } catch (err) {
    const e = err as { status?: number; response?: { status?: number } };
    const status = e.response?.status ?? e.status;
    if (status === 403)
      return {
        ok: false,
        reason: "permission",
        message:
          "L'account di servizio non può leggere le metriche: serve il ruolo Monitoring Viewer (e la Cloud Monitoring API attiva nel progetto).",
      };
    console.error("[statistiche] metriche di Cloud Monitoring non lette:", err);
    return { ok: false, reason: "error", message: "Metriche di Google Cloud non disponibili in questo momento." };
  }
}

/** Metriche del bucket, tenute in memoria 10 minuti (`fresh` le rilegge). */
export async function bucketMetrics(fresh = false): Promise<MetricsResult> {
  const cached = g.__gcsMetrics;
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.result;
  const result = await load();
  g.__gcsMetrics = { at: Date.now(), result };
  return result;
}
