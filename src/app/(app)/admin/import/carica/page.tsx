import Link from "next/link";
import { Uploader } from "@/app/ui/upload/uploader";
import { requireOwner } from "@/lib/session";
import { uploaderProps } from "@/lib/upload/page-props";

/*
 * "Carica dal browser": foto e cartelle trascinate o scelte, anche dal
 * telefono. Il lavoro lo fa il browser (src/lib/upload/engine.ts); i file
 * vanno direttamente su Google Cloud, la VPS registra soltanto.
 */

export const metadata = { title: "Carica dal browser" };

export default async function UploadPage() {
  await requireOwner();
  return (
    <>
      <div className="import-head">
        <h1>Carica dal browser</h1>
        <Link prefetch={false} href="/admin/import" className="muted">
          ← Import
        </Link>
      </div>
      <Uploader scope="carica" {...await uploaderProps()} />
    </>
  );
}
