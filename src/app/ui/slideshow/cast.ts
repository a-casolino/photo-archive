"use client";

import { useEffect, useState } from "react";
import { castSupported } from "@/lib/slideshow-rules";

/*
 * Google Cast (Chromecast, TV con Google TV, Nest Hub…) per la presentazione.
 *
 * Usa il Web Sender SDK di Google e il "Default Media Receiver", l'app di
 * Google già presente su ogni Chromecast: non serve registrare niente. Il
 * browser manda alla TV l'URL firmato di una foto alla volta e la TV la
 * scarica direttamente dall'archivio; la presentazione la guida questa
 * pagina, che deve restare aperta.
 *
 * Funziona solo in Chrome ed Edge (computer e Android). Su iPhone, iPad,
 * Safari e Firefox il pulsante non compare: lì resta AirPlay o la
 * duplicazione dello schermo.
 *
 * Lo script si carica solo all'apertura della presentazione, una volta.
 */

const SDK_URL = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

// --- Tipi minimi delle parti dell'SDK usate qui ---

type CastState = "NO_DEVICES_AVAILABLE" | "NOT_CONNECTED" | "CONNECTING" | "CONNECTED";

type CastSession = {
  getCastDevice(): { friendlyName: string };
  loadMedia(request: unknown): Promise<unknown>;
};

type CastContext = {
  setOptions(options: { receiverApplicationId: string; autoJoinPolicy: string }): void;
  getCastState(): CastState;
  getCurrentSession(): CastSession | null;
  requestSession(): Promise<unknown>;
  endCurrentSession(stopCasting: boolean): void;
  addEventListener(type: string, handler: (e: { castState: CastState }) => void): void;
  removeEventListener(type: string, handler: (e: { castState: CastState }) => void): void;
};

type CastSdk = {
  framework: {
    CastContext: { getInstance(): CastContext };
    CastContextEventType: { CAST_STATE_CHANGED: string };
  };
};

type ChromeCastSdk = {
  AutoJoinPolicy: { ORIGIN_SCOPED: string };
  media: {
    DEFAULT_MEDIA_RECEIVER_APP_ID: string;
    MediaInfo: new (contentId: string, contentType: string) => {
      contentUrl?: string;
      metadata?: unknown;
    };
    PhotoMediaMetadata: new () => { title?: string; creationDateTime?: string };
    LoadRequest: new (media: unknown) => unknown;
  };
};

type CastWindow = Window & {
  __onGCastApiAvailable?: (available: boolean) => void;
  cast?: CastSdk;
  chrome?: { cast?: ChromeCastSdk };
};

let loading: Promise<CastContext | null> | null = null;

/** Carica l'SDK (una volta) e configura il ricevitore. null se Cast non c'è. */
function loadCast(): Promise<CastContext | null> {
  if (loading) return loading;
  const w = window as CastWindow;
  if (!castSupported(navigator.userAgent, navigator.maxTouchPoints)) return (loading = Promise.resolve(null));
  loading = new Promise((resolve) => {
    w.__onGCastApiAvailable = (available) => {
      if (!available || !w.cast || !w.chrome?.cast) return resolve(null);
      const ctx = w.cast.framework.CastContext.getInstance();
      ctx.setOptions({
        receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      resolve(ctx);
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return loading;
}

export type CastControl = {
  /** C'è almeno un dispositivo Cast nella rete (il pulsante si mostra). */
  available: boolean;
  connecting: boolean;
  /** Nome della TV collegata, o null. */
  device: string | null;
  /** Apre la scelta del dispositivo di Chrome. */
  start(): void;
  /** Smette di trasmettere (la TV torna alla sua schermata). */
  stop(): void;
};

export function useCast(): CastControl {
  const [ctx, setCtx] = useState<CastContext | null>(null);
  const [state, setState] = useState<CastState>("NO_DEVICES_AVAILABLE");

  useEffect(() => {
    let alive = true;
    let current: CastContext | null = null;
    const w = window as CastWindow;
    const onChange = (e: { castState: CastState }) => setState(e.castState);
    loadCast().then((c) => {
      if (!alive || !c || !w.cast) return;
      current = c;
      setCtx(c);
      setState(c.getCastState());
      c.addEventListener(w.cast.framework.CastContextEventType.CAST_STATE_CHANGED, onChange);
    });
    return () => {
      alive = false;
      if (current && w.cast) current.removeEventListener(w.cast.framework.CastContextEventType.CAST_STATE_CHANGED, onChange);
    };
  }, []);

  return {
    available: !!ctx && state !== "NO_DEVICES_AVAILABLE",
    connecting: state === "CONNECTING",
    device: state === "CONNECTED" ? (ctx?.getCurrentSession()?.getCastDevice().friendlyName ?? "TV") : null,
    start() {
      // Annullare la scelta del dispositivo rifiuta la promessa: non è un errore.
      ctx?.requestSession().catch(() => {});
    },
    stop() {
      ctx?.endCurrentSession(true);
    },
  };
}

/** Manda una foto alla TV collegata (se c'è). `url` assoluto, raggiungibile dalla TV. */
export function castPhoto(url: string, title: string, takenAt: string | null): void {
  const w = window as CastWindow;
  const sdk = w.chrome?.cast;
  const session = w.cast?.framework.CastContext.getInstance().getCurrentSession();
  if (!sdk || !session) return;
  const info = new sdk.media.MediaInfo(url, "image/jpeg");
  info.contentUrl = url;
  const meta = new sdk.media.PhotoMediaMetadata();
  meta.title = title;
  if (takenAt) meta.creationDateTime = takenAt;
  info.metadata = meta;
  session.loadMedia(new sdk.media.LoadRequest(info)).catch((e) => console.warn("[cast] foto non inviata", e));
}

/** Chiude la trasmissione, se ce n'è una (alla chiusura della presentazione). */
export function endCast(): void {
  const w = window as CastWindow;
  if (!w.cast) return;
  const ctx = w.cast.framework.CastContext.getInstance();
  if (ctx.getCurrentSession()) ctx.endCurrentSession(true);
}
