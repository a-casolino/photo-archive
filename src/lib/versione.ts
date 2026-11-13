/**
 * Versione mostrata nel footer: "v0.<numero dell'ultima PR unita>", come
 * deciso da Antonio il 13/11/2026. Si calcola durante la build
 * (next.config.ts) dalla storia Git: niente "server-only", serve anche lì.
 */

/** Numero della PR più recente tra gli oggetti dei commit, dal più nuovo. */
export function ultimaPr(oggetti: string[]): number | null {
  for (const oggetto of oggetti) {
    // "Merge pull request #62 from ..." (merge) oppure "feat: ... (#62)" (squash).
    const m = /^Merge pull request #(\d+)\b/.exec(oggetto) ?? /\(#(\d+)\)\s*$/.exec(oggetto);
    if (m) return Number(m[1]);
  }
  return null;
}

/** "v0.62" dal numero di PR; null se non si sa. */
export function etichettaVersione(pr: number | null): string | null {
  return pr === null ? null : `v0.${pr}`;
}
