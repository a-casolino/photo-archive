export function NewPasswordFields() {
  return (
    <>
      <label>
        Nuova password (almeno 10 caratteri)
        <input name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus />
      </label>
      <label>
        Ripeti la password
        <input name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </label>
    </>
  );
}
