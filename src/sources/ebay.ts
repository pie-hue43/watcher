import type { Condition } from "../types.ts";
import { RateLimitError } from "./vinted.ts";
import { baseAdapter, type Adapter, type SearchPref, type SourceHit } from "./catalog.ts";

/**
 * eBay über die offizielle Browse API (Marketplace EBAY_DE, neueste zuerst).
 * Braucht EBAY_CLIENT_ID und EBAY_CLIENT_SECRET in .env; ohne Schlüssel gibt es nur den Such-Link.
 * watchr liest nur Suchergebnisse. Kaufen, Bieten und Nachrichten laufen immer über eBay selbst.
 */
const API = "https://api.ebay.com";
type Fetch = typeof fetch;

// eBay-Zustands-IDs: 1000 neu, 1500 neu ohne Etikett, 2750 wie neu, 3000 gebraucht
const CONDITION_IDS: Record<Condition, string> = { new_tags: "1000", new: "1000|1500", very_good: "1000|1500|2750|3000", good: "1000|1500|2750|3000" };
function parseCondition(id: unknown, text: unknown): SourceHit["condition"] {
  const n = Number(id);
  if (n === 1000) return "new_tags";
  if (n === 1500 || n === 1750) return "new";
  if (n === 2750 || n === 2990 || (n === 3000 && /sehr gut|very good|wie neu/i.test(String(text ?? "")))) return "very_good";
  if (n >= 3000 && n < 7000) return "good";
  return null;
}

export function ebayAdapter(env: NodeJS.ProcessEnv = process.env, fetchFn: Fetch = fetch): Adapter {
  const id = env.EBAY_CLIENT_ID?.trim();
  const secret = env.EBAY_CLIENT_SECRET?.trim();
  const hasKey = !!(id && secret);
  let token: { value: string; until: number } | null = null;

  async function auth(): Promise<string> {
    if (token && Date.now() < token.until) return token.value;
    const res = await fetchFn(`${API}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }).toString(),
    });
    if (!res.ok) throw new Error(`eBay login failed (HTTP ${res.status}), check EBAY_CLIENT_ID and EBAY_CLIENT_SECRET`);
    const data: any = await res.json();
    token = { value: data.access_token, until: Date.now() + (Number(data.expires_in) || 7200) * 1000 - 60_000 };
    return token.value;
  }

  async function browse(params: Record<string, string>): Promise<any[]> {
    const t = await auth();
    const res = await fetchFn(`${API}/buy/browse/v1/item_summary/search?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${t}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_DE", "Accept-Language": "de-DE" },
    });
    if (res.status === 401) token = null;
    if (res.status === 429) throw new RateLimitError("eBay API limit reached (HTTP 429)");
    if (!res.ok) throw new Error(`eBay API answered HTTP ${res.status}`);
    const data: any = await res.json();
    return data.itemSummaries ?? [];
  }

  const filterOf = (p: SearchPref) => {
    const f = ["buyingOptions:{FIXED_PRICE|BEST_OFFER}"];
    if (p.minPrice != null || p.maxPrice != null) f.push(`price:[${p.minPrice ?? ""}..${p.maxPrice ?? ""}]`, "priceCurrency:EUR");
    if (p.condition) f.push(`conditionIds:{${CONDITION_IDS[p.condition]}}`);
    return f.join(",");
  };

  return {
    ...baseAdapter("ebay", hasKey ? "api" : "link"),
    ...(hasKey
      ? {
          async search(p: SearchPref): Promise<SourceHit[]> {
            const items = await browse({ q: p.query, sort: "newlyListed", limit: "50", filter: filterOf(p) });
            return items.map(toHit).filter((h): h is SourceHit => !!h);
          },
          async comparables(query: string): Promise<number[]> {
            const items = await browse({ q: query, limit: "60", filter: "buyingOptions:{FIXED_PRICE|BEST_OFFER},priceCurrency:EUR" });
            return items.map((it) => Number(it.price?.value)).filter((n) => Number.isFinite(n) && n > 0);
          },
        }
      : {}),
  };
}

export function toHit(it: any): SourceHit | null {
  const price = Number(it?.price?.value);
  if (!it?.itemId || !Number.isFinite(price)) return null;
  const ship = (it.shippingOptions ?? []).map((o: any) => Number(o?.shippingCost?.value)).filter((n: number) => Number.isFinite(n));
  const loc = it.itemLocation ?? {};
  const photos = [it.image?.imageUrl, ...(it.additionalImages ?? []).map((i: any) => i?.imageUrl), ...(it.thumbnailImages ?? []).map((i: any) => i?.imageUrl)].filter(Boolean);
  return {
    source: "ebay",
    sourceId: String(it.legacyItemId ?? it.itemId),
    url: String(it.itemWebUrl ?? `https://www.ebay.de/itm/${it.legacyItemId ?? it.itemId}`),
    title: String(it.title ?? ""),
    brand: null,
    size: null,
    condition: parseCondition(it.conditionId, it.condition),
    price,
    currency: String(it.price?.currency ?? "EUR"),
    shipping: ship.length ? Math.min(...ship) : null,
    location: [loc.postalCode, loc.city, loc.country].filter(Boolean).join(" ") || null,
    country: loc.country ?? null,
    photoUrls: [...new Set(photos as string[])].slice(0, 3),
    detectedAt: new Date().toISOString(),
  };
}

export default ebayAdapter;
