import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

/*
 * Invio email via SMTP generico: il provider non è ancora scelto, basta
 * impostare le variabili SMTP_* nel .env. Senza SMTP_HOST le email vengono
 * scritte nel log del server (comodo in sviluppo).
 */
let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter === undefined) {
    const e = env();
    transporter = e.SMTP_HOST
      ? nodemailer.createTransport({
          host: e.SMTP_HOST,
          port: e.SMTP_PORT,
          secure: e.SMTP_SECURE,
          auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
        })
      : null;
  }
  return transporter;
}

export async function sendMail(msg: { to: string; subject: string; text: string }) {
  const t = getTransporter();
  if (!t) {
    console.info(`[mail] SMTP non configurato, email non inviata:\nA: ${msg.to}\nOggetto: ${msg.subject}\n\n${msg.text}\n`);
    return;
  }
  await t.sendMail({ from: env().MAIL_FROM, ...msg });
}

export function appUrl(path: string): string {
  return new URL(path, env().APP_URL).toString();
}

export async function sendInviteEmail(to: string, name: string, token: string) {
  await sendMail({
    to,
    subject: "Invito all'archivio foto",
    text:
      `Ciao ${name},\n\n` +
      `sei stato invitato all'archivio foto di Antonio.\n` +
      `Scegli la tua password da questo link (valido 7 giorni):\n\n` +
      `${appUrl(`/invito/${token}`)}\n`,
  });
}

export async function sendPasswordResetEmail(to: string, name: string, token: string) {
  await sendMail({
    to,
    subject: "Reimposta la password dell'archivio foto",
    text:
      `Ciao ${name},\n\n` +
      `per scegliere una nuova password apri questo link (valido 1 ora):\n\n` +
      `${appUrl(`/reset/${token}`)}\n\n` +
      `Se non sei stato tu, ignora questa email.\n`,
  });
}
