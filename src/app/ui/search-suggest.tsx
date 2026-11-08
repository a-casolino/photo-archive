"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  highlightParts,
  parseSearchQuery,
  SEARCH_MAX_LENGTH,
  SUGGEST_GROUP_LABEL,
  type SuggestItem,
  type SuggestResponse,
} from "@/lib/search-rules";

/** Attesa dopo l'ultimo tasto prima di chiedere i suggerimenti. */
const DEBOUNCE_MS = 150;

function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : p.text))}
    </>
  );
}

/**
 * Campo di ricerca con suggerimenti mentre si scrive (album, tag,
 * persone; solo proprietario). Frecce per scegliere, Invio per aprire il
 * suggerimento scelto; senza scelta Invio invia il form come prima.
 */
export function SearchSuggest({
  name,
  defaultValue,
  placeholder,
  label,
}: {
  name: string;
  defaultValue: string;
  placeholder: string;
  label: string;
}) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<SuggestItem[]>([]);
  const [shownFor, setShownFor] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapper = useRef<HTMLDivElement>(null);

  const q = parseSearchQuery(value);

  useEffect(() => {
    if (!q) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggerimenti?${new URLSearchParams({ q })}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as SuggestResponse;
        setItems(data.items);
        setShownFor(q);
        setActive(-1);
      } catch {
        // Richiesta annullata (nuovo tasto) o rete assente: niente suggerimenti.
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  // I suggerimenti valgono solo per il testo per cui sono arrivati.
  const visible = open && !!q && shownFor === q;
  const list = visible ? items : [];

  function choose(item: SuggestItem) {
    setOpen(false);
    router.push(item.href);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!list.length) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      // Si gira tra i suggerimenti e il campo (-1, nessuna scelta).
      const n = list.length + 1;
      setActive((i) => ((((i + 1 + step) % n) + n) % n) - 1);
    } else if (e.key === "Enter" && active >= 0 && list[active]) {
      e.preventDefault();
      choose(list[active]);
    } else if (e.key === "Escape" && visible) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  const optionId = (i: number) => `${id}-opt-${i}`;
  const groups = (Object.keys(SUGGEST_GROUP_LABEL) as SuggestItem["kind"][])
    .map((kind) => ({ kind, entries: list.map((item, i) => ({ item, i })).filter((x) => x.item.kind === kind) }))
    .filter((g) => g.entries.length);

  return (
    <div
      className="search-suggest"
      ref={wrapper}
      onBlur={(e) => {
        if (!wrapper.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        name={name}
        type="search"
        placeholder={placeholder}
        aria-label={label}
        value={value}
        maxLength={SEARCH_MAX_LENGTH}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible && list.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={visible && active >= 0 ? optionId(active) : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <div id={`${id}-list`} role="listbox" aria-label="Suggerimenti" className="search-suggest-list" hidden={!visible}>
        {visible && list.length === 0 && <p className="muted">Nessun album, tag o persona con «{q}».</p>}
        {groups.map((g) => (
          <div key={g.kind} role="group" aria-labelledby={`${id}-g-${g.kind}`}>
            <div id={`${id}-g-${g.kind}`} className="search-suggest-group">
              {SUGGEST_GROUP_LABEL[g.kind]}
            </div>
            {g.entries.map(({ item, i }) => (
              <Link
                key={item.href}
                id={optionId(i)}
                href={item.href}
                prefetch={false}
                role="option"
                aria-selected={i === active}
                className={`search-suggest-item ${item.kind}${i === active ? " active" : ""}`}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => setOpen(false)}
              >
                {item.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumb} alt="" width={36} height={36} loading="lazy" />
                ) : (
                  <span className="search-suggest-icon" aria-hidden="true">
                    {item.kind === "tag" ? "#" : item.kind === "person" ? item.title.charAt(0) : ""}
                  </span>
                )}
                <span>
                  <span className="search-suggest-title">
                    <Highlight text={item.title} query={q} />
                  </span>
                  {item.detail && <span className="search-suggest-detail muted">{item.detail}</span>}
                </span>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
