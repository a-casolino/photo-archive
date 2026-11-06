import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Archivio foto",
  description: "Archivio fotografico privato",
  // Nessuna pagina dell'app va indicizzata (anche i link liberi).
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
