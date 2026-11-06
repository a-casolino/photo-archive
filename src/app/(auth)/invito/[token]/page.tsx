import { acceptInvite } from "@/app/actions/auth";
import { ActionForm } from "@/app/ui/action-form";
import { peekToken } from "@/lib/auth-tokens";
import { NewPasswordFields } from "../../new-password-fields";

export default async function InvitePage({ params }: PageProps<"/invito/[token]">) {
  const { token } = await params;
  const invite = await peekToken(token, "invite");
  return (
    <main className="auth-card">
      <h1>Benvenuto</h1>
      {invite ? (
        <ActionForm action={acceptInvite.bind(null, token)} submitLabel="Entra nell'archivio">
          <p className="muted">
            Ciao {invite.name}, scegli la password per {invite.email}.
          </p>
          <NewPasswordFields />
        </ActionForm>
      ) : (
        <p>L&apos;invito non è valido o è scaduto. Chiedi ad Antonio di mandartene uno nuovo.</p>
      )}
    </main>
  );
}
