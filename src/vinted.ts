import type { Search } from "./types.ts";

/** Ein Listing, so wie der Watcher es aus der Datenquelle liest. */
export interface Listing {
  id: string;
  title: string;
  price: number;
  currency: string;
  size: string | null;
  brand: string | null;
  url: string;
  photoUrl: string | null;
}

export interface Source {
  search(s: Search): Promise<Listing[]>;
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

  async search(s: Search): Promise<Listing[]> {
    // Cookie spätestens nach einer Stunde erneuern
    if (!this.cookie || Date.now() - this.cookieFetchedAt > 3600_000) await this.refreshCookie();

    const params = new URLSearchParams({
      search_text: s.query,
      order: "newest_first",
      per_page: "30",
      page: "1",
    });
    if (s.maxPrice) params.set("price_to", String(s.maxPrice));

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
    photoUrl: it.photo?.url ?? null,
  };
}

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
        title: `${s.query} (Test ${id.slice(-4)})`,
        price: Math.round(cap * (0.5 + Math.random() * 0.6)),
        currency: "EUR",
        size: s.size && Math.random() < 0.7 ? s.size : sizes[Math.floor(Math.random() * sizes.length)],
        brand: s.query.split(" ")[0],
        url: `https://www.vinted.de/items/${id}`,
        photoUrl: null,
      });
    }
    return out;
  }
}

/** Prüft, ob ein Listing zu Preis- und Größenfilter des Suchauftrags passt. */
export function matches(s: Search, l: Listing): boolean {
  if (!Number.isFinite(l.price)) return false;
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
