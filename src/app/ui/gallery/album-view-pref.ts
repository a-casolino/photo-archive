/** Veduta scelta per l'elenco degli album, ricordata in un cookie del browser. */
export const ALBUM_VIEW_COOKIE = "album_vista";

export type AlbumView = "griglia" | "lista";

export function parseAlbumView(value: string | undefined): AlbumView {
  return value === "lista" ? "lista" : "griglia";
}
