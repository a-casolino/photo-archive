/*
 * Regole pure del filtro per dispositivo (fotocamera o telefono) della
 * pagina Foto: niente database, verificate dai test in
 * tests/device-rules.test.ts.
 *
 * Il dispositivo è quello dell'EXIF (tabella `cameras`: marca, modello,
 * numero di serie). Una riga per ogni corpo macchina: due 7D con seriali
 * diversi sono lo stesso modello e nel filtro diventano una voce sola.
 */

export type CameraRow = { id: number; make: string; model: string; serial: string; display_name: string | null };

export type DeviceKind = "camera" | "phone";

/** Un modello nel filtro: tutte le righe di `cameras` con la stessa marca e modello. */
export type DeviceOption = { slug: string; label: string; kind: DeviceKind; cameraIds: number[] };

/** Valori del filtro oltre ai singoli modelli. */
export const DEVICE_GROUPS = {
  cameras: "fotocamere",
  phones: "telefoni",
  none: "sconosciuto",
} as const;

export const DEVICE_GROUP_LABEL: Record<(typeof DEVICE_GROUPS)[keyof typeof DEVICE_GROUPS], string> = {
  fotocamere: "Fotocamere",
  telefoni: "Telefoni",
  sconosciuto: "Senza dati del dispositivo",
};

const PHONE_MAKERS =
  /^(apple|samsung|huawei|honor|xiaomi|redmi|poco|google|oneplus|motorola|lg|lge|oppo|realme|vivo|nokia|hmd|htc|zte|asus|wiko|alcatel|tcl|meizu|lenovo|nothing|fairphone|blackberry|bq|doogee|ulefone|cubot|umidigi|infinix|tecno)\b/i;
const PHONE_MODELS = /\b(iphone|ipad|ipod|xperia|pixel|galaxy|redmi|nexus)\b/i;
/** Sony fa sia fotocamere sia telefoni (Xperia): le fotocamere hanno queste sigle. */
const SONY_CAMERA_MODELS = /^(ilce|ilca|ilme|dsc|nex|slt|dslr|zv|rx|a\d)/i;

/** Fotocamera o telefono, da marca e modello EXIF. Nel dubbio è una fotocamera. */
export function deviceKind(make: string, model: string): DeviceKind {
  if (PHONE_MAKERS.test(make.trim()) || PHONE_MODELS.test(model)) return "phone";
  if (/^sony/i.test(make.trim())) {
    const m = model.trim().replace(/^sony\s+/i, "");
    return SONY_CAMERA_MODELS.test(m) ? "camera" : "phone";
  }
  return "camera";
}

/** "NIKON CORPORATION" → "Nikon", "SAMSUNG" e "samsung" → "Samsung", "Canon" resta. */
export function cleanMake(make: string): string {
  const s = make
    .trim()
    .replace(/([,.]?\s*(corporation|corp\.?|co\.?,?\s*ltd\.?|inc\.?|imaging|company|ltd\.?))+$/gi, "")
    .trim();
  if (s.length > 3 && s === s.toUpperCase()) return s.charAt(0) + s.slice(1).toLowerCase();
  if (s === s.toLowerCase()) return s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

/** Nome da mostrare: "Canon EOS 7D", "Apple iPhone 12", "Samsung SM-G991B". */
export function deviceLabel(make: string, model: string): string {
  const mk = cleanMake(make);
  const md = model.trim();
  if (!mk) return md;
  if (!md) return mk;
  return md.toLowerCase().startsWith(mk.toLowerCase()) ? md : `${mk} ${md}`;
}

export function deviceSlug(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Le voci del filtro dalle righe di `cameras`: un modello per voce, prima
 * le fotocamere e poi i telefoni, in ordine alfabetico. Se Antonio ha dato
 * un nome comodo (`display_name`) si usa quello.
 */
export function deviceOptions(rows: CameraRow[]): DeviceOption[] {
  const bySlug = new Map<string, DeviceOption>();
  for (const r of rows) {
    const base = deviceLabel(r.make, r.model);
    const slug = deviceSlug(base);
    if (!slug) continue;
    const found = bySlug.get(slug);
    if (found) {
      found.cameraIds.push(r.id);
      if (r.display_name?.trim() && found.label === base) found.label = r.display_name.trim();
    } else {
      bySlug.set(slug, {
        slug,
        label: r.display_name?.trim() || base,
        kind: deviceKind(r.make, r.model),
        cameraIds: [r.id],
      });
    }
  }
  return [...bySlug.values()].sort(
    (a, b) => (a.kind === b.kind ? 0 : a.kind === "camera" ? -1 : 1) || a.label.localeCompare(b.label, "it", { numeric: true }),
  );
}

/**
 * Il filtro scelto: un gruppo (tutte le fotocamere, tutti i telefoni, senza
 * dati EXIF) o un modello. `cameraIds` null = foto senza dispositivo.
 */
export type DeviceFilter = { value: string; label: string; cameraIds: number[] | null };

/** Dal parametro dell'URL al filtro; valori sconosciuti si ignorano. */
export function parseDeviceFilter(raw: string | undefined, options: DeviceOption[]): DeviceFilter | undefined {
  if (!raw) return undefined;
  if (raw === DEVICE_GROUPS.none) return { value: raw, label: DEVICE_GROUP_LABEL[raw], cameraIds: null };
  if (raw === DEVICE_GROUPS.cameras || raw === DEVICE_GROUPS.phones) {
    const kind: DeviceKind = raw === DEVICE_GROUPS.cameras ? "camera" : "phone";
    return {
      value: raw,
      label: DEVICE_GROUP_LABEL[raw],
      cameraIds: options.filter((o) => o.kind === kind).flatMap((o) => o.cameraIds),
    };
  }
  const opt = options.find((o) => o.slug === raw);
  return opt ? { value: opt.slug, label: opt.label, cameraIds: opt.cameraIds } : undefined;
}

/** Condizione SQL sulla colonna `col` (camera_id della foto mostrata). */
export function deviceFilterSql(col: string, f: DeviceFilter): { sql: string; params: number[] } {
  if (f.cameraIds === null) return { sql: `${col} IS NULL`, params: [] };
  if (f.cameraIds.length === 0) return { sql: "FALSE", params: [] };
  return { sql: `${col} IN (${f.cameraIds.map(() => "?").join(", ")})`, params: f.cameraIds };
}
