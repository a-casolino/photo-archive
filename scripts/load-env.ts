// Carica .env.local e .env (come fa Next.js) per gli script da riga di comando.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // file assente: va bene
  }
}
