import { namedLinkExists } from "@/lib/named-links";
import { linkKeyKind } from "@/lib/named-link-rules";
import { LinkEmpty, LinkUnavailable } from "./unavailable";

/** Cosa mostrare quando /l/<x> non apre niente: pagina vuota per i link con nome, altrimenti "non disponibile". */
export async function LinkMissing({ token }: { token: string }) {
  if (linkKeyKind(token) === "slug" && (await namedLinkExists(token))) return <LinkEmpty />;
  return <LinkUnavailable />;
}
