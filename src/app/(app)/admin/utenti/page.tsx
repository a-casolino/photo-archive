import { changeRole, inviteUser, resendInvite, setDisabled } from "@/app/actions/users";
import { ActionForm } from "@/app/ui/action-form";
import { query } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { ROLE_LABELS, type Role } from "@/lib/roles";

type UserRow = {
  id: number;
  email: string;
  name: string;
  role: Role;
  activated: 0 | 1;
  disabled_at: Date | null;
  last_login_at: Date | null;
};

const fmt = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" });

export default async function UsersPage() {
  await requireOwner();
  const users = await query<UserRow>(
    `SELECT id, email, name, role, password_hash IS NOT NULL AS activated, disabled_at, last_login_at
       FROM users ORDER BY role = 'owner' DESC, name`,
  );

  return (
    <>
      <h1>Utenti</h1>

      <section className="card" style={{ maxWidth: 420 }}>
        <h2>Invita una persona</h2>
        <ActionForm action={inviteUser} submitLabel="Invia invito">
          <label>
            Nome
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Ruolo
            <select name="role" defaultValue="viewer">
              <option value="viewer">{ROLE_LABELS.viewer}: vede e scarica al massimo il JPEG</option>
              <option value="trusted">{ROLE_LABELS.trusted}: può scaricare i CR2 se la condivisione lo permette</option>
            </select>
          </label>
        </ActionForm>
      </section>

      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Email</th>
              <th>Ruolo</th>
              <th>Stato</th>
              <th>Ultimo accesso</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  {u.role === "owner" ? (
                    ROLE_LABELS.owner
                  ) : (
                    <form action={changeRole} className="inline">
                      <input type="hidden" name="userId" value={u.id} />
                      <select name="role" defaultValue={u.role}>
                        <option value="viewer">{ROLE_LABELS.viewer}</option>
                        <option value="trusted">{ROLE_LABELS.trusted}</option>
                      </select>
                      <button type="submit">Salva</button>
                    </form>
                  )}
                </td>
                <td>{u.disabled_at ? "Disattivato" : u.activated ? "Attivo" : "Invito in attesa"}</td>
                <td>{u.last_login_at ? fmt.format(u.last_login_at) : "—"}</td>
                <td>
                  {u.role !== "owner" && (
                    <span className="inline">
                      {!u.activated && !u.disabled_at && (
                        <form action={resendInvite}>
                          <input type="hidden" name="userId" value={u.id} />
                          <button type="submit" className="link">
                            Reinvia invito
                          </button>
                        </form>
                      )}
                      <form action={setDisabled}>
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="disable" value={u.disabled_at ? "0" : "1"} />
                        <button type="submit" className="link">
                          {u.disabled_at ? "Riattiva" : "Disattiva"}
                        </button>
                      </form>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
