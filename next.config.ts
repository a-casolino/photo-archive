import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";
import { etichettaVersione, ultimaPr } from "./src/lib/versione";

// Versione per il footer ("v0.<ultima PR>"), letta da Git durante la build.
// xCloud fa il deploy con git pull, quindi la cartella .git c'è. Se Git
// manca la versione resta vuota e il footer non la mostra.
function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
const versione = etichettaVersione(ultimaPr(git("log", "--format=%s", "-n", "200").split("\n"))) ?? "";
const commit = git("rev-parse", "--short", "HEAD");

const nextConfig: NextConfig = {
  // Cache Components disattivati: quasi ogni pagina dipende dall'utente
  // collegato e l'app ha pochi utenti, quindi il rendering dinamico classico
  // è più semplice e sufficiente. Si può riattivare pagina per pagina più avanti.
  cacheComponents: false,
  env: { APP_VERSION: versione, APP_COMMIT: commit },
  // Librerie di Google lette da Node così come sono, senza passare dal bundler
  // (google-auth-library serve alla pagina Statistiche).
  serverExternalPackages: ["google-auth-library"],
  // Header di base: niente indicizzazione, niente iframe di terzi.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
