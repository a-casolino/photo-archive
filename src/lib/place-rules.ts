/*
 * Nome del luogo dalle coordinate GPS, senza servizi esterni.
 *
 * Usa l'elenco delle località di GeoNames (cities500: ogni località con
 * almeno 500 abitanti, più i capoluoghi), con i nomi italiani per le località
 * e le regioni d'Italia. Il programma `npm run luoghi` scarica i file una volta,
 * li riduce a un file compatto (latitudine, longitudine, nome) e poi cerca la
 * località più vicina a ogni foto con il GPS. Le coordinate non escono dalla VPS.
 *
 * Qui solo la logica pura (lettura dei file e ricerca), testata in
 * tests/place-rules.test.ts.
 */

export interface Place {
  lat: number;
  lon: number;
  label: string;
}

/** Oltre questa distanza dalla località più vicina non diamo un nome. */
export const MAX_PLACE_KM = 50;

/** Località che non sono un paese o una città: quartieri, rovine, luoghi storici. */
const SKIP_FEATURES = new Set(["PPLX", "PPLH", "PPLQ", "PPLW", "PPLCH"]);

/**
 * admin1CodesASCII.txt di GeoNames: `IT.09<TAB>Lombardy<TAB>Lombardy<TAB>3174618`.
 * Restituisce codice → { nome, id GeoNames } (l'id serve per il nome italiano).
 */
export function parseAdmin1(text: string): Map<string, { name: string; geonameId: string }> {
  const out = new Map<string, { name: string; geonameId: string }>();
  for (const line of text.split("\n")) {
    const [code, name, , id] = line.split("\t");
    if (code && name && id) out.set(code, { name, geonameId: id.trim() });
  }
  return out;
}

/**
 * File dei nomi alternativi di GeoNames (alternatenames/IT.txt):
 * id, geonameid, lingua, nome, preferito, corto, colloquiale, storico, da, a.
 * Restituisce geonameid → nome italiano: il preferito se c'è, altrimenti il
 * primo nome italiano che non sia colloquiale o storico.
 */
export function parseItalianNames(text: string): Map<string, string> {
  const preferred = new Map<string, string>();
  const first = new Map<string, string>();
  for (const line of text.split("\n")) {
    const f = line.split("\t");
    if (f[2] !== "it" || !f[1] || !f[3]) continue;
    if (f[6] === "1" || f[7] === "1") continue;
    if (f[4] === "1") {
      if (!preferred.has(f[1])) preferred.set(f[1], f[3]);
    } else if (!first.has(f[1])) {
      first.set(f[1], f[3]);
    }
  }
  for (const [id, name] of preferred) first.set(id, name);
  return first;
}

let countryNames: Intl.DisplayNames | null = null;

/** Nome del paese in italiano dal codice ISO ("IT" → "Italia"). */
export function countryName(code: string): string {
  if (!code) return "";
  countryNames ??= new Intl.DisplayNames(["it"], { type: "region" });
  try {
    return countryNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** "Positano, Campania, Italia", senza ripetere parti uguali ("Roma, Lazio, Italia"; "Monaco, Monaco" → "Monaco"). */
export function placeLabel(name: string, region: string, country: string): string {
  const parts: string[] = [];
  for (const p of [name, region, country]) {
    const v = p.trim();
    if (v && !parts.some((x) => x.toLocaleLowerCase("it") === v.toLocaleLowerCase("it"))) parts.push(v);
  }
  return parts.join(", ");
}

/**
 * cities500.txt di GeoNames (19 colonne separate da TAB): id, nome, nome ASCII,
 * nomi alternativi, latitudine, longitudine, classe, codice, paese, …, regione (admin1), …
 */
export function parseCities(
  text: string,
  admin1: Map<string, { name: string; geonameId: string }>,
  italianNames: Map<string, string>,
): Place[] {
  const places: Place[] = [];
  for (const line of text.split("\n")) {
    const f = line.split("\t");
    if (f.length < 11) continue;
    const [id, name] = f;
    const lat = Number(f[4]);
    const lon = Number(f[5]);
    const feature = f[7];
    const cc = f[8];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || SKIP_FEATURES.has(feature)) continue;
    const region = admin1.get(`${cc}.${f[10]}`);
    const regionName = region ? (italianNames.get(region.geonameId) ?? region.name) : "";
    const label = placeLabel(italianNames.get(id) ?? name, regionName, countryName(cc));
    if (label) places.push({ lat, lon, label });
  }
  return places;
}

/** File compatto: una riga per località, `lat<TAB>lon<TAB>nome`. */
export function serializePlaces(places: Place[]): string {
  return places.map((p) => `${p.lat}\t${p.lon}\t${p.label.replace(/[\t\n]/g, " ")}`).join("\n") + "\n";
}

export function parsePlaces(text: string): Place[] {
  const out: Place[] = [];
  for (const line of text.split("\n")) {
    const [a, b, label] = line.split("\t");
    const lat = Number(a);
    const lon = Number(b);
    if (label && Number.isFinite(lat) && Number.isFinite(lon)) out.push({ lat, lon, label });
  }
  return out;
}

const EARTH_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Indice a celle di 1° × 1° per trovare in fretta la località più vicina. */
export class PlaceIndex {
  private cells = new Map<number, Place[]>();

  constructor(places: Place[]) {
    for (const p of places) {
      const k = PlaceIndex.key(Math.floor(p.lat), Math.floor(p.lon));
      const cell = this.cells.get(k);
      if (cell) cell.push(p);
      else this.cells.set(k, [p]);
    }
  }

  private static key(latCell: number, lonCell: number): number {
    // Longitudine riportata in [-180, 179] per gestire l'antimeridiano.
    const lon = ((((lonCell + 180) % 360) + 360) % 360) - 180;
    return (latCell + 90) * 360 + (lon + 180);
  }

  get size(): number {
    let n = 0;
    for (const c of this.cells.values()) n += c.length;
    return n;
  }

  /** La località più vicina entro `maxKm`, o null. */
  nearest(lat: number, lon: number, maxKm = MAX_PLACE_KM): (Place & { km: number }) | null {
    const latCell = Math.floor(lat);
    const lonCell = Math.floor(lon);
    // Quante celle guardare: in latitudine 1° ≈ 111 km, in longitudine meno verso i poli.
    const dLat = Math.ceil(maxKm / 111);
    const cos = Math.max(Math.cos(rad(Math.min(Math.abs(lat) + dLat, 89))), 0.05);
    const dLon = Math.min(Math.ceil(maxKm / (111 * cos)), 180);
    let best: (Place & { km: number }) | null = null;
    for (let i = latCell - dLat; i <= latCell + dLat; i++) {
      if (i < -90 || i > 89) continue;
      for (let j = lonCell - dLon; j <= lonCell + dLon; j++) {
        const cell = this.cells.get(PlaceIndex.key(i, j));
        if (!cell) continue;
        for (const p of cell) {
          const km = distanceKm(lat, lon, p.lat, p.lon);
          if (km <= maxKm && (!best || km < best.km)) best = { ...p, km };
        }
      }
    }
    return best;
  }
}
