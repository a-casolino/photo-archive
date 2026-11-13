"use client";

import { useEffect, useState } from "react";
import { castSupported } from "@/lib/slideshow-rules";

/*
 * Google Cast (Chromecast, TV con Google TV, Nest Hub…) per la presentazione.
 *
 * Usa il Web Sender SDK di Google e il "Default Media Receiver", l'app di
 * Google già presente su ogni Chromecast (nessuna registrazione, ma cambia
 * foto di colpo, senza transizioni), oppure, se è configurato CAST_APP_ID, il
 * ricevitore nostro: la pagina /tv (src/app/tv/route.ts), che mostra le foto
 * con la transizione scelta. Il browser manda alla TV l'URL firmato di una
 * foto alla volta e la TV la scarica direttamente dall'archivio; la
 * presentazione la guida questa pagina, che deve restare aperta.
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
  sendMessage(namespace: string, message: unknown): Promise<unknown>;
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

/** Canale dei messaggi tra la presentazione e il ricevitore nostro (/tv). */
export const CAST_NAMESPACE = "urn:x-cast:com.acasolino.foto";

let loading: Promise<CastContext | null> | null = null;
/** App ID del ricevitore nostro, se configurato (CAST_APP_ID); altrimenti quello di Google. */
let customAppId: string | null = null;

/**
 * Carica l'SDK (una volta) e configura il ricevitore: quello nostro se c'è
 * `appId` (transizioni come nella pagina), altrimenti il Default Media Receiver
 * di Google, che cambia foto di colpo. null se Cast non c'è.
 */
function loadCast(appId: string | null): Promise<CastContext | null> {
  if (loading) return loading;
  const w = window as CastWindow;
  if (!castSupported(navigator.userAgent, navigator.maxTouchPoints)) return (loading = Promise.resolve(null));
  loading = new Promise((resolve) => {
    w.__onGCastApiAvailable = (available) => {
      if (!available || !w.cast || !w.chrome?.cast) return resolve(null);
      const ctx = w.cast.framework.CastContext.getInstance();
      customAppId = appId;
      ctx.setOptions({
        receiverApplicationId: appId ?? w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
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
  /** La TV usa il ricevitore nostro, con le transizioni. */
  custom: boolean;
  /** Apre la scelta del dispositivo di Chrome. */
  start(): void;
  /** Smette di trasmettere (la TV torna alla sua schermata). */
  stop(): void;
};

export function useCast(appId: string | null): CastControl {
  const [ctx, setCtx] = useState<CastContext | null>(null);
  const [state, setState] = useState<CastState>("NO_DEVICES_AVAILABLE");

  useEffect(() => {
    let alive = true;
    let current: CastContext | null = null;
    const w = window as CastWindow;
    const onChange = (e: { castState: CastState }) => setState(e.castState);
    loadCast(appId).then((c) => {
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
  }, [appId]);

  return {
    custom: !!ctx && !!appId,
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

/** Cosa mostra la TV: la foto e come arrivarci (solo il ricevitore nostro usa transizione e tempo). */
export type CastSlide = {
  url: string;
  title: string;
  takenAt: string | null;
  transition: string;
  dir: "next" | "prev";
  /** Secondi a schermo (serve allo zoom lento); 0 in pausa. */
  seconds: number;
};

/** Manda una foto alla TV collegata (se c'è). `url` assoluto, raggiungibile dalla TV. */
export function castPhoto(slide: CastSlide): void {
  const w = window as CastWindow;
  const sdk = w.chrome?.cast;
  const session = w.cast?.framework.CastContext.getInstance().getCurrentSession();
  if (!sdk || !session) return;
  if (customAppId) {
    session
      .sendMessage(CAST_NAMESPACE, { type: "show", ...slide })
      .catch((e) => console.warn("[cast] foto non inviata", e));
    return;
  }
  const info = new sdk.media.MediaInfo(slide.url, "image/jpeg");
  info.contentUrl = slide.url;
  const meta = new sdk.media.PhotoMediaMetadata();
  meta.title = slide.title;
  if (slide.takenAt) meta.creationDateTime = slide.takenAt;
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
