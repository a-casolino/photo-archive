/**
 * Ruoli e permessi di download (decisi con Antonio il 2026-11-06).
 *   owner   -> tutto
 *   trusted -> "fidato": scarica l'originale CR2 se la condivisione lo permette
 *   viewer  -> "visualizzatore": al massimo il JPEG grande
 * I link liberi non hanno un utente e non danno mai l'originale.
 */
export type Role = "owner" | "trusted" | "viewer";
export type DownloadLevel = "none" | "preview" | "original";

export const ROLES: readonly Role[] = ["owner", "trusted", "viewer"];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Proprietario",
  trusted: "Fidato",
  viewer: "Visualizzatore",
};

const LEVEL_RANK: Record<DownloadLevel, number> = { none: 0, preview: 1, original: 2 };

/** Tetto massimo di download consentito dal ruolo (null = link libero). */
export function roleCeiling(role: Role | null): DownloadLevel {
  return role === "owner" || role === "trusted" ? "original" : "preview";
}

/** Permesso effettivo = minimo tra quanto concede la condivisione e il ruolo. */
export function effectiveDownload(shareAllows: DownloadLevel, role: Role | null): DownloadLevel {
  if (role === "owner") return "original";
  const ceiling = roleCeiling(role);
  return LEVEL_RANK[shareAllows] <= LEVEL_RANK[ceiling] ? shareAllows : ceiling;
}

export function canDownload(level: DownloadLevel, wanted: Exclude<DownloadLevel, "none">): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[wanted];
}
