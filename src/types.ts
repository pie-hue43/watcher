export const CONDITIONS = ["new_tags", "new", "very_good", "good"] as const;
export type Condition = (typeof CONDITIONS)[number];
/** standard = normale Suche, archive = Designer- & Archiv-Modus (#archive) */
export const KINDS = ["standard", "archive"] as const;
export type SearchKind = (typeof KINDS)[number];

export interface Search {
  id: number;
  query: string;
  minPrice: number | null;
  maxPrice: number | null;
  /** Mindestzustand: new_tags, new, very_good, good (null = egal) */
  condition: Condition | null;
  size: string | null;
  /** archive: der Watcher sucht reihum nach Designern und meldet nur Teile mit hohem Archive-Score */
  kind: SearchKind;
  /** Plattformen (IDs aus public/platforms.js oder "all"); leer = nur Vinted wie bisher */
  sources: string[];
  active: boolean;
  createdAt: string;
}

/** Ein Treffer, wie ihn der Watcher ans Backend meldet. */
export interface HitInput {
  vintedId: string;
  searchId: number;
  title: string;
  price: number;
  currency: string;
  size: string | null;
  brand: string | null;
  url: string;
  /** Bis zu drei Bilder des Listings (leer, wenn keine vorhanden). */
  photoUrls: string[];
  /** Geschätzter Resellpreis (Median vergleichbarer Listings), null = zu wenig Vergleiche */
  resaleEstimate: number | null;
  resaleLow: number | null;
  resaleHigh: number | null;
  resaleSamples: number | null;
  /** 0–100, wie stark das Teil nach Designer-/Archivstück aussieht */
  archiveScore: number | null;
  designer: string | null;
  /** Plattform (Standard vinted) und ID dort; vintedId bleibt aus Kompatibilität die Vinted-ID */
  source?: string;
  sourceId?: string;
  condition?: string | null;
  /** Versand zu dir in der Währung des Angebots, null = unbekannt */
  shipping?: number | null;
  location?: string | null;
  /** Ländercode des Angebots (für Einfuhrabgaben) */
  country?: string | null;
  /** SHA-1 des ersten Fotos (Dubletten über Plattformen hinweg) */
  photoHash?: string | null;
  /** Wiederverkaufswerte je Plattform aus echten Vergleichspreisen */
  resaleBy?: Record<string, { median: number; low: number; high: number; samples: number }> | null;
}

export interface Hit extends HitInput {
  id: number;
  searchQuery: string | null;
  searchKind: SearchKind | null;
  detectedAt: string;
  /** Wann der Treffer im Monitor geöffnet wurde (null = verpasst). */
  openedAt: string | null;
  /** Verkaufsstatus auf Vinted: active = noch online, sold = verkauft, gone = gelöscht */
  saleStatus: "active" | "sold" | "gone";
  /** Wann watchr den Verkauf bemerkt hat */
  soldAt: string | null;
  source: string;
  sourceId: string;
  /** Dasselbe Teil auf anderen Plattformen */
  alsoOn: { source: string; url: string; price: number; currency: string }[];
}

/** Ein Artikel im Wardrobe Tracker. */
export interface Tracked {
  id: number;
  vintedId: string;
  url: string;
  title: string;
  price: number | null;
  currency: string;
  photoUrl: string | null;
  seller: string | null;
  /** active = noch online, sold = verkauft/reserviert, gone = gelöscht oder nicht mehr auffindbar */
  status: "active" | "sold" | "gone";
  addedAt: string;
  checkedAt: string | null;
  soldAt: string | null;
}

/** Nachrichten, die das Backend per WebSocket an die Website pusht. */
export type ServerMessage =
  | { type: "hello"; hits: Hit[]; searches: Search[] }
  | { type: "hit"; hit: Hit }
  | { type: "searches"; searches: Search[] }
  | { type: "sold"; item: Tracked }
  | { type: "hitSold"; hit: Hit }
  /** Treffer hat ein "Also on" von einer anderen Plattform bekommen */
  | { type: "hitUpdate"; hit: Hit }
  | { type: "sources"; sources: unknown };

/** Eigener Verkauf (für My Charts), vom Nutzer eingetragen */
export interface Sale {
  id: number;
  title: string;
  price: number;
  buyPrice: number | null;
  country: string | null;
  soldAt: string;
  /** Verkauf kam aus Stock (Mark as sold) */
  stockId: number | null;
}

export const STOCK_STATUSES = ["bought", "arrived", "listed", "sold", "kept"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export interface StockPhoto {
  id: number;
  url: string;
  /** Ergebnis aus Studio Shot */
  studio: boolean;
}

/** Ein gekauftes Teil auf dem Weg bis zum Verkauf (Stock). Beträge in Euro. */
export interface StockItem {
  id: number;
  hitId: number | null;
  title: string;
  brand: string | null;
  size: string | null;
  category: string | null;
  condition: string | null;
  buyPrice: number;
  /** Käuferschutz + Versand */
  buyFees: number;
  boughtAt: string;
  status: StockStatus;
  arrivedAt: string | null;
  measurements: { pitToPit?: number; length?: number; sleeve?: number; waist?: number; inseam?: number };
  flaws: string;
  photos: StockPhoto[];
  listing: { title: string; description: string; hashtags: string; language: "de" | "en" } | null;
  vintedUrl: string | null;
  listedAt: string | null;
  price: number;
  pricePlan: { start: number; floor: number; stepPercent: number; everyDays: number; minProfit: number; custom?: boolean };
  priceHistory: { price: number; at: string }[];
  refreshedAt: string | null;
  floorAckAt: string | null;
  resaleLow: number | null;
  resaleHigh: number | null;
  resaleEstimate: number | null;
  soldAt: string | null;
  soldPrice: number | null;
  buyerCountry: string | null;
  shippedAt: string | null;
  saleId: number | null;
}
