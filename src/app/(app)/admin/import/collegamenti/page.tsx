import Link from "next/link";
import { confirmAllAuto, decideMatch, rerunMatching } from "@/app/actions/imports";
import { query, queryOne } from "@/lib/db";
import { formatCount, formatTakenAt } from "@/lib/format";
import { CANDIDATE_JOIN, possibleNameMatches } from "@/lib/imports";
import { exportGapLabel } from "@/lib/match-rules";
import { requireOwner } from "@/lib/session";
import { storage } from "@/lib/storage";

/*
 * Revisione dei collegamenti tra gli export di Google Foto e i CR2:
 *  - collegati in automatico (un solo candidato): confermi o scarti;
 *  - più candidati (raffiche nello stesso secondo): scegli tu;
 *  - stesso nome ma data lontana (export senza EXIF della fotocamera): scegli tu.
 */

type PhotoSide = {
  pid: string;
  name: string;
  path: string | null;
  thumb: string | null;
  taken_at: Date | null;
  subsec: number | null;
  camera: string | null;
};

type Pair = { e: PhotoSide; r: PhotoSide; method: string | null };

const PAGE = 30;

function side(prefix: "e" | "r" | "p", row: Record<string, unknown>): PhotoSide {
  return {
    pid: row[`${prefix}_pid`] as string,
    name: row[`${prefix}_name`] as string,
    path: row[`${prefix}_path`] as string | null,
    thumb: row[`${prefix}_thumb`] as string | null,
    taken_at: row[`${prefix}_taken`] as Date | null,
    subsec: row[`${prefix}_subsec`] as number | null,
    camera: row.camera as string | null,
  };
}

const COLUMNS = `
  e.public_id AS e_pid, e.original_filename AS e_name, e.source_path AS e_path, e.gcs_thumb_key AS e_thumb,
  e.taken_at AS e_taken, e.taken_at_subsec AS e_subsec,
  r.public_id AS r_pid, r.original_filename AS r_name, r.source_path AS r_path, r.gcs_thumb_key AS r_thumb,
  r.taken_at AS r_taken, r.taken_at_subsec AS r_subsec,
  IF(ce.model LIKE CONCAT(ce.make, '%'), ce.model, CONCAT(ce.make, ' ', ce.model)) AS camera`;

/** Le stesse colonne di un lato, per una foto qualunque. */
const PHOTO_COLUMNS = (a: string) => `
  ${a}.id, ${a}.public_id AS ${a}_pid, ${a}.original_filename AS ${a}_name, ${a}.source_path AS ${a}_path,
  ${a}.gcs_thumb_key AS ${a}_thumb, ${a}.taken_at AS ${a}_taken, ${a}.taken_at_subsec AS ${a}_subsec, NULL AS camera`;

async function thumbUrls(sides: PhotoSide[]) {
  const s = storage();
  const urls = new Map<string, string>();
  await Promise.all(
    sides.map(async (p) => {
      if (p.thumb && !urls.has(p.thumb)) urls.set(p.thumb, await s.readUrl(p.thumb));
    }),
  );
  return urls;
}

function Photo({ p, urls, label }: { p: PhotoSide; urls: Map<string, string>; label: string }) {
  const url = p.thumb ? urls.get(p.thumb) : undefined;
  return (
    <div className="match-photo">
      <span className="muted">{label}</span>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL firmati temporanei, niente ottimizzazione
        <img src={url} alt={p.name} loading="lazy" />
      ) : (
        <div className="no-thumb">senza anteprima</div>
      )}
      <strong>{p.name}</strong>
      <span className="muted">{formatTakenAt(p.taken_at, p.subsec)}</span>
      {p.path && <span className="current-file">{p.path}</span>}
    </div>
  );
}

export default async function MatchReviewPage() {
  await requireOwner();

  const autoRows = await query<Record<string, unknown>>(
    `SELECT ${COLUMNS}, e.match_method
       FROM photos e
       JOIN photos r ON r.id = e.derived_from_id
       LEFT JOIN cameras ce ON ce.id = e.camera_id
      WHERE e.kind = 'edit' AND e.match_status = 'auto' AND e.deleted_at IS NULL
      ORDER BY e.taken_at, e.id
      LIMIT ${PAGE}`,
  );
  const autoPairs: Pair[] = autoRows.map((row) => ({
    e: side("e", row),
    r: side("r", row),
    method: (row.match_method as string | null) ?? null,
  }));

  const ambiguousIds = await query<{ id: number }>(
    `SELECT e.id FROM photos e ${CANDIDATE_JOIN}
      WHERE e.kind = 'edit' AND e.match_status = 'none' AND e.deleted_at IS NULL
      GROUP BY e.id HAVING COUNT(*) > 1
      ORDER BY MIN(e.taken_at), e.id
      LIMIT ${PAGE}`,
  );
  const candidateRows = ambiguousIds.length
    ? await query<Record<string, unknown>>(
        `SELECT ${COLUMNS} FROM photos e ${CANDIDATE_JOIN}
          WHERE e.id IN (?)
          ORDER BY e.taken_at, e.id, r.taken_at_subsec, r.original_filename`,
        [ambiguousIds.map((x) => x.id)],
      )
    : [];
  const groups = new Map<string, { e: PhotoSide; candidates: PhotoSide[] }>();
  for (const row of candidateRows) {
    const e = side("e", row);
    const g = groups.get(e.pid) ?? { e, candidates: [] };
    g.candidates.push(side("r", row));
    groups.set(e.pid, g);
  }

  // Stesso nome, data lontana: confronto in memoria (vedi match-rules.ts).
  const possible = (await possibleNameMatches()).slice(0, PAGE);
  const possibleRows = possible.length
    ? await query<Record<string, unknown>>(
        `SELECT ${PHOTO_COLUMNS("p")} FROM photos p WHERE p.id IN (?)`,
        [possible.flatMap((m) => [m.exportId, ...m.rawIds])],
      )
    : [];
  const byId = new Map(possibleRows.map((row) => [Number(row.id), side("p", row)]));
  const nameGroups = possible
    .map((m) => ({ e: byId.get(m.exportId), candidates: m.rawIds.map((id) => byId.get(id)) }))
    .filter((g): g is { e: PhotoSide; candidates: PhotoSide[] } => !!g.e && g.candidates.every(Boolean));

  const counts = await queryOne<{ auto: number; confirmed: number; orphan: number; rejected: number }>(
    `SELECT SUM(match_status = 'auto') AS auto, SUM(match_status = 'confirmed') AS confirmed,
            SUM(match_status = 'none') AS orphan, SUM(match_status = 'rejected') AS rejected
       FROM photos WHERE kind = 'edit' AND deleted_at IS NULL`,
  );
  const orphan = Number(counts?.orphan ?? 0) - groups.size;

  const urls = await thumbUrls([
    ...autoPairs.flatMap((p) => [p.e, p.r]),
    ...[...groups.values()].flatMap((g) => [g.e, ...g.candidates]),
    ...nameGroups.flatMap((g) => [g.e, ...g.candidates]),
  ]);

  return (
    <>
      <p>
        <Link prefetch={false} href="/admin/import">← Import</Link>
      </p>
      <h1>Collegamenti export → CR2</h1>
      <p className="muted">
        Ogni foto modificata e caricata su Google Foto viene collegata al CR2 da cui nasce, confrontando l&apos;ora
        di scatto e la fotocamera (numero di serie). Confermati: {formatCount(Number(counts?.confirmed ?? 0))} ·
        senza originale trovato: {formatCount(Math.max(0, orphan))} · scartati:{" "}
        {formatCount(Number(counts?.rejected ?? 0))}.
      </p>
      <form action={rerunMatching} className="actions">
        <button type="submit" className="secondary">
          Ricalcola i collegamenti
        </button>
        <span className="muted">Utile dopo aver importato altri CR2.</span>
      </form>

      <section className="card">
        <div className="import-head">
          <h2>Da confermare ({formatCount(Number(counts?.auto ?? 0))})</h2>
          {autoPairs.length > 0 && (
            <form action={confirmAllAuto}>
              <button type="submit">Conferma tutti</button>
            </form>
          )}
        </div>
        {autoPairs.length === 0 ? (
          <p className="muted">Niente da confermare.</p>
        ) : (
          <div className="match-list">
            {autoPairs.map(({ e, r, method }) => (
              <div key={e.pid} className="match-row">
                <Photo p={e} urls={urls} label="Export" />
                <span className="match-arrow" aria-hidden>
                  →
                </span>
                <Photo
                  p={r}
                  urls={urls}
                  label={
                    method === "name+date"
                      ? `CR2 · stesso nome, ${exportGapLabel(e.taken_at, r.taken_at) ?? "data diversa"}`
                      : method === "pixel"
                        ? "CR2 · stessa immagine (confronto dei pixel)"
                        : `CR2${e.camera ? ` · ${e.camera}` : ""}`
                  }
                />
                <div className="actions" style={{ alignSelf: "center" }}>
                  <form action={decideMatch}>
                    <input type="hidden" name="decision" value="confirm" />
                    <input type="hidden" name="edit" value={e.pid} />
                    <button type="submit">Conferma</button>
                  </form>
                  <form action={decideMatch}>
                    <input type="hidden" name="decision" value="reject" />
                    <input type="hidden" name="edit" value={e.pid} />
                    <button type="submit" className="secondary">
                      Non è questo
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Da scegliere: più CR2 nello stesso istante</h2>
        {groups.size === 0 ? (
          <p className="muted">Nessuna raffica da risolvere.</p>
        ) : (
          <div className="match-list">
            {[...groups.values()].map(({ e, candidates }) => (
              <div key={e.pid} className="match-row">
                <Photo p={e} urls={urls} label="Export" />
                <span className="match-arrow" aria-hidden>
                  →
                </span>
                {candidates.map((r) => (
                  <div key={r.pid} className="match-photo">
                    <Photo p={r} urls={urls} label="CR2" />
                    <form action={decideMatch}>
                      <input type="hidden" name="decision" value="choose" />
                      <input type="hidden" name="edit" value={e.pid} />
                      <input type="hidden" name="raw" value={r.pid} />
                      <button type="submit">È questo</button>
                    </form>
                  </div>
                ))}
                <form action={decideMatch} style={{ alignSelf: "center" }}>
                  <input type="hidden" name="decision" value="reject" />
                  <input type="hidden" name="edit" value={e.pid} />
                  <button type="submit" className="secondary">
                    Nessuno di questi
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Da scegliere: stesso nome, data lontana</h2>
        <p className="muted">
          Export senza i dati della fotocamera: la data è quella dell&apos;export o del caricamento su Google Foto, non
          dello scatto. Quelli entro 2 giorni dopo il CR2 sono già tra i collegamenti da confermare.
        </p>
        {nameGroups.length === 0 ? (
          <p className="muted">Niente da scegliere.</p>
        ) : (
          <div className="match-list">
            {nameGroups.map(({ e, candidates }) => (
              <div key={e.pid} className="match-row">
                <Photo p={e} urls={urls} label="Export" />
                <span className="match-arrow" aria-hidden>
                  →
                </span>
                {candidates.map((r) => (
                  <div key={r.pid} className="match-photo">
                    <Photo p={r} urls={urls} label={`CR2 · ${exportGapLabel(e.taken_at, r.taken_at) ?? "data diversa"}`} />
                    <form action={decideMatch}>
                      <input type="hidden" name="decision" value="choose" />
                      <input type="hidden" name="edit" value={e.pid} />
                      <input type="hidden" name="raw" value={r.pid} />
                      <button type="submit">È questo</button>
                    </form>
                  </div>
                ))}
                <form action={decideMatch} style={{ alignSelf: "center" }}>
                  <input type="hidden" name="decision" value="reject" />
                  <input type="hidden" name="edit" value={e.pid} />
                  <button type="submit" className="secondary">
                    Nessuno di questi
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
