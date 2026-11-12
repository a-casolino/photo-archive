import Link from "next/link";
import { CheckIcon, SquareCheckIcon } from "lucide-react";
import { trashPhotosAction } from "@/app/actions/trash";
import { Masonry, type MasonryItem } from "@/app/ui/gallery/masonry";
import { SelectBar } from "@/app/ui/gallery/select-bar";
import { Button } from "@/components/ui/button";

/*
 * Selezione multipla nelle gallerie del proprietario (Foto, tag, persona):
 * il pulsante "Seleziona" accende le caselle (?seleziona=1) e la barra
 * sposta nel cestino le foto spuntate.
 */

/** Percorso con la query data, senza "?" se vuota. */
export function pathWith(base: string, query: Record<string, string>): string {
  const q = new URLSearchParams(query).toString();
  return q ? `${base}?${q}` : base;
}

export function SelectToggle({ selecting, href }: { selecting: boolean; href: string }) {
  return (
    <Button asChild variant={selecting ? "secondary" : "outline"}>
      <Link href={href} prefetch={false}>
        {selecting ? <CheckIcon /> : <SquareCheckIcon />}
        {selecting ? "Fine selezione" : "Seleziona"}
      </Link>
    </Button>
  );
}

/** Griglia di foto; in selezione, con la barra "Sposta nel cestino". `back`: dove tornare dopo. */
export function SelectableMasonry({ items, selecting, back }: { items: MasonryItem[]; selecting: boolean; back: string }) {
  if (!selecting) return <Masonry items={items} />;
  return (
    <form>
      <input type="hidden" name="back" value={back} />
      <SelectBar name="photo">
        <button type="submit" className="danger" formAction={trashPhotosAction}>
          Sposta nel cestino
        </button>
      </SelectBar>
      <Masonry items={items} selectName="photo" />
    </form>
  );
}
