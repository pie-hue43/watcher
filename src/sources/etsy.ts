import { RateLimitError } from "./vinted.ts";
import { baseAdapter, type Adapter, type SearchPref, type SourceHit } from "./catalog.ts";

/**
 * Etsy über die offizielle Open API v3 (neueste aktive Angebote).
 * Braucht ETSY_API_KEY in .env (Keystring; verlangt Etsy zusätzlich das Shared Secret, ETSY_SHARED_SECRET setzen).
 * Ohne Schlüssel gibt es nur den Such-Link.
 */
type Fetch = typeof fetch;
const API = "https://openapi.etsy.com/v3/application";

export function etsyAdapter(env: NodeJS.ProcessEnv = process.env, fetchFn: Fetch = fetch): Adapter {
  const key = env.ETSY_API_KEY?.trim();
  const secret = env.ETSY_SHARED_SECRET?.trim();
  const header = key && secret && !key.includes(":") ? `${key}:${secret}` : key;

  async function active(params: Record<string, string>): Promise<any[]> {
    const res = await fetchFn(`${API}/listings/active?${new URLSearchParams(params)}`, { headers: { "x-api-key": header!, Accept: "application/json" } });
    if (res.status === 429) throw new RateLimitError("Etsy API limit reached (HTTP 429)");
    if (res.status === 401 || res.status === 403) throw new Error(`Etsy rejected the API key (HTTP ${res.status}), check ETSY_API_KEY`);
    if (!res.ok) throw new Error(`Etsy API answered HTTP ${res.status}`);
    const data: any = await res.json();
    return data.results ?? [];
  }
  const money = (p: any) => (p && Number(p.divisor) ? Number(p.amount) / Number(p.divisor) : NaN);

  return {
    ...baseAdapter("etsy", key ? "api" : "link"),
    ...(key
      ? {
          async search(p: SearchPref): Promise<SourceHit[]> {
            const params: Record<string, string> = { keywords: p.query, sort_on: "created", sort_order: "desc", limit: "50" };
            if (p.minPrice != null) params.min_price = String(p.minPrice);
            if (p.maxPrice != null) params.max_price = String(p.maxPrice);
            return (await active(params))
              .map((it): SourceHit | null => {
                const price = money(it.price);
                if (!it.listing_id || !Number.isFinite(price)) return null;
                return {
                  source: "etsy", sourceId: String(it.listing_id), url: String(it.url ?? `https://www.etsy.com/listing/${it.listing_id}`),
                  title: String(it.title ?? ""), brand: null, size: null, condition: null, price, currency: String(it.price?.currency_code ?? "USD"),
                  shipping: null, location: null, country: null,
                  photoUrls: (it.images ?? []).map((i: any) => i?.url_570xN).filter(Boolean).slice(0, 3), detectedAt: new Date().toISOString(),
                };
              })
              .filter((h): h is SourceHit => !!h);
          },
        }
      : {}),
  };
}

export default etsyAdapter;
