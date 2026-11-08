import Link from "next/link";
import { redirect } from "next/navigation";
import { login } from "@/app/actions/auth";
import { ActionForm } from "@/app/ui/action-form";
import { getCurrentUser } from "@/lib/session";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await searchParams;
  return (
    <main className="auth-card">
      <h1>Antonio Casolino | Photo Archive</h1>
      <ActionForm action={login} submitLabel="Accedi">
        <input type="hidden" name="next" value={typeof next === "string" ? next : ""} />
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required autoFocus />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
      </ActionForm>
      <p className="muted">
        <Link href="/password-dimenticata">Password dimenticata?</Link>
      </p>
    </main>
  );
}
