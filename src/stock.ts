import { readFileSync } from "node:fs";
import vm from "node:vm";
import type { Db } from "./db.ts";
import { STOCK_STATUSES, type StockItem } from "./types.ts";

/**
 * Stock: gekaufte Teile vom Snipe bis zum Verkauf. watchr bereitet nur vor (Preise, Texte, Aufgaben),
 * der Nutzer erledigt alles auf Vinted selbst und bestätigt es hier. Nichts wird auf Vinted geändert.
 * Die Rechnungen stehen in public/stock-plan.js, damit Seite und Backend dieselben Zahlen nutzen.
 */
const ctx: any = { window: {} };
vm.runInNewContext(readFileSync(new URL("../public/flip-eval.js", import.meta.url), "utf8"), ctx);
vm.runInNewContext(readFileSync(new URL("../public/stock-plan.js", import.meta.url), "utf8"), ctx);
export const plan = ctx.window.watchrStock as {
  normalize: (it: any) => StockItem;
  buyFees: (price: number) => number;
  totalCost: (it: any) => number;
  listingExtras: (f: { measurements?: Record<string, unknown>; flaws?: string }, language: string) => string[];
  tasks: (items: StockItem[], now?: number) => { kind: string; label: string; rank: number; price?: number; item: StockItem }[];
  guessCategory: (title: string) => string;
};

export class StockError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Reply = { status: number; body?: unknown; raw?: { data: Buffer; type: string } };

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const money = (v: unknown, name: string, allowZero = true) => {
  const n = Number(v);
  if (v === "" || v == null || !Number.isFinite(n) || n < 0 || (!allowZero && n === 0) || n > 1_000_000) throw new StockError(400, `${name} must be a number${allowZero ? "" : " above 0"}`);
  return Math.round(n * 100) / 100;
};
const optMoney = (v: unknown, name: string) => (v === "" || v == null ? null : money(v, name));
const date = (v: unknown, name: string) => {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) throw new StockError(400, `${name} is not a valid date`);
  return d.toISOString();
};
const vintedLink = (v: unknown) => {
  const s = str(v, 500);
  if (!s) return null;
  if (!/^https:\/\/(www\.)?vinted\.[a-z.]+\//i.test(s)) throw new StockError(400, "Paste the link to your listing on Vinted");
  return s;
};

/** Felder, die der Nutzer setzen darf (POST und PATCH). Alles andere setzt watchr selbst. */
function pick(b: any, cur: Partial<StockItem>): Partial<StockItem> {
  const out: Partial<StockItem> = {};
  const has = (k: string) => b[k] !== undefined;
  if (has("title")) {
    const t = str(b.title, 200);
    if (!t) throw new StockError(400, "Add a title");
    out.title = t;
  }
  for (const k of ["brand", "size", "category", "condition", "buyerCountry"] as const) if (has(k)) (out as any)[k] = str(b[k], k === "buyerCountry" ? 60 : 80);
  if (has("flaws")) out.flaws = str(b.flaws, 1000) ?? "";
  if (has("buyPrice")) out.buyPrice = money(b.buyPrice, "Buy price", false);
  if (has("buyFees")) out.buyFees = money(b.buyFees, "Fees");
  for (const k of ["resaleLow", "resaleHigh", "resaleEstimate"] as const) if (has(k)) out[k] = optMoney(b[k], "Resale price");
  if (has("boughtAt")) out.boughtAt = date(b.boughtAt, "Bought on") ?? cur.boughtAt ?? new Date().toISOString();
  for (const k of ["refreshedAt", "floorAckAt", "shippedAt", "arrivedAt"] as const) if (has(k)) out[k] = date(b[k], k);
  if (has("vintedUrl")) out.vintedUrl = vintedLink(b.vintedUrl);
  if (has("price")) out.price = Math.round(money(b.price, "Price", false));
  if (has("status")) {
    if (!(STOCK_STATUSES as readonly string[]).includes(b.status)) throw new StockError(400, "Unknown status");
    if (b.status === "sold" && cur.status !== "sold") throw new StockError(400, "Use Mark as sold, so the sale lands in My Charts");
    out.status = b.status;
  }
  if (has("measurements")) {
    const m: StockItem["measurements"] = {};
    for (const k of ["pitToPit", "length", "sleeve", "waist", "inseam"] as const) {
      const v = b.measurements?.[k];
      if (v === "" || v == null) continue;
      const n = Number(v);
      if (!(n > 0 && n < 400)) throw new StockError(400, "Measurements must be in cm, between 1 and 400");
      m[k] = Math.round(n * 10) / 10;
    }
    out.measurements = m;
  }
  if (has("listing")) {
    const l = b.listing;
    out.listing = l
      ? { title: str(l.title, 200) ?? "", description: str(l.description, 5000) ?? "", hashtags: str(l.hashtags, 500) ?? "", language: l.language === "en" ? "en" : "de" }
      : null;
  }
  if (has("pricePlan")) {
    const p = b.pricePlan ?? {};
    const prev = cur.pricePlan ?? ({} as StockItem["pricePlan"]);
    const num = (v: unknown, lo: number, hi: number, name: string, fallback: number) => {
      if (v === undefined || v === "") return fallback;
      const n = Number(v);
      if (!(n >= lo && n <= hi)) throw new StockError(400, `${name} must be between ${lo} and ${hi}`);
      return n;
    };
    out.pricePlan = {
      ...prev,
      minProfit: num(p.minProfit, 0, 10_000, "Minimum profit", prev.minProfit ?? 5),
      stepPercent: num(p.stepPercent, 1, 50, "Step", prev.stepPercent ?? 10),
      everyDays: Math.round(num(p.everyDays, 1, 60, "Interval", prev.everyDays ?? 7)),
    };
    if (p.start !== undefined) {
      out.pricePlan.custom = p.start !== null && p.start !== "";
      out.pricePlan.start = out.pricePlan.custom ? Math.round(money(p.start, "Start price", false)) : 0;
    }
  }
  return out;
}

const BLANK: Omit<StockItem, "id" | "title" | "buyPrice" | "boughtAt" | "photos" | "price" | "pricePlan"> = {
  hitId: null, brand: null, size: null, category: null, condition: null, buyFees: 0, status: "bought", arrivedAt: null,
  measurements: {}, flaws: "", listing: null, vintedUrl: null, listedAt: null, priceHistory: [], refreshedAt: null, floorAckAt: null,
  resaleLow: null, resaleHigh: null, resaleEstimate: null, soldAt: null, soldPrice: null, buyerCountry: null, shippedAt: null, saleId: null,
};

export function stockRoutes(db: Db) {
  const get = (id: number) => {
    const it = db.getStock(id);
    if (!it) throw new StockError(404, "Item not found");
    return it;
  };
  const now = () => new Date().toISOString();

  function create(b: any): Reply {
    const base: any = { ...BLANK, boughtAt: now(), buyFees: undefined };
    const f = pick({ ...b, status: b.status === "sold" ? "bought" : b.status }, base);
    if (!f.title) throw new StockError(400, "Add a title");
    if (f.buyPrice == null) throw new StockError(400, "Buy price must be a number above 0");
    const hitId = b.hitId == null || b.hitId === "" ? null : Number(b.hitId);
    if (hitId != null && !Number.isInteger(hitId)) throw new StockError(400, "Unknown snipe");
    if (hitId != null && hitId > 0 && db.listStock().some((x) => x.hitId === hitId)) throw new StockError(409, "This snipe is already in your stock");
    const it = plan.normalize({
      ...base,
      ...f,
      hitId,
      category: f.category ?? plan.guessCategory(f.title),
      buyFees: f.buyFees ?? plan.buyFees(f.buyPrice),
      pricePlan: f.pricePlan ?? {},
      price: null,
    });
    return { status: 201, body: db.saveStock(it) };
  }

  function update(id: number, b: any): Reply {
    const cur = get(id);
    const f = pick(b, cur);
    const next: any = { ...cur, ...f };
    const t = now();
    if (f.status === "arrived" && cur.status === "bought") next.arrivedAt ??= t;
    // Eingestellt: Startpreis wird der erste Eintrag der Preisgeschichte
    if (f.status === "listed" && cur.status !== "listed") {
      next.listedAt ??= t;
      if (f.price == null) next.price = plan.normalize({ ...next, status: "arrived" }).price;
      next.priceHistory = [...(cur.priceHistory ?? []), { price: next.price, at: t }];
    } else if (cur.status === "listed" && f.price != null && f.price !== cur.price) {
      // Preisstufe auf Vinted geändert und mit Done bestätigt
      next.priceHistory = [...(cur.priceHistory ?? []), { price: f.price, at: t }];
    }
    return { status: 200, body: db.saveStock(plan.normalize(next)) };
  }

  // Verkauft: zusätzlich ein Eintrag in My Charts mit den vollen Kosten als Einkaufspreis
  function sold(id: number, b: any): Reply {
    const cur = get(id);
    if (cur.status === "sold") throw new StockError(409, "Already marked as sold");
    const soldPrice = money(b.soldPrice, "Sold for", false);
    const soldAt = date(b.soldAt, "Date") ?? now();
    const buyerCountry = str(b.buyerCountry, 60);
    const cost = plan.totalCost(cur);
    const sale = db.addSale({ title: cur.title, price: soldPrice, buyPrice: cost, country: buyerCountry, soldAt, stockId: cur.id });
    const it = db.saveStock(plan.normalize({ ...cur, status: "sold", soldPrice, soldAt, buyerCountry, saleId: sale.id }));
    return { status: 200, body: { item: it, sale, profit: Math.round((soldPrice - cost) * 100) / 100 } };
  }

  function addPhoto(id: number, b: any): Reply {
    get(id);
    const m = typeof b.photo === "string" ? b.photo.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/) : null;
    if (!m) throw new StockError(400, "Add a JPG, PNG or WebP photo");
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > 8_000_000) throw new StockError(413, "Photo too large");
    if (get(id).photos.length >= 20) throw new StockError(400, "An item can have up to 20 photos");
    db.addStockPhoto(id, m[1], bytes, !!b.studio);
    return { status: 201, body: get(id) };
  }

  return async function handle(method: string, path: string, body: () => Promise<any>): Promise<Reply | null> {
    if (path !== "/stock" && !path.startsWith("/stock/")) return null;
    if (path === "/stock" && method === "GET") return { status: 200, body: db.listStock() };
    if (path === "/stock" && method === "POST") return create(await body());
    if (path === "/stock/next" && method === "GET") return { status: 200, body: plan.tasks(db.listStock()).map(({ item, ...t }) => ({ ...t, itemId: item.id, title: item.title })) };
    const photo = path.match(/^\/stock\/photos\/(\d+)$/);
    if (photo && method === "GET") {
      const p = db.getStockPhoto(Number(photo[1]));
      if (!p) throw new StockError(404, "Photo not found");
      return { status: 200, raw: { data: p.bytes, type: p.type } };
    }
    const m = path.match(/^\/stock\/(\d+)(\/sold|\/photos(?:\/(\d+))?)?$/);
    if (!m) throw new StockError(404, "Not found");
    const id = Number(m[1]);
    if (!m[2]) {
      if (method === "GET") return { status: 200, body: get(id) };
      if (method === "PATCH") return update(id, await body());
      if (method === "DELETE") {
        if (!db.deleteStock(id)) throw new StockError(404, "Item not found");
        return { status: 204 };
      }
    }
    if (m[2] === "/sold" && method === "POST") return sold(id, await body());
    if (m[2] === "/photos" && method === "POST") return addPhoto(id, await body());
    if (m[3] && method === "DELETE") {
      if (!db.deleteStockPhoto(id, Number(m[3]))) throw new StockError(404, "Photo not found");
      return { status: 200, body: get(id) };
    }
    throw new StockError(405, "Method not allowed");
  };
}
