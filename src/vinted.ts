import type { Condition, Search } from "./types.ts";
import { missingKeywords } from "./tags.ts";

/** Vinted-Zustands-IDs: 6 = neu mit Etikett, 1 = neu ohne Etikett, 2 = sehr gut, 3 = gut. */
const STATUS_IDS: Record<Condition, number[]> = {
  new_tags: [6],
  new: [6, 1],
  very_good: [6, 1, 2],
  good: [6, 1, 2, 3],
};

/** Ein Listing, so wie der Watcher es aus der Datenquelle liest. */
export interface Listing {
  id: string;
  title: string;
  price: number;
  currency: string;
  size: string | null;
  brand: string | null;
  url: string;
  photoUrls: string[];
  /** Zustand laut Vinted, falls die Suche ihn mitliefert */
  condition?: Condition | "satisfactory" | null;
}

export interface Source {
  search(s: Search): Promise<Listing[]>;
  /** Optional: weitere Bilder eines Listings nachladen (nur für neue Treffer). */
  photos?(l: Listing): Promise<string[]>;
  /** Optional: Preise vergleichbarer Listings für die Resell-Schätzung. */
  comparables?(query: string): Promise<number[]>;
}

export class RateLimitError extends Error {}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/**
 * Liest die öffentliche Katalogsuche von Vinted (dieselbe, die die Website nutzt).
 * Vinted verlangt dafür ein Session-Cookie, das wir uns von der Startseite holen.
 */
export class VintedSource implements Source {
  private cookie: string | null = null;
  private cookieFetchedAt = 0;

  constructor(private domain: string) {}

  private async refreshCookie() {
    const res = await fetch(`https://${this.domain}/`, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "de-DE,de;q=0.9" },
      redirect: "follow",
    });
    const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
    if (!cookies.length) throw new Error(`Kein Session-Cookie von ${this.domain} erhalten (HTTP ${res.status})`);
    this.cookie = cookies.join("; ");
    this.cookieFetchedAt = Date.now();
  }

  /** Die Suche liefert meist nur ein Bild. Für neue Treffer holen wir die Detailseite mit allen Bildern. */
  async photos(l: Listing): Promise<string[]> {
    if (!this.cookie) await this.refreshCookie();
    const res = await fetch(`https://${this.domain}/api/v2/items/${l.id}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", Cookie: this.cookie! },
    });
    if (res.status === 429 || res.status === 403) throw new RateLimitError(`Vinted bremst (HTTP ${res.status})`);
    if (!res.ok) return l.photoUrls;
    const data: any = await res.json();
    const more = photoList(data.item ?? data);
    return [...new Set([...l.photoUrls, ...more])].slice(0, 3);
  }

  /** Preise der relevantesten Listings zu einer Suche (z. B. „ralph lauren polo“). */
  async comparables(query: string): Promise<number[]> {
    if (!this.cookie || Date.now() - this.cookieFetchedAt > 3600_000) await this.refreshCookie();
    const params = new URLSearchParams({ search_text: query, order: "relevance", per_page: "60", page: "1" });
    const res = await fetch(`https://${this.domain}/api/v2/catalog/items?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", Cookie: this.cookie! },
    });
    if (res.status === 429 || res.status === 403) throw new RateLimitError(`Vinted bremst (HTTP ${res.status})`);
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data.items ?? []).map((it: any) => toListing(it).price).filter((p: number) => Number.isFinite(p) && p > 0);
  }

  async search(s: Search): Promise<Listing[]> {
    // Cookie spätestens nach einer Stunde erneuern
    if (!this.cookie || Date.now() - this.cookieFetchedAt > 3600_000) await this.refreshCookie();

    const params = new URLSearchParams({
      search_text: s.query,
      order: "newest_first",
      per_page: "30",
      page: "1",
    });
    if (s.minPrice) params.set("price_from", String(s.minPrice));
    if (s.maxPrice) params.set("price_to", String(s.maxPrice));
    for (const id of s.condition ? STATUS_IDS[s.condition] : []) params.append("status_ids[]", String(id));

    const res = await fetch(`https://${this.domain}/api/v2/catalog/items?${params}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Accept-Language": "de-DE,de;q=0.9",
        Cookie: this.cookie!,
      },
    });
    if (res.status === 401) {
      this.cookie = null; // Cookie abgelaufen, beim nächsten Mal neu holen
      throw new Error("Session abgelaufen (401)");
    }
    if (res.status === 429 || res.status === 403) throw new RateLimitError(`Vinted bremst (HTTP ${res.status})`);
    if (!res.ok) throw new Error(`Vinted antwortet mit HTTP ${res.status}`);

    const data: any = await res.json();
    return (data.items ?? []).map(toListing);
  }
}

function photoList(it: any): string[] {
  const all = [...(Array.isArray(it.photos) ? it.photos : []), ...(it.photo ? [it.photo] : [])];
  const urls = all.map((p: any) => p?.url || p?.full_size_url).filter((u: unknown): u is string => typeof u === "string");
  return [...new Set(urls)].slice(0, 3);
}

function toListing(it: any): Listing {
  // Vinted liefert den Preis je nach Version als String oder als {amount, currency_code}
  const price = typeof it.price === "object" && it.price ? Number(it.price.amount) : Number(it.price);
  const currency = (typeof it.price === "object" && it.price?.currency_code) || it.currency || "EUR";
  return {
    id: String(it.id),
    title: String(it.title ?? ""),
    price,
    currency,
    size: it.size_title || null,
    brand: it.brand_title || null,
    url: it.url || `https://www.vinted.de/items/${it.id}`,
    photoUrls: photoList(it),
    condition: parseCondition(it.status),
  };
}

/** Vinted liefert den Zustand als Text in der Sprache der Domain. */
function parseCondition(status: unknown): Listing["condition"] {
  if (typeof status !== "string") return null;
  const t = status.toLowerCase();
  if (/etikett|with tags|avec étiquette/.test(t) && !/ohne|without|sans/.test(t)) return "new_tags";
  if (/neu|new|neuf/.test(t)) return "new";
  if (/sehr gut|very good|très bon/.test(t)) return "very_good";
  if (/gut|good|bon/.test(t)) return "good";
  if (/zufrieden|satisf/.test(t)) return "satisfactory";
  return null;
}

const CONDITION_RANK = { new_tags: 4, new: 3, very_good: 2, good: 1, satisfactory: 0 } as const;

/** Testdaten ohne Vinted: erzeugt bei jedem Durchlauf ab und zu ein neues Listing. */
export class MockSource implements Source {
  private counter = Date.now();
  async search(s: Search): Promise<Listing[]> {
    const sizes = ["40", "41", "42", "43", "44", "S", "M", "L"];
    const out: Listing[] = [];
    const n = Math.random() < 0.6 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const id = String(++this.counter);
      const cap = s.maxPrice ?? 150;
      out.push({
        id,
        title: `${s.query} ${MOCK_EXTRAS[Math.floor(Math.random() * MOCK_EXTRAS.length)]} (Test ${id.slice(-4)})`,
        price: Math.round(cap * (0.5 + Math.random() * 0.6)),
        currency: "EUR",
        size: s.size && Math.random() < 0.7 ? s.size : sizes[Math.floor(Math.random() * sizes.length)],
        brand: s.query.split(" ")[0],
        url: `https://www.vinted.de/items/${id}`,
        photoUrls: [],
        condition: (["new_tags", "new", "very_good", "good"] as const)[Math.floor(Math.random() * 4)],
      });
    }
    return out;
  }

  async comparables(query: string): Promise<number[]> {
    // stabile Fantasiepreise je Suchbegriff, damit gleiche Produkte gleich bewertet werden
    const base = 40 + ([...query].reduce((a, c) => a + c.charCodeAt(0), 0) % 160);
    return Array.from({ length: 24 }, () => Math.round(base * (0.6 + Math.random() * 0.8)));
  }
}

const MOCK_EXTRAS = ["", "vintage", "archive FW03", "90s", "made in Italy", "jacket", "hoodie"];

/**
 * Prüft, ob ein Listing zu allen Hashtags des Suchauftrags passt:
 * jedes Stichwort, Preisspanne, Größe und Mindestzustand.
 * `keywords` ist im Archive-Modus die Eingabe ohne den automatisch ergänzten Designer.
 */
export function matches(s: Search, l: Listing, keywords: string = s.query): boolean {
  if (!Number.isFinite(l.price)) return false;
  if (missingKeywords(keywords, l).length) return false;
  if (s.condition && l.condition && CONDITION_RANK[l.condition] < CONDITION_RANK[s.condition]) return false;
  if (s.minPrice != null && l.price < s.minPrice) return false;
  if (s.maxPrice != null && l.price > s.maxPrice) return false;
  if (s.size) {
    if (!l.size) return false;
    const want = normSize(s.size);
    // "M / 38 / 10" oder "EU 43" in einzelne Größenangaben zerlegen
    const tokens = l.size.split(/[\s/|]+/).map(normSize).filter(Boolean);
    if (!tokens.includes(want) && normSize(l.size) !== want) return false;
  }
  return true;
}

const normSize = (s: string) => s.trim().toLowerCase().replace(",", ".").replace(/^eu\s*/, "");
