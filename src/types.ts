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
}

export interface Hit extends HitInput {
  id: number;
  searchQuery: string | null;
  searchKind: SearchKind | null;
  detectedAt: string;
  /** Wann der Treffer im Monitor geöffnet wurde (null = verpasst). */
  openedAt: string | null;
}

/** Nachrichten, die das Backend per WebSocket an die Website pusht. */
export type ServerMessage =
  | { type: "hello"; hits: Hit[]; searches: Search[] }
  | { type: "hit"; hit: Hit }
  | { type: "searches"; searches: Search[] };
