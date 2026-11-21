/*
 * Regole (senza database) per l'anteprima dei link condivisi sui social:
 * i tag Open Graph che leggono WhatsApp, Facebook, Telegram, LinkedIn, X…
 * Il codice server è in src/lib/link-preview.ts.
 */

/** Dimensione dell'immagine di anteprima: 1,91:1, quella consigliata da Facebook e LinkedIn. */
export const PREVIEW_IMAGE_WIDTH = 1200;
export const PREVIEW_IMAGE_HEIGHT = 630;

/** Nome del sito mostrato sotto il titolo (og:site_name). */
export const SITE_NAME = "Antonio Casolino | Photo Archive";

/** Lunghezza massima della descrizione: oltre, i social la tagliano comunque. */
export const MAX_DESCRIPTION = 200;

/** Accorcia un testo su una parola, con i puntini. Spazi e a capo diventano uno spazio solo. */
export function clip(text: string, max = MAX_DESCRIPTION): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Descrizione dell'anteprima di un album: il messaggio della condivisione se
 * c'è, altrimenti la descrizione dell'album, altrimenti date e numero di foto.
 */
export function albumPreviewDescription(a: {
  message: string | null;
  description: string | null;
  dates: string;
  photos: number;
}): string {
  const own = a.message?.trim() || a.description?.trim();
  if (own) return clip(own);
  const count = a.photos === 1 ? "1 foto" : `${a.photos.toLocaleString("it-IT")} foto`;
  return [a.dates, count].filter(Boolean).join(" · ");
}

/**
 * Programmi che scaricano la pagina solo per costruire l'anteprima del link
 * (non sono persone): non contano come visite della condivisione.
 */
const PREVIEW_BOTS =
  /facebookexternalhit|facebookcatalog|meta-externalagent|whatsapp|telegrambot|twitterbot|linkedinbot|slackbot|discordbot|skypeuripreview|pinterest|redditbot|applebot|googlebot|bingbot|embedly|vkshare|viber|snapchat|signal|iframely|mastodon/i;

export function isPreviewBot(userAgent: string | null | undefined): boolean {
  return !!userAgent && PREVIEW_BOTS.test(userAgent);
}
