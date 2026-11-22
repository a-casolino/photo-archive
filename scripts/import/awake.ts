import { spawn, type ChildProcess } from "node:child_process";

/*
 * Tiene sveglio il computer finché l'import lavora (richiesta di Antonio del
 * 2026-11-22: il Mac in sospensione interrompeva il caricamento).
 *
 * - Mac: `caffeinate -i -s -w <pid>` (strumento di sistema). -i impedisce la
 *   sospensione per inattività, -s anche quella di sistema con l'alimentatore
 *   collegato; con -w si chiude da solo quando il programma finisce, anche se
 *   viene chiuso di colpo. Lo schermo può spegnersi lo stesso.
 * - Windows: PowerShell chiama SetThreadExecutionState (ES_CONTINUOUS |
 *   ES_SYSTEM_REQUIRED) e resta in attesa finché il programma è vivo.
 * - Altrove (la VPS con `npm run drive`) non fa niente.
 *
 * Chiudere il coperchio del portatile lo manda comunque a dormire (a meno di
 * alimentatore e schermo esterno): lo dice il messaggio all'avvio.
 */
export type Awake = { stop: () => void; how: string | null };

export function keepAwake(): Awake {
  let child: ChildProcess | null = null;
  let how: string | null = null;
  try {
    if (process.platform === "darwin") {
      child = spawn("caffeinate", ["-i", "-s", "-w", String(process.pid)], { stdio: "ignore" });
      how = "caffeinate";
    } else if (process.platform === "win32") {
      const script = [
        "$s = Add-Type -PassThru -Name S -Namespace W -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);'",
        "[void]$s::SetThreadExecutionState([uint32]2147483649)",
        `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue`,
      ].join("; ");
      child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        stdio: "ignore",
        windowsHide: true,
      });
      how = "Windows";
    }
  } catch {
    child = null;
    how = null;
  }
  // Se lo strumento manca, l'import va avanti lo stesso.
  child?.on("error", () => {
    child = null;
  });
  child?.unref();
  return {
    how: child ? how : null,
    stop: () => {
      child?.kill();
      child = null;
    },
  };
}
