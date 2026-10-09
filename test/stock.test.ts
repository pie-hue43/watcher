import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { openDb } from "../src/db.ts";
import { createServer } from "../src/server.ts";
import { plan } from "../src/stock.ts";
import { PriceEstimator } from "../src/pricing.ts";
import { MockSource } from "../src/sources/vinted.ts";

const DAY = 864e5;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

async function setup() {
  const db = openDb(":memory:");
  const app = createServer(db, { watcherToken: "t", allowedOrigins: [] }, { source: new MockSource(), estimator: new PriceEstimator(async () => []), ai: null, vintedDomain: "www.vinted.de" });
  await new Promise<void>((r) => app.server.listen(0, r));
  const base = `http://localhost:${(app.server.address() as AddressInfo).port}/api`;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: res.status === 204 ? null : res.headers.get("content-type")?.includes("json") ? await res.json() : await res.arrayBuffer() };
  };
  return { db, app, call };
}

test("Stock-Regeln: Kosten, Untergrenze, Startpreis und Preisstufen", () => {
  const it = plan.normalize({ title: "Polo", buyPrice: 12, buyFees: 5.8, status: "bought", resaleHigh: 35 } as any);
  assert.equal(plan.totalCost(it), 17.8);
  assert.equal(it.pricePlan.floor, 23, "Kosten 17,80 + 5 € Mindestgewinn, aufgerundet");
  assert.equal(it.pricePlan.start, 35, "Startpreis = obere Resell-Spanne");
  assert.equal(it.price, 35);
  // ohne Resell-Werte: Kosten × 1,5, aber nie unter der Untergrenze
  assert.equal(plan.normalize({ title: "x", buyPrice: 10, buyFees: 0, status: "bought" } as any).pricePlan.start, 15);
  assert.equal(plan.normalize({ title: "x", buyPrice: 10, buyFees: 0, status: "bought", pricePlan: { minProfit: 20 } } as any).pricePlan.start, 30);
  // Gebühren wie in der Flip-Rechnung: 0,70 € + 5 % + 4,50 € Versand
  assert.equal(plan.buyFees(20), 6.2);
  // Stufen: alle 7 Tage −10 %, auf ganze Euro, nie unter floor
  const listed = plan.normalize({ ...it, status: "listed", price: 35, listedAt: ago(8), priceHistory: [{ price: 35, at: ago(8) }] });
  const tasks = plan.tasks([listed]);
  assert.equal(tasks[0].kind, "price");
  assert.equal(tasks[0].price, 32);
  assert.equal(tasks[0].label, "Lower to €32 (floor €23)");
  const atFloor = plan.normalize({ ...listed, price: 24, priceHistory: [{ price: 24, at: ago(7) }] });
  assert.equal(plan.tasks([atFloor])[0].price, 23, "letzte Stufe ist genau die Untergrenze");
});

test("Next up: Reihenfolge nach Dringlichkeit", () => {
  const base = { buyPrice: 10, buyFees: 5, pricePlan: {} };
  const items = [
    { ...base, id: 1, title: "frisch gekauft", status: "bought", boughtAt: ago(2) },
    { ...base, id: 2, title: "unterwegs", status: "bought", boughtAt: ago(6) },
    { ...base, id: 3, title: "angekommen", status: "arrived", boughtAt: ago(8), listing: null },
    { ...base, id: 4, title: "verkauft", status: "sold", boughtAt: ago(20), soldAt: ago(1), soldPrice: 30, buyerCountry: "France", price: 30 },
    { ...base, id: 5, title: "alt eingestellt", status: "listed", boughtAt: ago(40), listedAt: ago(15), price: 30, priceHistory: [{ price: 30, at: ago(15) }] },
    { ...base, id: 6, title: "am Boden", status: "listed", boughtAt: ago(40), listedAt: ago(30), price: 20, priceHistory: [{ price: 20, at: ago(15) }], pricePlan: { minProfit: 5 } },
    { ...base, id: 7, title: "frisch eingestellt", status: "listed", boughtAt: ago(9), listedAt: ago(1), price: 30, priceHistory: [{ price: 30, at: ago(1) }] },
  ].map((x) => plan.normalize(x as any));
  const t = plan.tasks(items);
  assert.deepEqual(JSON.parse(JSON.stringify(t.map((x) => [x.item.id, x.kind]))), [[4, "ship"], [3, "write"], [2, "arrived"], [6, "floor"], [5, "price"]]);
  assert.equal(t[0].label, "Ship to France");
  // Preisstufe nach Floor-Entscheidung "Keep listed": 14 Tage Ruhe
  const kept = plan.normalize({ ...items[5], floorAckAt: ago(1) });
  assert.equal(plan.tasks([kept]).length, 0);
  // eingestellt, nie gesenkt (floor erreicht ist nicht der Fall), 14 Tage ohne Auffrischen
  const stale = plan.normalize({ ...base, id: 8, title: "x", status: "listed", boughtAt: ago(30), listedAt: ago(15), price: 40, priceHistory: [{ price: 40, at: ago(15) }], pricePlan: { everyDays: 60 } } as any);
  assert.equal(plan.tasks([stale])[0].kind, "refresh");
  assert.equal(plan.tasks([{ ...stale, refreshedAt: ago(2) }]).length, 0);
});

test("Stock-API: Snipe → gekauft → eingestellt → Preisstufe → verkauft → My Charts", async (t) => {
  const { app, call, db } = await setup();
  t.after(() => app.close());
  assert.equal((await call("POST", "/stock", { title: "" })).status, 400);
  assert.equal((await call("POST", "/stock", { title: "Polo", buyPrice: 0 })).status, 400);
  const created = await call("POST", "/stock", { hitId: 7, title: "Ralph Lauren polo", brand: "Ralph Lauren", size: "M", buyPrice: 12, resaleLow: 25, resaleHigh: 35, resaleEstimate: 30 });
  assert.equal(created.status, 201);
  const it = created.body;
  assert.equal(it.status, "bought");
  assert.equal(it.buyFees, 5.8, "Käuferschutz + Versand automatisch");
  assert.equal(it.category, "Tops");
  assert.equal(it.pricePlan.floor, 23);
  assert.equal(it.price, 35);
  assert.equal((await call("POST", "/stock", { hitId: 7, title: "nochmal", buyPrice: 12 })).status, 409, "ein Snipe kommt nur einmal in den Bestand");
  assert.equal((await call("PATCH", `/stock/${it.id}`, { status: "sold" })).status, 400, "verkauft nur über Mark as sold");

  // angekommen, Maße, Listing, Fotos
  let r = await call("PATCH", `/stock/${it.id}`, { status: "arrived", measurements: { pitToPit: 54, length: 70, sleeve: "" }, flaws: "small mark on the collar" });
  assert.equal(r.body.status, "arrived");
  assert.ok(r.body.arrivedAt);
  assert.deepEqual(r.body.measurements, { pitToPit: 54, length: 70 });
  assert.equal((await call("PATCH", `/stock/${it.id}`, { measurements: { length: -3 } })).status, 400);
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  r = await call("POST", `/stock/${it.id}/photos`, { photo: png });
  assert.equal(r.status, 201);
  assert.equal(r.body.photos.length, 1);
  r = await call("POST", `/stock/${it.id}/photos`, { photo: png, studio: true });
  assert.equal(r.body.photos[0].studio, true, "Studio-Foto steht vorne");
  const img = await call("GET", r.body.photos[0].url.replace("/api", ""));
  assert.equal(img.status, 200);
  r = await call("DELETE", `/stock/${it.id}/photos/${r.body.photos[1].id}`);
  assert.equal(r.body.photos.length, 1);

  const listing = await call("POST", "/tools/listing", { item: "Polo", brand: "Ralph Lauren", size: "M", condition: "Very good", language: "en", measurements: { pitToPit: 54, length: 70 }, flaws: "small mark on the collar" });
  assert.match(listing.body.description, /Measurements \(flat\): pit to pit 54 cm, length 70 cm/);
  assert.match(listing.body.description, /Flaws: small mark on the collar/);
  const noFlaws = await call("POST", "/tools/listing", { item: "Polo", language: "de", flaws: "" });
  assert.match(noFlaws.body.description, /Mängel: keine bekannt/);

  await call("PATCH", `/stock/${it.id}`, { listing: { title: listing.body.title, description: listing.body.description, hashtags: listing.body.hashtags.join(" "), language: "en" } });
  assert.equal((await call("PATCH", `/stock/${it.id}`, { vintedUrl: "https://example.com/x" })).status, 400);
  r = await call("PATCH", `/stock/${it.id}`, { status: "listed", vintedUrl: "https://www.vinted.de/items/123-polo" });
  assert.equal(r.body.status, "listed");
  assert.equal(r.body.price, 35);
  assert.equal(r.body.priceHistory.length, 1);

  // Preisstufe fällig (Zeit zurückdrehen), bestätigen mit Done
  db.saveStock({ ...r.body, listedAt: ago(8), priceHistory: [{ price: 35, at: ago(8) }] });
  const next = (await call("GET", "/stock/next")).body;
  assert.equal(next[0].kind, "price");
  assert.equal(next[0].price, 32);
  r = await call("PATCH", `/stock/${it.id}`, { price: 32 });
  assert.equal(r.body.priceHistory.length, 2);
  assert.equal((await call("GET", "/stock/next")).body.length, 0);

  // verkauft: landet in My Charts mit vollen Kosten als Einkaufspreis
  assert.equal((await call("POST", `/stock/${it.id}/sold`, { soldPrice: 0 })).status, 400);
  r = await call("POST", `/stock/${it.id}/sold`, { soldPrice: 30, buyerCountry: "France", soldAt: "2026-10-05" });
  assert.equal(r.status, 200);
  assert.equal(r.body.profit, 12.2);
  assert.equal(r.body.item.status, "sold");
  assert.equal(r.body.item.saleId, r.body.sale.id);
  const sales = (await call("GET", "/sales")).body;
  assert.equal(sales.length, 1);
  assert.deepEqual([sales[0].price, sales[0].buyPrice, sales[0].country, sales[0].stockId], [30, 17.8, "France", it.id]);
  assert.equal((await call("POST", `/stock/${it.id}/sold`, { soldPrice: 30 })).status, 409);
  assert.equal((await call("GET", "/stock/next")).body[0].label, "Ship to France");
  await call("PATCH", `/stock/${it.id}`, { shippedAt: new Date().toISOString() });
  assert.equal((await call("GET", "/stock/next")).body.length, 0);

  assert.equal((await call("DELETE", `/stock/${it.id}`)).status, 204);
  assert.equal((await call("GET", `/stock/${it.id}`)).status, 404);
  assert.equal((await call("GET", "/sales")).body.length, 1, "der Verkauf in My Charts bleibt");
});
