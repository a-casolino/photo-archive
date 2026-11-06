import { changeOwnPassword } from "@/app/actions/auth";
import { ActionForm } from "@/app/ui/action-form";
import { requireUser } from "@/lib/session";
import { ROLE_LABELS } from "@/lib/roles";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <h1>Il mio account</h1>
      <section className="card">
        <p>
          {user.name} · {user.email} · {ROLE_LABELS[user.role]}
        </p>
      </section>
      <section className="card" style={{ maxWidth: 420 }}>
        <h2>Cambia password</h2>
        <ActionForm action={changeOwnPassword} submitLabel="Aggiorna password">
          <label>
            Password attuale
            <input name="current" type="password" autoComplete="current-password" required />
          </label>
          <label>
            Nuova password (almeno 10 caratteri)
            <input name="password" type="password" autoComplete="new-password" minLength={10} required />
          </label>
          <label>
            Ripeti la nuova password
            <input name="confirm" type="password" autoComplete="new-password" minLength={10} required />
          </label>
        </ActionForm>
      </section>
    </>
  );
}
