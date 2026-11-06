import Link from "next/link";
import { requestPasswordReset } from "@/app/actions/auth";
import { ActionForm } from "@/app/ui/action-form";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-card">
      <h1>Password dimenticata</h1>
      <p className="muted">Inserisci la tua email: ti mandiamo un link per sceglierne una nuova.</p>
      <ActionForm action={requestPasswordReset} submitLabel="Invia il link">
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required autoFocus />
        </label>
      </ActionForm>
      <p className="muted">
        <Link href="/login">Torna all&apos;accesso</Link>
      </p>
    </main>
  );
}
