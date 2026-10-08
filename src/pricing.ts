import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { findDesigner } from "./designers.ts";

/** Grobe Artikelart aus dem Titel, damit gleiche Produkte zusammengefasst werden. */
const TYPES: [RegExp, string][] = [
  [/\bpolo/i, "polo"],
  [/\bhoodie|kapuzen/i, "hoodie"],
  [/\bt-?shirt|\btee\b/i, "t-shirt"],
  [/\bhemd|\bshirt\b|\bbutton/i, "shirt"],
  [/\bpullover|\bsweater|\bjumper|\bstrick|\bknit|\bsweatshirt|\bcrewneck/i, "sweater"],
  [/\bjacke|\bjacket|\bblouson|\bbomber|\bparka|\bweste|\bvest|\bpuffer/i, "jacket"],
  [/\bmantel|\bcoat|\btrench/i, "coat"],
  [/\bjeans|\bdenim/i, "jeans"],
  [/\bhose|\bpants|\btrousers|\bcargo/i, "pants"],
  [/\bshorts/i, "shorts"],
  [/\bkleid|\bdress/i, "dress"],
  [/\brock\b|\bskirt/i, "skirt"],
  [/\bstiefel|\bboots?\b/i, "boots"],
  [/\bsneaker|\bschuhe|\bshoes|\btrainers|\bderby|\bloafer/i, "shoes"],
  [/\btasche|\bbag\b|\bhandbag|\bbackpack|\brucksack/i, "bag"],
  [/\bgürtel|\bbelt/i, "belt"],
  [/\bcap\b|\bmütze|\bhat\b|\bbeanie/i, "headwear"],
  [/\bring\b|\bkette|\bnecklace|\bbracelet|\barmband/i, "jewelry"],
  [/\bschal|\bscarf/i, "scarf"],
  [/\bportemonnaie|\bwallet|\bgeldbörse/i, "wallet"],
];

const TYPE_QUERY: Record<string, string> = { "t-shirt": "t-shirt", sweater: "pullover", jacket: "jacke", coat: "mantel", pants: "hose", shoes: "schuhe", bag: "tasche", headwear: "cap" };

export interface PriceRef {
  key: string;
  query: string;
  median: number;
  low: number;
  high: number;
  samples: number;
  updatedAt: string;
}

/** Produktschlüssel aus Marke und Artikelart, z. B. „ralph lauren|polo“. */
export function productKey(l: { title: string; brand: string | null }): { key: string; query: string } | null {
  const brand = (l.brand && l.brand.trim()) || findDesigner(l.title)?.name;
  if (!brand) return null;
  const type = TYPES.find(([re]) => re.test(l.title))?.[1] ?? null;
  const b = brand.toLowerCase();
  return { key: `${b}|${type ?? "item"}`, query: type ? `${b} ${TYPE_QUERY[type] ?? type}` : b };
}

/** Median mit abgeschnittenen Ausreißern (oberste und unterste 15 %). */
export function robustStats(prices: number[]): { median: number; low: number; high: number } | null {
  const p = prices.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (p.length < 5) return null;
  const cut = Math.floor(p.length * 0.15);
  const t = p.slice(cut, p.length - cut);
  // Quantil mit linearer Interpolation, gerundet auf ganze Euro
  const q = (f: number) => {
    const i = f * (t.length - 1);
    const lo = Math.floor(i);
    return Math.round(t[lo] + (t[Math.min(t.length - 1, lo + 1)] - t[lo]) * (i - lo));
  };
  return { median: q(0.5), low: q(0.25), high: q(0.75) };
}

/**
 * Schätzt den Resellpreis aus vergleichbaren Listings (gleiche Marke, gleiche Artikelart)
 * auf Vinted. Ergebnisse werden pro Produkt 24 h gespeichert, damit häufige Teile wie
 * Ralph-Lauren-Polos immer mit demselben Wert gerechnet werden und nicht jedes Mal neu
 * gefragt wird.
 */
export class PriceEstimator {
  private refs = new Map<string, PriceRef>();

  constructor(
    private comparables: (query: string) => Promise<number[]>,
    private cacheFile: string | null = null,
    private maxAgeMs = 24 * 3600_000,
  ) {
    if (cacheFile) {
      try {
        for (const r of JSON.parse(readFileSync(cacheFile, "utf8")) as PriceRef[]) this.refs.set(r.key, r);
      } catch {
        // noch kein Cache vorhanden
      }
    }
  }

  private save() {
    if (!this.cacheFile) return;
    mkdirSync(dirname(this.cacheFile), { recursive: true });
    writeFileSync(this.cacheFile, JSON.stringify([...this.refs.values()], null, 1));
  }

  /** Liefert die gespeicherte oder frisch berechnete Referenz, oder null, wenn zu wenig Vergleiche da sind. */
  async estimate(l: { title: string; brand: string | null }): Promise<PriceRef | null> {
    const pk = productKey(l);
    if (!pk) return null;
    const cached = this.refs.get(pk.key);
    if (cached && Date.now() - Date.parse(cached.updatedAt) < this.maxAgeMs) return cached;
    const prices = await this.comparables(pk.query);
    const stats = robustStats(prices);
    if (!stats) return cached ?? null;
    const ref: PriceRef = { key: pk.key, query: pk.query, ...stats, samples: prices.length, updatedAt: new Date().toISOString() };
    this.refs.set(pk.key, ref);
    this.save();
    return ref;
  }
}
