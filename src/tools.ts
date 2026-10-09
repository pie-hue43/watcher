import type { Ai } from "./ai.ts";
import type { Db } from "./db.ts";
import { findDesigner } from "./designers.ts";
import { guessBrand, productKey, type PriceEstimator } from "./pricing.ts";
import { plan } from "./stock.ts";
import { CONDITIONS, type Condition, type ServerMessage, type Tracked } from "./types.ts";
import { RateLimitError, itemIdFromUrl, userIdFromUrl, type Source, type Wardrobe } from "./sources/vinted.ts";

/**
 * AI Tools: zehn Werkzeuge rund um Vinted. Jedes Tool arbeitet mit echten Daten
 * (Vinted, die eigene Datenbank, gespeicherte Resellpreise). Die KI-Teile nutzen Claude,
 * wenn ANTHROPIC_API_KEY gesetzt ist, sonst einfache Regeln (die Antwort sagt dann `ai: false`).
 */
export interface ToolDeps {
  db: Db;
  source: Source | null;
  estimator: PriceEstimator | null;
  ai: Ai | null;
  vintedDomain: string;
  broadcast: (msg: ServerMessage) => void;
}

export class ToolError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Reply = { status: number; body?: unknown; raw?: { data: Buffer; type: string } };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const round = (x: number) => Math.round(x * 100) / 100;
const daysAgo = (iso: string) => (Date.now() - Date.parse(iso)) / 864e5;

/** Nur Bilder von Vinteds eigenen Bildservern dürfen durch den Proxy (kein offener Proxy). */
const allowedImage = (u: string) => {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && /(^|\.)vinted\.(net|com|de|fr|co\.uk|it|es|nl|be|at|pl|cz|lt|lu|pt|se|dk|fi|hu|ro|sk)$/.test(url.hostname);
  } catch {
    return false;
  }
};

export function toolRoutes(d: ToolDeps) {
  const need = <K extends "item" | "wardrobe" | "comparables">(k: K) => {
    const fn = d.source?.[k];
    if (!fn) throw new ToolError(503, "This tool needs the Vinted connection (WATCHER_SOURCE=vinted).");
    return fn.bind(d.source) as NonNullable<Source[K]>;
  };
  const vinted = async <T>(p: Promise<T>) =>
    p.catch((err) => {
      if (err instanceof RateLimitError) throw new ToolError(429, "Vinted is asking us to slow down. Try again in a few minutes.");
      if (err instanceof ToolError) throw err;
      throw new ToolError(502, `Vinted didn't answer as expected (${(err as Error).message}).`);
    });

  async function itemFromInput(input: unknown) {
    const id = typeof input === "string" ? itemIdFromUrl(input) : null;
    if (!id) throw new ToolError(400, "Paste a Vinted listing link, like https://www.vinted.de/items/1234567-…");
    const item = await vinted(need("item")(id));
    if (!item) throw new ToolError(404, "This listing doesn't exist anymore.");
    return item;
  }

  // 1. Price Estimator: Resellpreis für einen Link oder eine Beschreibung
  async function price(b: any): Promise<Reply> {
    if (!d.estimator) throw new ToolError(503, "Price estimates need the Vinted connection.");
    let item: { title: string; brand: string | null; price?: number; url?: string; photoUrls?: string[] } | null = null;
    if (typeof b.url === "string" && b.url.trim()) item = await itemFromInput(b.url);
    else if (typeof b.title === "string" && b.title.trim()) item = { title: b.title.trim().slice(0, 200), brand: typeof b.brand === "string" && b.brand.trim() ? b.brand.trim() : null };
    else throw new ToolError(400, "Paste a listing link or describe the item, like “Ralph Lauren polo”.");
    // Marke aus der Beschreibung übernehmen, auch wenn sie keine Designermarke ist („Ralph Lauren polo“)
    if (!item.url && !item.brand && !productKey(item)) item.brand = guessBrand(item.title);
    const pk = productKey(item);
    if (!pk) throw new ToolError(422, "watchr couldn't recognise the brand. Add it, like “Prada nylon bag”.");
    const ref = await vinted(d.estimator.estimate(item));
    if (!ref) return { status: 200, body: { item, product: pk.query, ref: null } };
    return {
      status: 200,
      body: { item, product: pk.query, ref, difference: item.price != null ? round(ref.median - item.price) : null },
    };
  }

  // 2. Deal Finder: gefundene Listings nach Rendite sortiert
  function deals(days: number): Reply {
    const list = d.db
      .listHits(500)
      .filter((h) => h.resaleEstimate && h.resaleEstimate > h.price && daysAgo(h.detectedAt) <= days)
      .map((h) => ({ ...h, profit: round(h.resaleEstimate! - h.price), roi: Math.round(((h.resaleEstimate! - h.price) / h.price) * 100) }))
      .sort((a, b) => b.roi - a.roi)
      .slice(0, 50);
    return { status: 200, body: list };
  }

  // 3. Niche Finder: Produktgruppen, in denen Funde weit unter dem Resellpreis liegen
  function niches(): Reply {
    const refs = new Map((d.estimator?.all() ?? []).map((r) => [r.key, r]));
    const groups = new Map<string, number[]>();
    for (const h of d.db.listHits(1000)) {
      const pk = productKey(h);
      if (!pk || !refs.has(pk.key)) continue;
      groups.set(pk.key, [...(groups.get(pk.key) ?? []), h.price]);
    }
    const list = [...groups.entries()]
      .map(([key, prices]) => {
        const ref = refs.get(key)!;
        const buy = median(prices);
        return { key, product: ref.query, finds: prices.length, typicalBuy: round(buy), resale: ref.median, multiple: round(ref.median / buy) };
      })
      .filter((n) => n.finds >= 2 && n.multiple > 1)
      .sort((a, b) => b.multiple - a.multiple || b.finds - a.finds);
    return { status: 200, body: list };
  }

  // 4. Offer Finder: Listings, bei denen ein Angebot von höchstens 30 % unter Preis noch Marge lässt
  function offers(): Reply {
    const list = d.db
      .listHits(500)
      .filter((h) => h.resaleEstimate && daysAgo(h.detectedAt) <= 14)
      .map((h) => {
        const offer = Math.floor(h.resaleEstimate! * 0.7);
        return { ...h, offer, discount: Math.round((1 - offer / h.price) * 100), profit: round(h.resaleEstimate! - offer) };
      })
      .filter((h) => h.discount > 0 && h.discount <= 30)
      .sort((a, b) => a.discount - b.discount || b.profit - a.profit)
      .slice(0, 50);
    return { status: 200, body: list };
  }

  // 5. Seller Intel: Kleiderschrank eines Verkäufers auswerten
  async function seller(b: any): Promise<Reply> {
    const id = typeof b.url === "string" ? userIdFromUrl(b.url) ?? (/^\d+$/.test(b.url.trim()) ? b.url.trim() : null) : null;
    if (!id) throw new ToolError(400, "Paste a Vinted profile link, like https://www.vinted.de/member/123456-name");
    const w = await vinted(need("wardrobe")(id));
    if (!w) throw new ToolError(404, "This profile doesn't exist.");
    const active = w.items.filter((i) => !i.sold);
    const prices = w.items.map((i) => i.price).filter(Number.isFinite);
    const count = (key: (i: Wardrobe["items"][number]) => string | null) => {
      const m = new Map<string, number>();
      for (const i of w.items) {
        const k = key(i);
        if (k) m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => ({ name, n }));
    };
    const stats = {
      user: w.user,
      listed: w.items.length,
      active: active.length,
      soldOrReserved: w.items.length - active.length,
      medianPrice: round(median(prices)),
      priceRange: prices.length ? [Math.min(...prices), Math.max(...prices)] : null,
      topBrands: count((i) => i.brand),
      designers: count((i) => findDesigner(`${i.brand ?? ""} ${i.title}`)?.name ?? null),
      mostFavourited: [...w.items].sort((a, b) => b.favourites - a.favourites).slice(0, 5),
    };
    let summary: string | null = null;
    if (d.ai) {
      const r = await d.ai
        .json<{ summary: string }>(
          "You analyse Vinted seller wardrobes for resellers. Write 3 to 5 short, concrete sentences in English: what the seller specialises in, how they price, what seems to sell, and one tip for buying from them. Only use the data given.",
          JSON.stringify({ ...stats, items: w.items.slice(0, 60).map((i) => ({ title: i.title, brand: i.brand, price: i.price, sold: i.sold, favourites: i.favourites })) }),
          { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
        )
        .catch(() => null);
      summary = r?.summary ?? null;
    }
    return { status: 200, body: { ...stats, summary, ai: !!summary } };
  }

  // 6. AI Listings: Titel, Beschreibung und Hashtags für den eigenen Verkauf
  async function listing(b: any): Promise<Reply> {
    const f = {
      item: String(b.item ?? "").trim().slice(0, 200),
      brand: String(b.brand ?? "").trim().slice(0, 80),
      size: String(b.size ?? "").trim().slice(0, 40),
      condition: String(b.condition ?? "").trim().slice(0, 40),
      notes: String(b.notes ?? "").trim().slice(0, 1000),
      language: b.language === "en" ? "English" : "German",
    };
    if (!f.item && !b.photo) throw new ToolError(400, "Describe the item or add a photo.");
    // Maße und Mängel stehen immer als eigene Zeilen in der Beschreibung (weniger „nicht wie beschrieben“)
    const extras = plan.listingExtras({ measurements: b.measurements, flaws: b.flaws === undefined ? undefined : String(b.flaws ?? "").slice(0, 1000) }, b.language === "en" ? "en" : "de");
    const withExtras = (text: string) => [text.trim(), ...extras].filter(Boolean).join("\n\n");
    const photo = typeof b.photo === "string" ? b.photo.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/) : null;
    if (d.ai) {
      const content: any[] = [];
      if (photo) content.push({ type: "image", source: { type: "base64", media_type: photo[1], data: photo[2] } });
      content.push({ type: "text", text: JSON.stringify(f) });
      const r = await d.ai
        .json<{ title: string; description: string; hashtags: string[] }>(
          `You write Vinted listings in ${f.language}. Title: at most 60 characters, brand + item + key detail. Description: 3 to 6 short lines covering condition, size and fit, material, honest flaws from the notes.${extras.length ? " Don't list measurements or a flaws line, watchr adds those itself." : ""} Never invent details that are not in the input or clearly visible in the photo. Hashtags: 8 to 12 lowercase tags without spaces that buyers search for.`,
          content,
          {
            type: "object",
            properties: { title: { type: "string" }, description: { type: "string" }, hashtags: { type: "array", items: { type: "string" } } },
            required: ["title", "description", "hashtags"],
            additionalProperties: false,
          },
        )
        .catch(() => null);
      if (r) return { status: 200, body: { ...r, description: withExtras(r.description), hashtags: r.hashtags.map((t) => "#" + t.replace(/^#/, "").replace(/\s+/g, "")), ai: true } };
    }
    // Ohne KI: Vorlage aus den Angaben
    const de = f.language === "German";
    const title = [f.brand, f.item, f.size && (de ? `Gr. ${f.size}` : `size ${f.size}`)].filter(Boolean).join(" ").slice(0, 60);
    const lines = [
      [f.brand, f.item].filter(Boolean).join(" "),
      f.condition && `${de ? "Zustand" : "Condition"}: ${(de && CONDITION_DE[f.condition]) || f.condition}`,
      f.size && `${de ? "Größe" : "Size"}: ${f.size}`,
      f.notes,
      de ? "Bei Fragen gerne schreiben, Bündel möglich." : "Feel free to ask, bundles welcome.",
    ].filter(Boolean);
    const words = `${f.brand} ${f.item}`.toLowerCase().split(/[^a-zà-ÿ0-9]+/).filter((w) => w.length > 2);
    const hashtags = [...new Set([...words, f.brand.toLowerCase().replace(/\s+/g, ""), findDesigner(f.brand + " " + f.item) ? "designer" : "", "vintage"].filter(Boolean))]
      .slice(0, 10)
      .map((t) => "#" + t);
    return { status: 200, body: { title, description: withExtras(lines.join("\n")), hashtags, ai: false } };
  }

  // 7. Vinted Repost: eigenes Listing auslesen, um es neu einzustellen
  async function repost(b: any): Promise<Reply> {
    const item = await itemFromInput(b.url);
    const photos = (item.allPhotoUrls.length ? item.allPhotoUrls : item.photoUrls).filter(allowedImage);
    return {
      status: 200,
      body: {
        title: item.title, description: item.description, price: item.price, currency: item.currency, brand: item.brand, size: item.size,
        seller: item.seller, photos: photos.map((u) => ({ original: u, proxied: `/api/tools/image?u=${encodeURIComponent(u)}` })),
      },
    };
  }

  async function image(u: string | null): Promise<Reply> {
    if (!u || !allowedImage(u)) throw new ToolError(400, "Only Vinted photos can be loaded.");
    const res = await fetch(u);
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) throw new ToolError(502, "Photo couldn't be loaded.");
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > 15_000_000) throw new ToolError(413, "Photo too large.");
    return { status: 200, raw: { data, type } };
  }

  // 8. Wardrobe Tracker: Artikel oder ganze Kleiderschränke beobachten
  async function track(b: any): Promise<Reply> {
    const url = String(b.url ?? "").trim();
    const userId = userIdFromUrl(url);
    const added: Tracked[] = [];
    if (userId) {
      const w = await vinted(need("wardrobe")(userId));
      if (!w) throw new ToolError(404, "This profile doesn't exist.");
      for (const i of w.items.filter((i) => !i.sold).slice(0, 40)) {
        const t = d.db.track({ vintedId: i.id, url: i.url, title: i.title, price: i.price, currency: i.currency, photoUrl: i.photoUrls[0] ?? null, seller: w.user.login });
        if (t) added.push(t);
      }
    } else {
      const i = await itemFromInput(url);
      const t = d.db.track({ vintedId: i.id, url: i.url, title: i.title, price: i.price, currency: i.currency, photoUrl: i.photoUrls[0] ?? null, seller: i.seller?.login ?? null });
      if (t) added.push(t);
    }
    return { status: 201, body: { added: added.length, tracked: d.db.listTracked() } };
  }

  // 9. AI Filters: Wunsch in Worten -> Hashtags und Vinted-Link
  async function filters(b: any): Promise<Reply> {
    const text = String(b.text ?? "").trim().slice(0, 500);
    if (!text) throw new ToolError(400, "Describe what you're looking for.");
    type F = { keywords: string[]; minPrice: number | null; maxPrice: number | null; size: string | null; condition: Condition | null; archive: boolean };
    let f: F | null = null;
    if (d.ai) {
      f = await d.ai
        .json<F>(
          "Turn a shopper's request for Vinted into search filters. keywords: 1 to 5 short search words (brand, item type, colour, model), in the language most sellers would use. Prices in euros. condition is the minimum condition. archive is true when they ask for designer, archive, runway or rare pieces in general.",
          text,
          {
            type: "object",
            properties: {
              keywords: { type: "array", items: { type: "string" } },
              minPrice: { type: ["number", "null"] },
              maxPrice: { type: ["number", "null"] },
              size: { type: ["string", "null"] },
              condition: { type: ["string", "null"], enum: [...CONDITIONS, null] },
              archive: { type: "boolean" },
            },
            required: ["keywords", "minPrice", "maxPrice", "size", "condition", "archive"],
            additionalProperties: false,
          },
        )
        .catch(() => null);
    }
    const ai = !!f;
    f ??= ruleFilters(text);
    const tags = [
      f.archive ? "#archive" : null,
      ...f.keywords.map((k) => "#" + k.replace(/\s+/g, "")),
      f.size ? "#size" + f.size : null,
      f.minPrice ? "#min" + f.minPrice : null,
      f.maxPrice ? "#max" + f.maxPrice : null,
      f.condition ? { new_tags: "#newtags", new: "#new", very_good: "#verygood", good: "#good" }[f.condition] : null,
    ].filter(Boolean) as string[];
    const p = new URLSearchParams({ search_text: f.keywords.join(" "), order: "newest_first" });
    if (f.minPrice) p.set("price_from", String(f.minPrice));
    if (f.maxPrice) p.set("price_to", String(f.maxPrice));
    const STATUS: Record<Condition, number[]> = { new_tags: [6], new: [6, 1], very_good: [6, 1, 2], good: [6, 1, 2, 3] };
    for (const s of f.condition ? STATUS[f.condition] : []) p.append("status_ids[]", String(s));
    return { status: 200, body: { ...f, tags, vintedUrl: `https://${d.vintedDomain}/catalog?${p}`, ai } };
  }

  // 10. AI Photo Enhancer: Freisteller über remove.bg (optional), den Studiohintergrund setzt der Browser
  async function cutout(b: any): Promise<Reply> {
    const key = process.env.REMOVE_BG_API_KEY;
    if (!key) throw new ToolError(503, "Background removal needs REMOVE_BG_API_KEY on the server.");
    const m = typeof b.photo === "string" ? b.photo.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/) : null;
    if (!m) throw new ToolError(400, "Add a JPG, PNG or WebP photo.");
    const form = new FormData();
    form.append("image_file", new Blob([Buffer.from(m[2], "base64")], { type: m[1] }), "photo");
    form.append("size", "auto");
    const res = await fetch("https://api.remove.bg/v1.0/removebg", { method: "POST", headers: { "X-Api-Key": key }, body: form });
    if (!res.ok) throw new ToolError(502, `Background removal failed (HTTP ${res.status}).`);
    return { status: 200, raw: { data: Buffer.from(await res.arrayBuffer()), type: "image/png" } };
  }

  return async function handle(method: string, path: string, query: URLSearchParams, body: () => Promise<any>): Promise<Reply | null> {
    if (!path.startsWith("/tools/")) return null;
    const p = path.slice(6);
    if (p === "/status" && method === "GET") return { status: 200, body: { ai: !!d.ai, vinted: !!d.source?.item, cutout: !!process.env.REMOVE_BG_API_KEY } };
    if (p === "/cutout" && method === "POST") return cutout(await body());
    if (p === "/price" && method === "POST") return price(await body());
    if (p === "/deals" && method === "GET") return deals(Math.min(30, Number(query.get("days")) || 7));
    if (p === "/niches" && method === "GET") return niches();
    if (p === "/offers" && method === "GET") return offers();
    if (p === "/seller" && method === "POST") return seller(await body());
    if (p === "/listing" && method === "POST") return listing(await body());
    if (p === "/repost" && method === "POST") return repost(await body());
    if (p === "/image" && method === "GET") return image(query.get("u"));
    if (p === "/filters" && method === "POST") return filters(await body());
    if (p === "/tracked" && method === "GET") return { status: 200, body: d.db.listTracked() };
    if (p === "/tracked" && method === "POST") return track(await body());
    const del = p.match(/^\/tracked\/(\d+)$/);
    if (del && method === "DELETE") {
      if (!d.db.untrack(Number(del[1]))) throw new ToolError(404, "Not tracked.");
      return { status: 204 };
    }
    throw new ToolError(404, "Not found");
  };
}

const CONDITION_DE: Record<string, string> = {
  "New with tags": "Neu mit Etikett", "New without tags": "Neu ohne Etikett", "Very good": "Sehr gut", Good: "Gut", Satisfactory: "Zufriedenstellend",
};

/** AI Filters ohne KI: Preise, Größe, Zustand und Designer aus dem Text lesen. */
export function ruleFilters(text: string) {
  let t = ` ${text.toLowerCase()} `;
  const take = (re: RegExp) => {
    const m = t.match(re);
    if (m) t = t.replace(m[0], " ");
    return m;
  };
  const between = take(/(?:between|zwischen)\s*€?\s*(\d+)\s*(?:€|eur|euro)?\s*(?:and|und|-|bis)\s*€?\s*(\d+)/);
  const max = between ? null : take(/(?:under|below|max(?:imum)?|unter|bis|höchstens|<)\s*€?\s*(\d+)/);
  const min = between ? null : take(/(?:over|above|min(?:imum)?|über|ab|mindestens|>)\s*€?\s*(\d+)/);
  const size = take(/(?:size|größe|grösse|gr\.?)\s*(\d+(?:[.,]\d)?|[a-z0-9/]+)/) ?? take(/\b(xxs|xs|s|m|l|xl|xxl)\b/);
  const cond: [RegExp, Condition][] = [
    [/new with tags|mit etikett|nwt|bnwt/, "new_tags"],
    [/\bnew\b|\bneu\b|unworn|ungetragen/, "new"],
    [/very good|sehr gut|like new|wie neu/, "very_good"],
    [/\bgood\b|\bgut\b/, "good"],
  ];
  const c = cond.find(([re]) => take(re));
  const archive = !!take(/\b(archive|archiv|designer|grail|runway|rare|selten)\b/);
  const designer = findDesigner(t);
  if (designer) for (const a of [designer.name.toLowerCase(), ...designer.aliases]) t = t.replace(a, " ");
  const stop = new Set("a an the in im in for für mit with and und or oder i want ich suche looking search find me some ein eine einen der die das von from to zu condition zustand size größe price preis".split(" "));
  const words = t.replace(/[€$.,!?]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !stop.has(w) && !/^\d+$/.test(w)).slice(0, 4);
  return {
    keywords: [...(designer ? [designer.name] : []), ...words],
    minPrice: between ? Number(between[1]) : min ? Number(min[1]) : null,
    maxPrice: between ? Number(between[2]) : max ? Number(max[1]) : null,
    size: size ? size[1].toUpperCase() : null,
    condition: c ? c[1] : null,
    archive: archive && !designer,
  };
}

/**
 * Verkaufsprüfung für Snipes: schaut regelmäßig nach, ob gefundene Listings auf Vinted verkauft wurden.
 * Verkaufte landen mit Datum unter Flips und werden live gemeldet.
 */
export function startSaleChecker(d: ToolDeps, everyMs = 10 * 60_000, perRun = 10, log = (m: string) => console.log(`[flips] ${m}`), gapMs = 3000) {
  if (!d.source?.item) return () => {};
  let stopped = false;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms).unref());
  const run = async () => {
    for (const h of d.db.dueSaleChecks(perRun)) {
      if (stopped) return;
      try {
        const item = await d.source!.item!(h.vintedId);
        const sold = d.db.setSaleStatus(h.id, !item ? "gone" : item.sold ? "sold" : "active");
        if (sold) {
          log(`Verkauft: ${sold.title} (${sold.price} ${sold.currency})`);
          d.broadcast({ type: "hitSold", hit: sold });
        }
      } catch (err) {
        if (err instanceof RateLimitError) return log("Vinted bremst, nächster Versuch später");
      }
      await sleep(gapMs + Math.random() * (gapMs * 0.66));
    }
  };
  const loop = async () => {
    while (!stopped) {
      await run().catch(() => {});
      await sleep(everyMs);
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}

/** Wardrobe Tracker im Hintergrund: prüft regelmäßig, ob beobachtete Artikel verkauft wurden. */
export function startTracker(d: ToolDeps, everyMs = 10 * 60_000, perRun = 10, log = (m: string) => console.log(`[tracker] ${m}`)) {
  if (!d.source?.item) return () => {};
  let stopped = false;
  // unref: der Tracker allein hält den Prozess nicht am Leben
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms).unref());
  const run = async () => {
    for (const t of d.db.dueTracked(perRun)) {
      if (stopped) return;
      try {
        const item = await d.source!.item!(t.vintedId);
        const status = !item ? "gone" : item.sold ? "sold" : "active";
        const next = d.db.setTrackedStatus(t.id, status);
        if (next && status !== "active") {
          log(`${status === "sold" ? "Verkauft" : "Nicht mehr online"}: ${t.title}`);
          d.broadcast({ type: "sold", item: next });
        }
      } catch (err) {
        if (err instanceof RateLimitError) return log("Vinted bremst, nächster Versuch später");
      }
      await sleep(3000 + Math.random() * 2000);
    }
  };
  const loop = async () => {
    while (!stopped) {
      await run().catch(() => {});
      await sleep(everyMs);
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}

