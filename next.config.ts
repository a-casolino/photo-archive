import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components disattivati: quasi ogni pagina dipende dall'utente
  // collegato e l'app ha pochi utenti, quindi il rendering dinamico classico
  // è più semplice e sufficiente. Si può riattivare pagina per pagina più avanti.
  cacheComponents: false,
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
