import Link from "next/link";
import { resetPassword } from "@/app/actions/auth";
import { ActionForm } from "@/app/ui/action-form";
import { peekToken } from "@/lib/auth-tokens";
import { NewPasswordFields } from "../../new-password-fields";

export default async function ResetPage({ params }: PageProps<"/reset/[token]">) {
  const { token } = await params;
  const valid = await peekToken(token, "password_reset");
  return (
    <main className="auth-card">
      <h1>Nuova password</h1>
      {valid ? (
        <ActionForm action={resetPassword.bind(null, token)} submitLabel="Salva la password">
          <p className="muted">Account: {valid.email}</p>
          <NewPasswordFields />
        </ActionForm>
      ) : (
        <p>
          Il link non è valido o è scaduto.{" "}
          <Link href="/password-dimenticata">Chiedine uno nuovo</Link>.
        </p>
      )}
    </main>
  );
}
