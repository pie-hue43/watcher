import type { Condition, Search } from "../types.ts";
import { baseAdapter, type Adapter, type SearchPref, type SourceHit } from "./catalog.ts";
import { missingKeywords } from "../tags.ts";

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
  /** Optional (AI Tools): Detailseite eines Artikels, null = gelöscht/nicht gefunden. */
  item?(id: string): Promise<ItemDetail | null>;
  /** Optional (AI Tools): Profil und Kleiderschrank eines Verkäufers. */
  wardrobe?(userId: string): Promise<Wardrobe | null>;
}

export interface ItemDetail extends Listing {
  description: string;
  /** verkauft, reserviert oder ausgeblendet */
  sold: boolean;
  seller: { id: string; login: string } | null;
  allPhotoUrls: string[];
}

export interface Wardrobe {
  user: { id: string; login: string; itemCount: number; rating: number | null; reviews: number; followers: number; city: string | null };
  items: (Listing & { sold: boolean; favourites: number })[];
}

/** Artikel-ID aus einer Vinted-Adresse, z. B. https://www.vinted.de/items/1234567-raf-simons-jacke */
export const itemIdFromUrl = (u: string) => u.match(/\/items\/(\d+)/)?.[1] ?? (/^\d+$/.test(u.trim()) ? u.trim() : null);
/** Nutzer-ID aus einer Profiladresse, z. B. https://www.vinted.de/member/123456-name */
export const userIdFromUrl = (u: string) => u.match(/\/member\/(?:general\/)?(\d+)/)?.[1] ?? null;

export class RateLimitError extends Error {}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/**
 * Liest die öffentliche Katalogsuche von Vinted (dieselbe, die die Website nutzt).
 * Seit September 2026 liegt sie auf api.<domain>/svc-catalogue/items (die alte Adresse
 * /api/v2/catalog/items liefert 404). Dafür braucht es das anonyme Session-Cookie
 * access_token_web und die Kennung aus dem Header X-Anon-Id, beides von der Startseite.
 */
export class VintedSource implements Source {
  private cookie: string | null = null;
  private anonId: string | null = null;
  private cookieFetchedAt = 0;
  private refreshBlockedUntil = 0;

  constructor(private domain: string) {}

  private get site() {
    return `https://${this.domain.startsWith("www.") ? this.domain : "www." + this.domain}`;
  }
  private get api() {
    return `https://api.${this.domain.replace(/^www\./, "")}`;
  }

  private async refreshCookie() {
    // Nach einer Sperre nicht sofort wieder anfragen, sonst bleibt Vinted dicht
    if (Date.now() < this.refreshBlockedUntil) throw new RateLimitError("Vinted blockiert gerade, neue Session erst in ein paar Minuten");
    const res = await fetch(`${this.site}/`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
      },
      redirect: "follow",
    });
    // Vinted schickt erst ein Lösch-Cookie und danach das echte, deshalb gewinnt der letzte nicht leere Wert
    const jar = new Map<string, string>();
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i < 1) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (value) jar.set(name, value);
    }
    await res.body?.cancel().catch(() => {});
    if (!jar.has("access_token_web") && (res.status === 403 || res.status === 429)) {
      this.refreshBlockedUntil = Date.now() + 5 * 60_000;
      throw new RateLimitError(`Vinted blockiert gerade (HTTP ${res.status})`);
    }
    if (!jar.has("access_token_web")) throw new Error(`Kein Session-Cookie von ${this.domain} erhalten (HTTP ${res.status})`);
    this.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    this.anonId = res.headers.get("x-anon-id")?.trim() || null;
    this.cookieFetchedAt = Date.now();
  }

  private apiHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
      Origin: this.site,
      Referer: `${this.site}/`,
      Locale: "de-DE",
      Platform: "web",
      "X-Next-App": "marketplace-web",
      Cookie: this.cookie!,
    };
    if (this.anonId) h["X-Anon-Id"] = this.anonId;
    return h;
  }

  /** Katalogsuche; holt bei abgelaufener Session einmal eine neue und versucht es erneut. */
  private async catalogue(params: URLSearchParams): Promise<any[]> {
    // Session spätestens nach 12 Stunden erneuern (das Token gilt 24 Stunden)
    if (!this.cookie || Date.now() - this.cookieFetchedAt > 12 * 3600_000) await this.refreshCookie();
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.api}/svc-catalogue/items?${params}`, { headers: this.apiHeaders() });
      if ((res.status === 401 || res.status === 403) && attempt === 0) {
        await this.refreshCookie();
        continue;
      }
      if (res.status === 401) {
        this.cookie = null;
        throw new Error("Session abgelaufen (401)");
      }
      if (res.status === 429 || res.status === 403) throw new RateLimitError(`Vinted bremst (HTTP ${res.status})`);
      if (!res.ok) throw new Error(`Vinted antwortet mit HTTP ${res.status} (${this.api}/svc-catalogue/items)`);
      const data: any = await res.json();
      return Array.isArray(data.items) ? data.items : [];
    }
  }

  /** Die Suche liefert meist nur ein Bild. Für neue Treffer versuchen wir die Detailseite mit allen Bildern. */
  async photos(l: Listing): Promise<string[]> {
    if (!this.cookie) await this.refreshCookie();
    const res = await fetch(`${this.site}/api/v2/items/${l.id}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", Cookie: this.cookie! },
    }).catch(() => null);
    if (res?.status === 429) throw new RateLimitError(`Vinted bremst (HTTP ${res.status})`);
    // Die Detail-Schnittstelle ist für anonyme Abrufe oft gesperrt (403), dann bleibt es beim Bild aus der Suche
    if (!res?.ok) return l.photoUrls;
    const data: any = await res.json();
    const more = photoList(data.item ?? data);
    return [...new Set([...l.photoUrls, ...more])].slice(0, 3);
  }

  /** Preise der relevantesten Listings zu einer Suche (z. B. „ralph lauren polo“). */
  async comparables(query: string): Promise<number[]> {
    // erst nach Relevanz, und falls die Schnittstelle das ablehnt, ohne Sortierung
    for (const order of ["relevance", null]) {
      const params = new URLSearchParams({ search_text: query, per_page: "60", page: "1" });
      if (order) params.set("order", order);
      try {
        const items = await this.catalogue(params);
        const prices = items.map((it: any) => toListing(it, this.site).price).filter((p: number) => Number.isFinite(p) && p > 0);
        if (!prices.length && order) continue;
        if (prices.length < 5) console.log(`[pricing] nur ${prices.length} Vergleichspreise für "${query}"`);
        return prices;
      } catch (err) {
        if (err instanceof RateLimitError) throw err;
        console.log(`[pricing] Vergleichspreise für "${query}" fehlgeschlagen: ${(err as Error).message}`);
      }
    }
    return [];
  }

  private async getJson(path: string): Promise<any | null> {
    if (!this.cookie || Date.now() - this.cookieFetchedAt > 3600_000) await this.refreshCookie();
    const res = await fetch(`${this.site}${path}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Accept-Language": "de-DE,de;q=0.9", Cookie: this.cookie! },
    });
    if (res.status === 429 || res.status === 403) throw new RateLimitError(`Vinted bremst (HTTP ${res.status})`);
    if (res.status === 401) this.cookie = null;
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Vinted antwortet mit HTTP ${res.status}`);
    return res.json();
  }

  async item(id: string): Promise<ItemDetail | null> {
    const data = await this.getJson(`/api/v2/items/${encodeURIComponent(id)}`);
    const it = data?.item ?? data;
    if (!it?.id) return null;
    const all = (Array.isArray(it.photos) ? it.photos : []).map((p: any) => p?.full_size_url || p?.url).filter(Boolean);
    return {
      ...toListing(it),
      description: String(it.description ?? ""),
      sold: !!(it.is_closed || it.is_reserved || it.is_hidden || it.item_closing_action),
      seller: it.user ? { id: String(it.user.id), login: String(it.user.login ?? "") } : null,
      allPhotoUrls: all,
    };
  }

  async wardrobe(userId: string): Promise<Wardrobe | null> {
    const u = (await this.getJson(`/api/v2/users/${encodeURIComponent(userId)}`))?.user;
    if (!u) return null;
    const w = await this.getJson(`/api/v2/wardrobe/${encodeURIComponent(userId)}/items?page=1&per_page=96&order=newest_first`);
    return {
      user: {
        id: String(u.id),
        login: String(u.login ?? ""),
        itemCount: Number(u.item_count ?? 0),
        rating: u.feedback_reputation != null ? Math.round(Number(u.feedback_reputation) * 50) / 10 : null,
        reviews: Number(u.feedback_count ?? 0),
        followers: Number(u.followers_count ?? 0),
        city: u.city || null,
      },
      items: (w?.items ?? []).map((it: any) => ({ ...toListing(it), sold: !!(it.is_closed || it.is_reserved), favourites: Number(it.favourite_count ?? 0) })),
    };
  }

  async search(s: Search): Promise<Listing[]> {
    const params = new URLSearchParams({
      search_text: s.query,
      order: "newest_first",
      per_page: "30",
      page: "1",
    });
    if (s.minPrice) params.set("price_from", String(s.minPrice));
    if (s.maxPrice) params.set("price_to", String(s.maxPrice));
    // leere Filter weglassen, die neue Schnittstelle antwortet darauf mit 400
    if (s.condition) params.set("attribute_ids[status]", STATUS_IDS[s.condition].join(","));
    return (await this.catalogue(params)).map((it) => toListing(it, this.site));
  }
}

function photoList(it: any): string[] {
  const all = [...(Array.isArray(it.photos) ? it.photos : []), ...(it.photo ? [it.photo] : [])];
  const urls = all.map((p: any) => p?.url || p?.full_size_url).filter((u: unknown): u is string => typeof u === "string");
  return [...new Set(urls)].slice(0, 3);
}

function toListing(it: any, site = "https://www.vinted.de"): Listing {
  // Vinted liefert den Preis je nach Version als String oder als {amount, currency_code}
  const price = typeof it.price === "object" && it.price ? Number(it.price.amount) : Number(it.price);
  const currency = (typeof it.price === "object" && it.price?.currency_code) || it.currency || "EUR";
  return {
    id: String(it.id),
    title: String(it.title ?? ""),
    price,
    currency,
    size: it.size_title || it.size?.title || null,
    brand: it.brand_title || it.brand_dto?.title || it.brand?.title || null,
    url: absolute(it.url || it.path, site) || `${site}/items/${it.id}`,
    photoUrls: photoList(it),
    condition: parseCondition(it.status),
  };
}

const absolute = (u: unknown, site: string) =>
  typeof u === "string" && u ? (/^https?:\/\//.test(u) ? u : site + (u.startsWith("/") ? u : "/" + u)) : null;

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

  async item(id: string): Promise<ItemDetail | null> {
    const n = Number(id.slice(-2)) || 0;
    return {
      id, title: "Raf Simons archive bomber jacket (Test)", price: 180 + n, currency: "EUR", size: "M", brand: "Raf Simons",
      url: `https://www.vinted.de/items/${id}`, photoUrls: [], condition: "very_good",
      description: "Testartikel aus der MockSource.", sold: n % 3 === 0, seller: { id: "42", login: "testseller" }, allPhotoUrls: [],
    };
  }

  async wardrobe(userId: string): Promise<Wardrobe | null> {
    const brands = ["Raf Simons", "Prada", "Ralph Lauren", "Nike", "Stone Island"];
    return {
      user: { id: userId, login: "testseller", itemCount: 20, rating: 4.8, reviews: 31, followers: 120, city: "Berlin" },
      items: Array.from({ length: 20 }, (_, i) => ({
        id: String(9000 + i), title: `${brands[i % 5]} Test ${i}`, price: 20 + i * 9, currency: "EUR", size: "M", brand: brands[i % 5],
        url: `https://www.vinted.de/items/${9000 + i}`, photoUrls: [], sold: i % 4 === 0, favourites: i % 7,
      })),
    };
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

/** Vinted mit der gemeinsamen Adapter-Schnittstelle (der Watcher nutzt weiter direkt VintedSource). */
export function vintedAdapter(source: Source): Adapter {
  return {
    ...baseAdapter("vinted", "api"),
    async search(p: SearchPref): Promise<SourceHit[]> {
      const s: Search = { id: 0, kind: "standard", sources: [], active: true, createdAt: "", minPrice: null, maxPrice: null, size: null, condition: null, ...p };
      return (await source.search(s)).map((l) => ({
        source: "vinted", sourceId: l.id, url: l.url, title: l.title, brand: l.brand, size: l.size, condition: l.condition ?? null,
        price: l.price, currency: l.currency, shipping: null, location: null, country: null, photoUrls: l.photoUrls, detectedAt: new Date().toISOString(),
      }));
    },
    comparables: source.comparables ? (q: string) => source.comparables!(q) : undefined,
  };
}
