import "server-only";
import { getAlbum, getAlbumById, isAlbumInBranch, type AlbumRow } from "./gallery";
import { getCurrentUser } from "./session";
import { effectiveDownload, type DownloadLevel, type Role } from "./roles";
import { getLinkShare, getUserShare, type ShareRow } from "./shares";

/*
 * Chi può leggere le foto di un album dalle API (presentazione, griglia):
 *   ?album=<album>                          proprietario
 *   ?s=<condivisione>[&album=<sotto-album>] condivisione protetta (login)
 *   ?t=<token>[&album=<sotto-album>]        link libero
 * Gli stessi controlli delle pagine: per le condivisioni solo l'album
 * condiviso o un suo sotto-album.
 */

export type AlbumAccess = {
  album: AlbumRow;
  /** Dove si aprono le foto: "" (proprietario), "/condivisi/<id>" o "/l/<token>". */
  base: string;
  /** Parametri da aggiungere ai link delle foto (il sotto-album aperto). */
  albumQ: Record<string, string>;
  owner: boolean;
  /** La condivisione da cui si arriva (null per il proprietario). */
  share: ShareRow | null;
  /** Utente collegato e suo ruolo (null per i link liberi). */
  userId: number | null;
  role: Role | null;
  /** Cosa si può scaricare: ruolo e condivisione insieme (effectiveDownload). */
  level: DownloadLevel;
};

export type AlbumAccessError = { status: number; error: string };

export async function albumAccess(sp: URLSearchParams): Promise<AlbumAccess | AlbumAccessError> {
  const albumParam = sp.get("album");
  const token = sp.get("t");
  const shareId = sp.get("s");

  if (token || shareId) {
    let share;
    let base: string;
    let userId: number | null = null;
    let role: Role | null = null;
    let level: DownloadLevel = "none";
    if (token) {
      share = await getLinkShare(token);
      base = `/l/${token}`;
      if (share) level = effectiveDownload(share.allow_download, null);
    } else {
      const user = await getCurrentUser();
      if (!user) return { status: 401, error: "Accesso richiesto." };
      share = await getUserShare(shareId!, user);
      base = `/condivisi/${shareId}`;
      userId = user.id;
      role = user.role;
      if (share) level = effectiveDownload(share.allow_download, user.role);
    }
    if (!share || share.target_type !== "album" || !share.album_id) {
      return { status: 404, error: "Condivisione non trovata." };
    }
    const root = await getAlbumById(share.album_id);
    if (!root) return { status: 404, error: "Album non trovato." };
    if (!albumParam || albumParam === root.public_id)
      return {
        album: root,
        base,
        albumQ: {},
        owner: false,
        share,
        userId,
        role,
        level,
      };
    const sub = await getAlbum(albumParam);
    if (!sub || !(await isAlbumInBranch(root.id, sub.id))) return { status: 404, error: "Album non trovato." };
    return {
      album: sub,
      base,
      albumQ: { album: sub.public_id },
      owner: false,
      share,
      userId,
      role,
      level,
    };
  }

  const user = await getCurrentUser();
  if (!user) return { status: 401, error: "Accesso richiesto." };
  if (user.role !== "owner") return { status: 403, error: "Non autorizzato." };
  const album = albumParam ? await getAlbum(albumParam) : null;
  if (!album) return { status: 404, error: "Album non trovato." };
  return {
    album,
    base: "",
    albumQ: { album: album.public_id },
    owner: true,
    share: null,
    userId: user.id,
    role: user.role,
    level: "original",
  };
}
