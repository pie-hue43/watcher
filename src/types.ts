export const CONDITIONS = ["new_tags", "new", "very_good", "good"] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface Search {
  id: number;
  query: string;
  minPrice: number | null;
  maxPrice: number | null;
  /** Mindestzustand: new_tags, new, very_good, good (null = egal) */
  condition: Condition | null;
  size: string | null;
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
}

export interface Hit extends HitInput {
  id: number;
  searchQuery: string | null;
  detectedAt: string;
}

/** Nachrichten, die das Backend per WebSocket an die Website pusht. */
export type ServerMessage =
  | { type: "hello"; hits: Hit[]; searches: Search[] }
  | { type: "hit"; hit: Hit }
  | { type: "searches"; searches: Search[] };
