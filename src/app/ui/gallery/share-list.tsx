import Link from "next/link";
import {
  addShareRecipients,
  removeShareRecipient,
  renewLink,
  revokeShare,
} from "@/app/actions/shares";
import { query } from "@/lib/db";
import { dateTimeFmt } from "@/lib/format";
import { SHARE_STATE_LABEL, shareState } from "@/lib/gallery-rules";
import type { ShareListItem } from "@/lib/shares";
import { Button } from "@/components/ui/button";
import { CopyField } from "./copy-field";
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

  const recipients = await query<{
    share_id: number;
    user_id: number;
    name: string;
    first_viewed_at: Date | null;
  }>(
    `SELECT sr.share_id, sr.user_id, u.name, sr.first_viewed_at
       FROM share_recipients sr JOIN users u ON u.id = sr.user_id
      WHERE sr.share_id IN (?) ORDER BY u.name`,
    [shares.map((s) => s.id)],
  );

  return (
    <ul className="share-list">
      {shares.map((s) => {
        const state = shareState(s);
        const people = recipients.filter((r) => r.share_id === s.id);
        const included = new Set(people.map((p) => p.user_id));
        const addable = allPeople.filter((u) => !included.has(u.id));
        const targetHref = s.target_public_id
          ? `/${s.target_type === "album" ? "album" : "foto"}/${s.target_public_id}`
          : null;
        return (
          <li
            key={s.id}
            className={
              state === "active" ? "share-item" : "share-item inactive"
            }
          >
            {showTarget && (
              <div className="share-target">
                {targetHref ? (
                  <Link href={targetHref}>{s.target_title}</Link>
                ) : (
                  s.target_title
                )}
                <span className="muted">
                  {" "}
                  · {s.target_type === "album" ? "album" : "foto"}
                </span>
              </div>
            )}
            <div className="share-head">
              <strong>
                {s.mode === "link" ? (
                  "Link libero"
                ) : (
                  <Link href={`/condivisi/${s.public_id}`}>Persone</Link>
                )}
              </strong>
              <span className={`share-state share-state-${state}`}>
                {SHARE_STATE_LABEL[state]}
              </span>
            </div>
            <p className="share-meta muted">
              {DOWNLOAD_LABEL[s.allow_download]}
              {s.expires_at && state !== "revoked" && (
                <>
                  {" · "}
                  {state === "expired" ? "scaduto il" : "fino al"}{" "}
                  {dateTimeFmt.format(s.expires_at)}
                </>
              )}
              {" · "}
              {s.view_count === 1 ? "1 visita" : `${s.view_count} visite`}
              {s.last_viewed_at && (
                <> (ultima {dateTimeFmt.format(s.last_viewed_at)})</>
              )}
            </p>

            {s.mode === "link" &&
              state === "active" &&
              (s.link ? (
                <CopyField value={s.link} />
              ) : (
                <p className="share-msg muted">
                  Link creato prima che si potesse rivedere: usa &quot;Nuovo
                  link&quot; per averlo qui.
                </p>
              ))}

            {s.mode === "users" && (
              <ul className="people-list">
                {people.map((p) => (
                  <li key={p.user_id}>
                    <span>
                      {p.name}
                      {!p.first_viewed_at && (
                        <span className="muted"> (non ancora visto)</span>
                      )}
                    </span>
                    {state !== "revoked" && (
                      <form action={removeShareRecipient} className="inline">
                        <input
                          type="hidden"
                          name="shareId"
                          value={s.public_id}
                        />
                        <input type="hidden" name="userId" value={p.user_id} />
                        {back && (
                          <input type="hidden" name="back" value={back} />
                        )}
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          title={`Togli ${p.name}`}
                        >
                          Togli
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {s.message && <p className="muted share-msg">“{s.message}”</p>}

            {state !== "revoked" && (
              <div className="share-actions">
                {s.mode === "users" && addable.length > 0 && (
                  <form action={addShareRecipients} className="inline">
                    <input type="hidden" name="shareId" value={s.public_id} />
                    {back && <input type="hidden" name="back" value={back} />}
                    <select
                      name="recipients"
                      defaultValue=""
                      required
                      aria-label="Aggiungi una persona"
                    >
                      <option value="" disabled>
                        Aggiungi…
                      </option>
                      {addable.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" variant="outline" size="sm">
                      Aggiungi
                    </Button>
                  </form>
                )}
                {s.mode === "link" && (
                  <>
                    <form action={renewLink} className="inline">
                      <input type="hidden" name="shareId" value={s.public_id} />
                      <input type="hidden" name="days" value={defaultDays} />
                      {back && <input type="hidden" name="back" value={back} />}
                      <Button type="submit" variant="outline" size="sm">
                        Rinnova {defaultDays} giorni
                      </Button>
                    </form>
                    <RegenerateLinkForm shareId={s.public_id} back={back} />
                  </>
                )}
                <form action={revokeShare} className="inline share-revoke">
                  <input type="hidden" name="shareId" value={s.public_id} />
                  {back && <input type="hidden" name="back" value={back} />}
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  >
                    Revoca
                  </Button>
                </form>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
