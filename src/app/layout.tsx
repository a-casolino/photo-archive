import type { Metadata } from "next";
import { IBM_Plex_Sans_Condensed } from "next/font/google";
import "./globals.css";

// Font dell'app. next/font lo scarica durante la build e lo serve dal nostro
// dominio: il browser non fa richieste a Google.
const plexCondensed = IBM_Plex_Sans_Condensed({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-plex-condensed",
});

export const metadata: Metadata = {
  title: "Archivio foto",
  description: "Archivio fotografico privato",
  // Nessuna pagina dell'app va indicizzata (anche i link liberi).
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="it" className={plexCondensed.variable}>
      <body>{children}</body>
    </html>
  );
}
