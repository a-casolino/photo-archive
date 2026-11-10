import type { AlbumRef } from "./import-shared";
import { folderPlacement } from "./album-tree-rules";

/*
 * Album delle cartelle, uguali per il programma di import e per la pagina
 * "Carica dal browser": la stessa cartella finisce sempre nello stesso album.
 */

/**
 * Album di una cartella del disco, con gli album delle cartelle che la
 * contengono (sotto-album, al massimo 3 livelli). La cartella scelta è il
 * primo livello, se ha un nome (la radice di un disco no). Il riferimento
 * di ogni album resta quello di sempre: il nome della cartella scelta per
 * lei, il percorso relativo per le altre, così un nuovo import ritrova gli
 * album già creati.
 */
export function diskAlbum(rootName: string, relDir: string): AlbumRef {
  const rel = relDir ? relDir.split("/") : [];
  const segments = rootName ? [rootName, ...rel] : rel;
  const refOf = (n: number) => (rootName ? (n === 1 ? rootName : rel.slice(0, n - 1).join("/")) : rel.slice(0, n).join("/"));
  const { parents, title } = folderPlacement(segments);
  const album: AlbumRef = { origin: "disk_folder", ref: refOf(segments.length), title: title.slice(0, 255) };
  if (parents.length) album.parents = parents.map((n) => ({ ref: refOf(n), title: segments[n - 1].slice(0, 255) }));
  return album;
}
