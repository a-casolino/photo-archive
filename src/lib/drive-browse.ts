import "server-only";
import type { DriveFileLite } from "./drive-rules";
import { type DriveClient, type DriveFile, driveQuote, FOLDER_MIME } from "./google-drive";

/* Ricerche su Drive per la pagina Import → Google Drive. */

/** I file di Google Takeout presenti su Drive (di solito nella cartella "Takeout"). */
export async function listTakeoutFiles(client: DriveClient): Promise<DriveFileLite[]> {
  const files = await client.list(
    `name contains 'takeout-' and trashed = false and mimeType != ${driveQuote(FOLDER_MIME)}`,
    { orderBy: "name_natural", max: 5000 },
  );
  return files.map((f) => ({ id: f.id, name: f.name, size: Number(f.size ?? 0), modifiedTime: f.modifiedTime }));
}

export type FolderView = {
  folder: DriveFile | null; // null = radice o "Condivisi con me"
  folders: DriveFile[];
  images: number;
  others: number;
};

/** Contenuto di una cartella: sottocartelle e quante immagini ci sono direttamente dentro. */
export async function browseFolder(client: DriveClient, id: string | "root" | "shared"): Promise<FolderView> {
  if (id === "shared") {
    const folders = await client.list(`sharedWithMe and trashed = false and mimeType = ${driveQuote(FOLDER_MIME)}`, {
      max: 2000,
    });
    return { folder: null, folders, images: 0, others: 0 };
  }
  const folder = id === "root" ? null : await client.file(id);
  const children = await client.list(`${driveQuote(folder?.id ?? "root")} in parents and trashed = false`, {
    max: 10_000,
  });
  const folders = children.filter((c) => c.mimeType === FOLDER_MIME);
  const images = children.filter((c) => c.mimeType.startsWith("image/")).length;
  return { folder, folders, images, others: children.length - folders.length - images };
}

/** Spazio dell'account Google in byte; `limit` è null per gli spazi illimitati. */
export type StorageQuota = { limit: number | null; usage: number; usageInDrive: number; usageInDriveTrash: number };

export async function storageQuota(client: DriveClient): Promise<StorageQuota> {
  const { storageQuota: q } = await client.get<{ storageQuota: Record<string, string | undefined> }>("about", {
    fields: "storageQuota",
  });
  const n = (v: string | undefined) => Number(v ?? 0) || 0;
  return {
    limit: q.limit ? n(q.limit) : null,
    usage: n(q.usage),
    usageInDrive: n(q.usageInDrive),
    usageInDriveTrash: n(q.usageInDriveTrash),
  };
}
