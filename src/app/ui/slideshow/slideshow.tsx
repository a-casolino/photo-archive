"use client";

import {
  CastIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PlayIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  batchesFor,
  batchFresh,
  parseInterval,
  parseTransition,
  SLIDE_INTERVALS,
  SLIDE_TRANSITIONS,
  type SlideTransition,
  stepIndex,
  type Slide,
  type SlideshowResponse,
} from "@/lib/slideshow-rules";
import { castPhoto, endCast, useCast } from "./cast";
import "./slideshow.css";

/*
 * Presentazione di un album a schermo intero: le foto scorrono da sole
 * (intervallo a scelta, ricordato dal browser), con pausa, frecce, swipe e
 * tastiera. Le foto arrivano a blocchi da /api/presentazione, che controlla
 * gli stessi permessi delle pagine (proprietario, condivisione, link libero).
 *
 * Su Chrome ed Edge, se in casa c'è un Chromecast, compare il pulsante per
 * mandarla alla TV (vedi cast.ts): la TV mostra la foto, questa pagina fa da
 * telecomando.
 */

/** Dove prendere le foto: album del proprietario, condivisione protetta o link libero. */
export type SlideshowSource = { album?: string; s?: string; t?: string };

const INTERVAL_KEY = "presentazione-intervallo";
const TRANSITION_KEY = "presentazione-transizione";
const HIDE_CONTROLS_MS = 3000;

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Navigazione privata: la scelta vale solo per questa volta.
  }
}

function fullscreenOn(): boolean {
  return typeof document !== "undefined" && !!document.fullscreenElement;
}

function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

export function SlideshowButton({
  source,
  title,
  hasSubalbums,
  onlyEdited,
  castAppId = null,
  variant = "outline",
}: {
  source: SlideshowSource;
  title: string;
  hasSubalbums: boolean;
  onlyEdited: boolean;
  /** App ID del ricevitore Chromecast nostro (CAST_APP_ID), o null per quello di Google. */
  castAppId?: string | null;
  variant?: "outline" | "default" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [branch, setBranch] = useState(hasSubalbums);
  // Fuori dal lettore: cambiando "sotto-album" il lettore riparte, il pannello resta aperto.
  const [settings, setSettings] = useState(false);

  function start() {
    setOpen(true);
    // Schermo intero subito, dentro il click (i browser lo chiedono). Su
    // iPhone non c'è: la presentazione occupa comunque tutta la pagina.
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function close() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    endCast();
    setOpen(false);
    setSettings(false);
  }

  return (
    <>
      <Button type="button" variant={variant} onClick={start}>
        <PlayIcon />
        Presentazione
      </Button>
      {open && (
        <SlideshowPlayer
          key={branch ? "rami" : "album"}
          source={source}
          title={title}
          branch={branch}
          onBranchChange={hasSubalbums ? setBranch : undefined}
          onlyEdited={onlyEdited}
          onClose={close}
          settings={settings}
          setSettings={setSettings}
          castAppId={castAppId}
        />
      )}
    </>
  );
}

function SlideshowPlayer({
  source,
  title,
  branch,
  onBranchChange,
  onlyEdited,
  onClose,
  settings,
  setSettings,
  castAppId,
}: {
  source: SlideshowSource;
  title: string;
  branch: boolean;
  onBranchChange?: (v: boolean) => void;
  onlyEdited: boolean;
  onClose: () => void;
  settings: boolean;
  setSettings: (v: boolean | ((prev: boolean) => boolean)) => void;
  castAppId: string | null;
}) {
  const [slides, setSlides] = useState<Record<number, Slide>>({});
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [interval, setIntervalSec] = useState(() => parseInterval(readPref(INTERVAL_KEY)));
  const [transition, setTransition] = useState<SlideTransition>(() => parseTransition(readPref(TRANSITION_KEY)));
  /**
   * Transizione con cui è entrata la foto attuale: cambiando la scelta nelle
   * impostazioni vale dalla foto successiva, senza rifare l'animazione di questa.
   */
  const [enterWith, setEnterWith] = useState<SlideTransition>(transition);
  /** Verso dell'ultimo passo: lo scorrimento entra da destra (avanti) o da sinistra (indietro). */
  const [dir, setDir] = useState<"next" | "prev">("next");
  const [readySrc, setReadySrc] = useState<string | null>(null);
  /** Foto di prima, tenuta sotto (o che esce) mentre compare la nuova. */
  const [backSrc, setBackSrc] = useState<string | null>(null);
  const [controls, setControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(fullscreenOn);
  const fetched = useRef(new Map<number, number>());
  const inflight = useRef(new Set<number>());
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const cast = useCast(castAppId);

  const loaded = Object.keys(slides).length;
  const slide = slides[index] ?? null;
  const front = slide?.src ?? null;
  const ready = slide !== null && (front === null || readySrc === front);

  // --- Foto dall'API, a blocchi ---

  const load = useCallback(
    async (offset: number) => {
      if (inflight.current.has(offset)) return;
      inflight.current.add(offset);
      const q = new URLSearchParams();
      if (source.album) q.set("album", source.album);
      if (source.s) q.set("s", source.s);
      if (source.t) q.set("t", source.t);
      if (branch) q.set("rami", "1");
      if (onlyEdited) q.set("solo", "regolazioni");
      q.set("da", String(offset));
      try {
        const res = await fetch(`/api/presentazione?${q}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SlideshowResponse;
        fetched.current.set(offset, Date.now());
        setTotal(data.total);
        setSlides((prev) => {
          const next = { ...prev };
          data.slides.forEach((s, i) => (next[data.offset + i] = s));
          return next;
        });
        setError(false);
      } catch (e) {
        console.error("[presentazione]", e);
        setError(true);
      } finally {
        inflight.current.delete(offset);
      }
    },
    [source.album, source.s, source.t, branch, onlyEdited],
  );

  useEffect(() => {
    const now = Date.now();
    for (const b of batchesFor(index, total ?? 0)) {
      const at = fetched.current.get(b);
      if (at === undefined || !batchFresh(at, now)) void load(b);
    }
  }, [index, total, load]);

  // --- Navigazione ---

  const go = useCallback(
    (step: 1 | -1) => {
      if (!total) return;
      setBackSrc(readySrc);
      setDir(step === 1 ? "next" : "prev");
      setEnterWith(transition);
      setIndex((i) => stepIndex(i, step, total, loaded));
    },
    [total, loaded, readySrc, transition],
  );

  // Avanti da sola: il tempo parte quando la foto è a schermo.
  useEffect(() => {
    if (!playing || !ready || !total || total < 2) return;
    const t = setTimeout(() => go(1), interval * 1000);
    return () => clearTimeout(t);
  }, [playing, ready, total, interval, go, index]);

  // La foto successiva si scarica in anticipo.
  useEffect(() => {
    if (!total) return;
    const next = slides[stepIndex(index, 1, total, loaded)];
    if (next?.src) new Image().src = next.src;
  }, [index, total, loaded, slides]);

  // Sulla TV: ogni foto mostrata va anche al Chromecast, con la stessa
  // transizione. Intervallo e pausa letti da un ref: cambiarli non rimanda la foto.
  const timing = useRef({ interval, playing });
  useEffect(() => {
    timing.current = { interval, playing };
  }, [interval, playing]);
  useEffect(() => {
    if (!cast.device || !slide?.src) return;
    castPhoto({
      url: new URL(slide.src, window.location.href).href,
      title: slide.name,
      takenAt: slide.takenAt,
      transition: enterWith,
      dir,
      seconds: timing.current.playing ? timing.current.interval : 0,
    });
  }, [cast.device, slide, enterWith, dir]);

  // --- Controlli che spariscono durante la riproduzione ---

  const poke = useCallback(() => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), HIDE_CONTROLS_MS);
  }, []);

  // All'apertura i controlli si vedono, poi spariscono (initial state `controls` = true).
  useEffect(() => {
    hideTimer.current = setTimeout(() => setControls(false), HIDE_CONTROLS_MS);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const showControls = controls || !playing || settings;

  // --- Tastiera ---

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " " || e.key === "k") setPlaying((p) => !p);
      else if (e.key === "f") toggleFullscreen();
      else if (e.key === "Escape") onClose();
      else return;
      e.preventDefault();
      e.stopPropagation();
      poke();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, onClose, poke]);

  // --- Schermo intero e schermo sempre acceso ---

  useEffect(() => {
    const onChange = () => setFullscreen(fullscreenOn());
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    // Lo schermo non si spegne durante la presentazione (anche mentre fa da telecomando per la TV).
    if (!playing || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (alive) lock = l;
          else void l.release();
        })
        .catch(() => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => {});
    };
  }, [playing]);

  function chooseInterval(sec: number) {
    setIntervalSec(sec);
    savePref(INTERVAL_KEY, String(sec));
  }

  function chooseTransition(t: SlideTransition) {
    setTransition(t);
    savePref(TRANSITION_KEY, t);
  }

  // --- Swipe e tocchi ---

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    swipe.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1);
      poke();
    } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      // Un tocco sulla foto mostra o nasconde i controlli.
      if (settings) setSettings(false);
      else if (showControls && playing) setControls(false);
      else poke();
    }
  }

  const empty = total === 0;
  const position = total ? `${index + 1} di ${total}` : "";

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className={`slideshow${showControls ? "" : " is-idle"}`}
          data-transition={enterWith}
          data-dir={dir}
          data-playing={playing ? "1" : "0"}
          style={{ "--slide-duration": `${interval}s` } as CSSProperties}
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerMove={(e) => e.pointerType === "mouse" && poke()}
        >
          <DialogPrimitive.Title className="sr-only">Presentazione: {title}</DialogPrimitive.Title>

          <div className="slideshow-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
            {backSrc && backSrc !== front && (
              // eslint-disable-next-line @next/next/no-img-element -- URL firmati temporanei
              <img
                key={`back:${backSrc}`}
                src={backSrc}
                alt=""
                className={`slideshow-img is-back${readySrc === front ? " is-leaving" : ""}`}
                draggable={false}
              />
            )}
            {front && (
              // eslint-disable-next-line @next/next/no-img-element -- URL firmati temporanei
              <img
                key={`front:${front}`}
                src={front}
                alt={slide?.name ?? ""}
                className={`slideshow-img${readySrc === front ? " is-ready" : ""}`}
                draggable={false}
                onLoad={() => setReadySrc(front)}
                onError={() => setReadySrc(front)}
              />
            )}
            {slide && !front && <p className="slideshow-msg">Anteprima non disponibile</p>}
            {!slide && !error && !empty && <div className="slideshow-spinner" aria-label="Caricamento" />}
            {error && !slide && (
              <p className="slideshow-msg">
                Non riesco a caricare le foto.{" "}
                <button type="button" onClick={() => void load(0)}>
                  Riprova
                </button>
              </p>
            )}
            {empty && <p className="slideshow-msg">Non ci sono foto da mostrare.</p>}
          </div>

          {cast.device && (
            <p className="slideshow-casting" role="status">
              <CastIcon aria-hidden />
              Sulla TV: {cast.device}. Tieni aperta questa pagina, fa da telecomando.
            </p>
          )}

          <div className="slideshow-top">
            <div className="slideshow-title">
              <strong>{title}</strong>
              <span>{position}</span>
            </div>
            <div className="slideshow-actions">
              {cast.available && (
                <button
                  type="button"
                  className={`lightbox-btn${cast.device ? " is-on" : ""}`}
                  onClick={() => (cast.device ? cast.stop() : cast.start())}
                  aria-label={cast.device ? `Smetti di trasmettere su ${cast.device}` : "Trasmetti sulla TV"}
                  title={cast.device ? "Smetti di trasmettere" : "Trasmetti sulla TV (Chromecast)"}
                  disabled={cast.connecting}
                >
                  <CastIcon />
                </button>
              )}
              <button
                type="button"
                className={`lightbox-btn${settings ? " is-on" : ""}`}
                onClick={() => setSettings((v) => !v)}
                aria-label="Impostazioni"
                aria-expanded={settings}
                title="Impostazioni"
              >
                <Settings2Icon />
              </button>
              {typeof document !== "undefined" && document.fullscreenEnabled && (
                <button
                  type="button"
                  className="lightbox-btn"
                  onClick={toggleFullscreen}
                  aria-label={fullscreen ? "Esci dallo schermo intero" : "Schermo intero"}
                  title={fullscreen ? "Esci dallo schermo intero (F)" : "Schermo intero (F)"}
                >
                  {fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
                </button>
              )}
              <button type="button" className="lightbox-btn" onClick={onClose} aria-label="Chiudi" title="Chiudi (Esc)">
                <XIcon />
              </button>
            </div>
          </div>

          {settings && (
            <div className="slideshow-settings" role="group" aria-label="Impostazioni della presentazione">
              <p>Ogni foto resta</p>
              <div className="slideshow-chips">
                {SLIDE_INTERVALS.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    className={sec === interval ? "is-on" : undefined}
                    aria-pressed={sec === interval}
                    onClick={() => chooseInterval(sec)}
                  >
                    {sec} s
                  </button>
                ))}
              </div>
              <p>Transizione</p>
              <div className="slideshow-chips">
                {SLIDE_TRANSITIONS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={t.id === transition ? "is-on" : undefined}
                    aria-pressed={t.id === transition}
                    onClick={() => chooseTransition(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {cast.device && !cast.custom && (
                <p className="slideshow-hint">Sulla TV le foto cambiano senza transizione (ricevitore standard di Google).</p>
              )}
              {onBranchChange && (
                <label className="slideshow-check">
                  <input type="checkbox" checked={branch} onChange={(e) => onBranchChange(e.target.checked)} />
                  Anche le foto dei sotto-album
                </label>
              )}
            </div>
          )}

          <div className="slideshow-bottom">
            {slide && <p className="slideshow-name">{slide.name}</p>}
            <div className="slideshow-buttons">
              <button
                type="button"
                className="lightbox-btn"
                onClick={() => go(-1)}
                aria-label="Foto precedente"
                title="Precedente (←)"
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                className="lightbox-btn slideshow-play"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? "Pausa" : "Riprendi"}
                title={playing ? "Pausa (spazio)" : "Riprendi (spazio)"}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button
                type="button"
                className="lightbox-btn"
                onClick={() => go(1)}
                aria-label="Foto successiva"
                title="Successiva (→)"
              >
                <ChevronRightIcon />
              </button>
            </div>
          </div>

          {/* Quanto manca alla prossima foto. */}
          {playing && ready && (total ?? 0) > 1 && (
            <div
              key={`${index}-${interval}`}
              className="slideshow-progress"
              style={{ animationDuration: `${interval}s` }}
              aria-hidden
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
