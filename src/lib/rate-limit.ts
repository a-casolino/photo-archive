/**
 * Limite tentativi in memoria: l'app gira come singolo processo Node sulla VPS.
 * Basta a frenare chi prova a indovinare una password; con più processi
 * andrebbe spostato su MySQL.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

/** Registra un tentativo; restituisce false se il limite è superato. */
export function hit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= max;
}

export function clear(key: string): void {
  buckets.delete(key);
}
