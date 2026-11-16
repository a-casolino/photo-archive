"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { GRID_BATCH, restoreCount, type GridSpot } from "@/lib/grid-rules";

/*
 * Elenco che si allunga mentre si scorre: il server disegna il primo blocco,
 * gli altri si chiedono a `endpoint` (?<query>&da=<n>&n=<quanti>) quando la
 * fine dell'elenco (`sentinel`) arriva a circa due schermate.
 *
 * Aprendo un elemento (click su un link dentro `remember`) si salva nel
 * browser quanti erano caricati e a che punto della pagina si era: tornando
 * indietro si ricaricano e si torna lì, invece di ripartire dall'inizio.
 */
export function useGrowing<T extends { key: string }>({
  initial,
  endpoint,
  query,
  total,
  initialMore,
  batch = GRID_BATCH,
}: {
  initial: T[];
  endpoint: string;
  /** Parametri della richiesta, senza da/n. */
  query: string;
  /** Quanti in tutto, se si sa; altrimenti `initialMore` e il `more` delle risposte. */
  total?: number;
  initialMore?: boolean;
  batch?: number;
}) {
  const storeKey = `elenco:${endpoint}?${query}`;
  const [items, setItems] = useState(initial);
  const [more, setMore] = useState(total !== undefined ? initial.length < total : !!initialMore);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Per riosservare il fondo dell'elenco quando una ripresa non serviva. */
  const [retick, setRetick] = useState(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const restoreY = useRef<number | null>(null);
  const busy = useRef(false);
  /** Ripresa della posizione in arrivo: intanto niente blocchi normali. */
  const restoring = useRef(false);

  // Dati nuovi dal server (filtro cambiato, elementi tolti): si riparte da lì.
  const [shown, setShown] = useState(initial);
  if (shown !== initial) {
    setShown(initial);
    setItems(initial);
    setMore(total !== undefined ? initial.length < total : !!initialMore);
  }

  const load = useCallback(
    async (from: number, n: number): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      setLoading(true);
      setFailed(false);
      try {
        const sep = query ? "&" : "";
        const res = await fetch(`${endpoint}?${query}${sep}da=${from}&n=${n}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { items?: T[]; entries?: T[]; more?: boolean };
        const got = body.items ?? body.entries ?? [];
        setItems((cur) => {
          // Solo se nel frattempo non è cambiato niente.
          if (cur.length !== from) return cur;
          const seen = new Set(cur.map((i) => i.key));
          const next = [...cur, ...got.filter((i) => !seen.has(i.key))];
          setMore(total !== undefined ? next.length < total && got.length > 0 : !!body.more);
          return next;
        });
        return true;
      } catch (e) {
        console.error("[elenco]", e);
        setFailed(true);
        return false;
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [endpoint, query, total],
  );

  // Tornando da un elemento aperto: ricarica fin dove si era e torna a quel punto.
  useEffect(() => {
    let spot: GridSpot | null = null;
    try {
      const raw = sessionStorage.getItem(storeKey);
      if (raw) spot = JSON.parse(raw) as GridSpot;
    } catch {
      // sessionStorage non disponibile: si parte dall'inizio.
    }
    if (!spot) return;
    const y = spot.y;
    const want = restoreCount(spot, initial.length, total ?? Number.MAX_SAFE_INTEGER, Date.now());
    restoring.current = true;
    const timer = setTimeout(() => {
      try {
        sessionStorage.removeItem(storeKey);
      } catch {
        // come sopra
      }
      restoring.current = false;
      if (want <= 0 || (total === undefined && !initialMore)) {
        setRetick((n) => n + 1);
        return;
      }
      // Prima di caricare: lo scroll si fa appena arrivano gli elementi.
      restoreY.current = y;
      void load(initial.length, want).then((ok) => {
        if (!ok) restoreY.current = null;
      });
    }, 0);
    return () => {
      clearTimeout(timer);
      restoring.current = false;
    };
    // Solo all'apertura della pagina.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (restoreY.current === null) return;
    const y = restoreY.current;
    restoreY.current = null;
    window.scrollTo(0, y);
  }, [items]);

  // Il blocco successivo parte quando la fine dell'elenco è a circa due schermate.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || failed) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !restoring.current) void load(items.length, batch);
      },
      { rootMargin: "0px 0px 1500px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [items.length, more, failed, load, batch, retick]);

  const remember = useCallback(
    (e: React.MouseEvent) => {
      if (!(e.target as HTMLElement).closest("a[href]")) return;
      try {
        const spot: GridSpot = { count: items.length, y: window.scrollY, at: Date.now() };
        sessionStorage.setItem(storeKey, JSON.stringify(spot));
      } catch {
        // Non importa: tornando si ripartirà dall'inizio.
      }
    },
    [items.length, storeKey],
  );

  return {
    items,
    more,
    loading,
    failed,
    sentinel,
    remember,
    retry: () => void load(items.length, batch),
  };
}
