import Link from "next/link";
import type { FaceTile } from "@/lib/people";
import { formatTakenAt } from "@/lib/format";

/*
 * Griglia di miniature di volti. Con `field` ogni volto ha una casella
 * (spuntata di default) da inviare con il form che la contiene.
 */
export function FaceGrid({
  faces,
  urls,
  field,
  shownField,
  unchecked = false,
}: {
  faces: FaceTile[];
  urls: Map<string, string>;
  /** Nome della casella di ogni volto; senza, solo immagini. */
  field?: string;
  /** Campo nascosto con tutti i volti mostrati (per sapere quali sono stati tolti). */
  shownField?: string;
  /** Caselle vuote invece che spuntate. */
  unchecked?: boolean;
}) {
  return (
    <ul className={unchecked ? "face-grid face-grid-remove" : "face-grid"}>
      {faces.map((f) => {
        const src = f.face_key ? urls.get(f.face_key) : undefined;
        const title = [f.photo_filename, f.taken_at ? formatTakenAt(f.taken_at) : null].filter(Boolean).join(" · ");
        const img = src ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmati temporanei
          <img src={src} alt="" loading="lazy" width={96} height={96} />
        ) : (
          <span className="face-empty" />
        );
        return (
          <li key={f.id} title={title}>
            {field ? (
              <label className="face-pick">
                <input type="checkbox" name={field} value={f.id} defaultChecked={!unchecked} />
                {img}
              </label>
            ) : (
              img
            )}
            {shownField && <input type="hidden" name={shownField} value={f.id} />}
            <Link href={`/foto/${f.photo_public_id}`} prefetch={false} className="face-photo">
              foto
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function PeopleTabs({ current, groups, suggested }: { current: "persone" | "gruppi" | "suggerimenti"; groups: number; suggested: number }) {
  const tab = (key: typeof current, href: string, label: string) => (
    <Link href={href} prefetch={false} className={current === key ? "active" : undefined} aria-current={current === key ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <nav className="filter-tabs" aria-label="Sezioni">
      {tab("persone", "/persone", "Persone")}
      {tab("gruppi", "/persone/da-riconoscere", `Da riconoscere (${groups})`)}
      {tab("suggerimenti", "/persone/suggerimenti", `Suggerimenti (${suggested})`)}
    </nav>
  );
}
