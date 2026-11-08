import Link from "next/link";
import { addShareRecipients, removeShareRecipient, renewLink, revokeShare } from "@/app/actions/shares";
import { query } from "@/lib/db";
import { dateTimeFmt } from "@/lib/format";
import { SHARE_STATE_LABEL, shareState } from "@/lib/gallery-rules";
import type { ShareListItem } from "@/lib/shares";
import { RegenerateLinkForm } from "./share-form";

export const DOWNLOAD_LABEL = {
  none: "Solo visione",
  preview: "JPEG grande",
  original: "Originale (Fidati)",
} as const;

/** Elenco delle condivisioni con le azioni del proprietario. */
export async function ShareList({
  shares,
  back,
  showTarget = false,
  defaultDays,
  people: allPeople = [],
}: {
  /** Utenti che si possono aggiungere alle condivisioni protette. */
  people?: { id: number; name: string }[];
  shares: ShareListItem[];
  back?: string;
  showTarget?: boolean;
  defaultDays: number;
}) {
  if (!shares.length) return <p className="muted">Nessuna condivisione.</p>;

  const recipients = await query<{ share_id: number; user_id: number; name: string; first_viewed_at: Date | null }>(
    `SELECT sr.share_id, sr.user_id, u.name, sr.first_viewed_at
       FROM share_recipients sr JOIN users u ON u.id = sr.user_id
      WHERE sr.share_id IN (?) ORDER BY u.name`,
    [shares.map((s) => s.id)],
  );

  return (
    <div className="table-wrap">
      <table className="shares">
        <thead>
          <tr>
            {showTarget && <th>Cosa</th>}
            <th>Tipo</th>
            <th>Download</th>
            <th>Stato</th>
            <th>Viste</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {shares.map((s) => {
            const state = shareState(s);
            const people = recipients.filter((r) => r.share_id === s.id);
            const included = new Set(people.map((p) => p.user_id));
            const addable = allPeople.filter((u) => !included.has(u.id));
            const targetHref = s.target_public_id
              ? `/${s.target_type === "album" ? "album" : "foto"}/${s.target_public_id}`
              : null;
            return (
              <tr key={s.id} className={state === "active" ? undefined : "inactive"}>
                {showTarget && (
                  <td>
                    {targetHref ? <Link href={targetHref}>{s.target_title}</Link> : s.target_title}
                    <span className="muted"> · {s.target_type === "album" ? "album" : "foto"}</span>
                  </td>
                )}
                <td>
                  {s.mode === "link" ? (
                    "Link libero"
                  ) : (
                    <>
                      <Link href={`/condivisi/${s.public_id}`}>Persone</Link>
                      <ul className="people-list">
                        {people.map((p) => (
                          <li key={p.user_id}>
                            {p.name}
                            {!p.first_viewed_at && <span className="muted"> (non ancora visto)</span>}
                            {state !== "revoked" && (
                              <form action={removeShareRecipient} className="inline">
                                <input type="hidden" name="shareId" value={s.public_id} />
                                <input type="hidden" name="userId" value={p.user_id} />
                                {back && <input type="hidden" name="back" value={back} />}
                                <button type="submit" className="link" title={`Togli ${p.name}`}>
                                  togli
                                </button>
                              </form>
                            )}
                          </li>
                        ))}
                      </ul>
                      {state !== "revoked" && addable.length > 0 && (
                        <form action={addShareRecipients} className="inline">
                          <input type="hidden" name="shareId" value={s.public_id} />
                          {back && <input type="hidden" name="back" value={back} />}
                          <select name="recipients" defaultValue="" required aria-label="Aggiungi una persona">
                            <option value="" disabled>
                              Aggiungi…
                            </option>
                            {addable.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="small">
                            Aggiungi
                          </button>
                        </form>
                      )}
                    </>
                  )}
                  {s.message && <div className="muted share-msg">“{s.message}”</div>}
                </td>
                <td>{DOWNLOAD_LABEL[s.allow_download]}</td>
                <td>
                  {SHARE_STATE_LABEL[state]}
                  {s.expires_at && state !== "revoked" && (
                    <div className="muted">
                      {state === "expired" ? "dal" : "fino al"} {dateTimeFmt.format(s.expires_at)}
                    </div>
                  )}
                </td>
                <td>
                  {s.view_count}
                  {s.last_viewed_at && <div className="muted">{dateTimeFmt.format(s.last_viewed_at)}</div>}
                </td>
                <td>
                  {state !== "revoked" && (
                    <div className="share-actions">
                      {s.mode === "link" && (
                        <>
                          <form action={renewLink} className="inline">
                            <input type="hidden" name="shareId" value={s.public_id} />
                            <input type="hidden" name="days" value={defaultDays} />
                            {back && <input type="hidden" name="back" value={back} />}
                            <button type="submit" className="link">
                              Rinnova {defaultDays} giorni
                            </button>
                          </form>
                          <RegenerateLinkForm shareId={s.public_id} back={back} />
                        </>
                      )}
                      <form action={revokeShare} className="inline">
                        <input type="hidden" name="shareId" value={s.public_id} />
                        {back && <input type="hidden" name="back" value={back} />}
                        <button type="submit" className="link danger">
                          Revoca
                        </button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
