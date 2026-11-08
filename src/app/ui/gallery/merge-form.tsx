"use client";

import { startTransition, useActionState, useMemo, useState, type FormEvent } from "react";
import { mergeAlbumsAction } from "@/app/actions/albums";
import { MERGE_MAX_ALBUMS } from "@/lib/gallery-rules";

export type MergeAlbum = {
  publicId: string;
  title: string;
  detail: string;
  thumb: string | null;
  /** Condivisioni attive: protette e link liberi. */
  users: number;
  links: number;
};

function sharesLabel(users: number, links: number): string {
  const parts = [];
  if (users) parts.push(`${users} condivision${users === 1 ? "e" : "i"} a persone`);
  if (links) parts.push(`${links} link liber${links === 1 ? "o" : "i"}`);
  return parts.join(" e ");
}

/** Scelta degli album da unire e di quello da tenere (solo proprietario). */
export function MergeForm({ albums, preset }: { albums: MergeAlbum[]; preset: string | null }) {
  const [state, action, pending] = useActionState(mergeAlbumsAction, undefined);
  const [selected, setSelected] = useState<string[]>(preset ? [preset] : []);
  const [into, setInto] = useState<string | null>(preset);
  const [filter, setFilter] = useState("");
  const [shares, setShares] = useState<"move" | "revoke" | null>(null);

  const byId = useMemo(() => new Map(albums.map((a) => [a.publicId, a])), [albums]);
  const target = into ? byId.get(into) : undefined;
  const sources = selected.filter((id) => id !== into).map((id) => byId.get(id)!);
  const srcUsers = sources.reduce((n, a) => n + a.users, 0);
  const srcLinks = sources.reduce((n, a) => n + a.links, 0);
  const needsChoice = srcUsers + srcLinks > 0;
  const q = filter.trim().toLowerCase();

  function toggle(id: string, on: boolean) {
    const next = on ? [...selected, id] : selected.filter((x) => x !== id);
    setSelected(next);
    if (on && !into) setInto(id);
    if (!on && into === id) setInto(next[0] ?? null);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  }

  const ready = selected.length >= 2 && !!into && (!needsChoice || !!shares) && selected.length <= MERGE_MAX_ALBUMS;

  return (
    <form action={action} onSubmit={onSubmit} className="form merge-form">
      <input
        type="search"
        placeholder="Filtra per titolo"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filtra gli album"
      />
      <ul className="merge-list">
        {albums.map((a) => {
          const checked = selected.includes(a.publicId);
          // Gli album nascosti dal filtro restano nel form, se scelti.
          const hidden = !!q && !checked && !a.title.toLowerCase().includes(q);
          return (
            <li key={a.publicId} hidden={hidden} className={checked ? "chosen" : undefined}>
              <label className="merge-pick">
                <input
                  type="checkbox"
                  name="albums"
                  value={a.publicId}
                  checked={checked}
                  onChange={(e) => toggle(a.publicId, e.target.checked)}
                />
                {a.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.thumb} alt="" loading="lazy" />
                ) : (
                  <span className="merge-thumb" />
                )}
                <span>
                  <strong>{a.title}</strong>
                  <span className="muted">
                    {[a.detail, sharesLabel(a.users, a.links)].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </label>
              {checked && (
                <label className="merge-keep">
                  <input
                    type="radio"
                    name="into"
                    value={a.publicId}
                    checked={into === a.publicId}
                    onChange={() => setInto(a.publicId)}
                  />
                  Tieni questo
                </label>
              )}
            </li>
          );
        })}
      </ul>

      {selected.length >= 2 && target && (
        <div className="card merge-summary">
          <p>
            Le foto di {sources.length === 1 ? "«" + sources[0].title + "»" : `${sources.length} album`} confluiscono in{" "}
            <strong>«{target.title}»</strong>, senza doppioni, insieme ai loro tag.{" "}
            {sources.length === 1 ? "L'album unito va" : "Gli album uniti vanno"} nel cestino; i vecchi indirizzi e i
            nuovi import della stessa cartella portano all&apos;album tenuto.
          </p>
          <label>
            Titolo dell&apos;album unito
            <input name="title" placeholder={target.title} maxLength={255} />
          </label>
          {target.users + target.links > 0 && (
            <p className="msg">
              «{target.title}» ha {sharesLabel(target.users, target.links)}: chi le ha vedrà anche le foto in arrivo.
            </p>
          )}
          {needsChoice && (
            <fieldset className="choice">
              <legend>
                Gli album da unire hanno {sharesLabel(srcUsers, srcLinks)}. Cosa ne faccio?
              </legend>
              <label>
                <input
                  type="radio"
                  name="shares"
                  value="move"
                  checked={shares === "move"}
                  onChange={() => setShares("move")}
                />
                <span>
                  Spostale sull&apos;album unito: gli stessi link e le stesse persone continuano a funzionare, ma vedono
                  <strong> tutte</strong> le foto unite.
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="shares"
                  value="revoke"
                  checked={shares === "revoke"}
                  onChange={() => setShares("revoke")}
                />
                <span>Revocale: nessuno vede più quelle foto finché non condividi di nuovo l&apos;album unito.</span>
              </label>
            </fieldset>
          )}
        </div>
      )}

      {state?.error && (
        <p className="msg msg-error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={!ready || pending}>
        {pending
          ? "Unione in corso…"
          : selected.length >= 2
            ? `Unisci ${selected.length} album`
            : "Scegli almeno due album"}
      </button>
    </form>
  );
}
