import { readFileSync } from "node:fs";
import vm from "node:vm";
import type { Condition, Search } from "../types.ts";

/**
 * Gemeinsame Plattform-Liste (public/platforms.js): Namen, Länder, Hashtags, Such-Links und Standard-Gebühren.
 * Seite und Backend nutzen dieselbe Datei, damit Links und Rechnungen überall gleich sind.
 */
const ctx: any = { window: {} };
vm.runInNewContext(readFileSync(new URL("../../public/platforms.js", import.meta.url), "utf8"), ctx);

export type Mode = "api" | "alert" | "link";
export interface PlatformInfo {
  id: string;
  name: string;
  country: string;
  eu: boolean;
  currency: string;
  mode: Mode;
  fallbackMode?: Mode;
  tags: string[];
  filters: string[];
  env?: string[];
  senders?: string[];
}
export interface FeeSide {
  buy: { fixed: number; rate: number; shipping: number; currency: string; set: boolean };
  sell: { rate: number; paymentRate: number; paymentFixed: number; fixedCurrency: string; set: boolean };
  priceFactor: number | null;
}
export interface Fees {
  updatedAt: string;
  importVatRate: number;
  dutyRate: number;
  dutyFreeUpToEur: number;
  platforms: Record<string, FeeSide>;
}
export interface Fx {
  base: "EUR";
  date: string;
  rates: Record<string, number>;
  fallback?: boolean;
}

export const catalog = ctx.window.watchrPlatforms as {
  PLATFORMS: PlatformInfo[];
  IDS: string[];
  byId(id: string): PlatformInfo | null;
  byTag(word: string): string | null;
  expand(list: string[] | null | undefined): string[];
  searchLink(id: string, pref: SearchPref, fx?: Fx | null): { url: string; note: string } | null;
  buildSearchUrl(id: string, pref: SearchPref, fx?: Fx | null): string | null;
  toEur(amount: number | null, currency: string, fx?: Fx | null): number | null;
  FALLBACK_FX: Fx;
  DEFAULT_FEES: Fees;
  mergeFees(saved: unknown): Fees;
  feesSet(fees: Fees, id: string): boolean;
};

export type SearchPref = Pick<Search, "query"> & Partial<Pick<Search, "minPrice" | "maxPrice" | "size" | "condition">>;

/** Gemeinsames Treffer-Schema aller Quellen (Preise in der Währung der Plattform). */
export interface SourceHit {
  source: string;
  sourceId: string;
  url: string;
  title: string;
  brand: string | null;
  size: string | null;
  condition: Condition | "satisfactory" | null;
  price: number;
  currency: string;
  /** Versand zu dir in derselben Währung, null = unbekannt (dann gilt der Standardwert aus fees.json) */
  shipping: number | null;
  /** z. B. "10115 Berlin" oder "US" */
  location: string | null;
  /** Ländercode (ISO 2), falls bekannt, für die Einfuhrabgaben */
  country?: string | null;
  photoUrls: string[];
  detectedAt: string;
}

/** Eine Plattform mit einheitlicher Schnittstelle (src/sources/<id>.ts). */
export interface Adapter extends PlatformInfo {
  /** tatsächlicher Modus: "api" nur mit Schlüssel in .env, sonst fallbackMode */
  mode: Mode;
  buildSearchUrl(pref: SearchPref, fx?: Fx | null): string;
  /** nur mode "api" */
  search?(pref: SearchPref): Promise<SourceHit[]>;
  /** nur mode "api": Preise vergleichbarer Angebote für die Resale-Schätzung (in Euro) */
  comparables?(query: string): Promise<number[]>;
  /** nur mode "alert" */
  parseAlertEmail?(mail: Mail): SourceHit[];
  readonly fees: FeeSide;
}

export interface Mail {
  from: string;
  subject: string;
  date: string | null;
  html: string;
  text: string;
}

const EU = new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" "));
export const isEuCountry = (code: string | null | undefined) => (code ? EU.has(code.toUpperCase()) : null);

/** Gebühren kommen aus fees.json (src/fees.ts setzt sie beim Start); bis dahin die Standardwerte. */
let currentFees: Fees = catalog.mergeFees(null);
export const setFees = (f: Fees) => void (currentFees = f);
export const getFees = () => currentFees;

/** Grundgerüst eines Adapters aus der Plattform-Liste. */
export function baseAdapter(id: string, mode?: Mode) {
  const p = catalog.byId(id);
  if (!p) throw new Error(`Unknown platform ${id}`);
  return {
    ...p,
    mode: mode ?? p.mode,
    buildSearchUrl: (pref: SearchPref, fx?: Fx | null) => catalog.buildSearchUrl(id, pref, fx)!,
    get fees() {
      return currentFees.platforms[id];
    },
  };
}
