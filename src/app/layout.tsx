import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// Font dell'app. next/font lo scarica durante la build e lo serve dal nostro
// dominio: il browser non fa richieste a Google.
// Geist (lo stesso di shadcn/ui), scelto da Antonio l'8/11/2026 al posto di
// IBM Plex Sans Condensed.
const geist = Geist({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-app",
});

export const metadata: Metadata = {
  title: "Antonio Casolino | Photo Archive",
  description: "Archivio fotografico privato",
  // Nessuna pagina dell'app va indicizzata (anche i link liberi).
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="it" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
