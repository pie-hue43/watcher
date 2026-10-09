import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { openDb } from "../src/db.ts";
import { createServer } from "../src/server.ts";
import { PriceEstimator, guessBrand } from "../src/pricing.ts";
import { ruleFilters, startSaleChecker, startTracker } from "../src/tools.ts";
import { MockSource } from "../src/sources/vinted.ts";

async function setup() {
  const db = openDb(":memory:");
  const source = new MockSource();
  const estimator = new PriceEstimator(async () => [80, 90, 95, 100, 100, 105, 110, 120]);
  const app = createServer(db, { watcherToken: "t", allowedOrigins: [] }, { source, estimator, ai: null, vintedDomain: "www.vinted.de" });
  await new Promise<void>((r) => app.server.listen(0, r));
  const base = `http://localhost:${(app.server.address() as AddressInfo).port}/api/tools`;
  const call = async (path: string, body?: unknown) => {
    const res = await fetch(base + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  // Treffer mit Resellpreis anlegen
  const hit = (id: string, title: string, price: number, resale: number) =>
    db.insertHit({ vintedId: id, searchId: search.id, title, price, currency: "EUR", size: "M", brand: "Ralph Lauren", url: `https://www.vinted.de/items/${id}`, photoUrls: [],
      resaleEstimate: resale, resaleLow: null, resaleHigh: null, resaleSamples: 8, archiveScore: 0, designer: null });
  await estimator.estimate({ title: "Ralph Lauren polo", brand: "Ralph Lauren" });
  const search = db.createSearch({ query: "ralph lauren polo", minPrice: null, maxPrice: null, size: null, condition: null });
  hit("1", "Ralph Lauren polo navy", 30, 100);
  hit("2", "Ralph Lauren polo rot", 45, 100);
  hit("3", "Ralph Lauren polo grün", 90, 100);
  return { db, app, call, source };
}

test("Price, Deal, Niche und Offer Finder", async () => {
  const { app, call } = await setup();
  const price = await call("/price", { title: "Ralph Lauren polo", brand: "Ralph Lauren" });
  assert.equal(price.body.ref.median, 100);
  const byUrl = await call("/price", { url: "https://www.vinted.de/items/123401-raf-simons-jacke" });
  assert.equal(byUrl.status, 200);
  assert.equal(byUrl.body.product, "raf simons jacke");
  assert.equal((await call("/price", { title: "Pullover" })).status, 422);

  const deals = (await call("/deals")).body;
  assert.deepEqual(deals.map((d: any) => d.vintedId), ["1", "2", "3"]);
  assert.equal(deals[0].roi, 233);

  const niches = (await call("/niches")).body;
  assert.equal(niches[0].product, "ralph lauren polo");
  assert.equal(niches[0].finds, 3);
  assert.ok(niches[0].multiple >= 2);

  const offers = (await call("/offers")).body;
  assert.deepEqual(offers.map((o: any) => o.vintedId), ["3"], "nur Nr. 3 liegt über 70 € und höchstens 30 % darüber");
  assert.equal(offers[0].offer, 70);
  await app.close();
});

test("Seller Intel, AI Listings ohne KI, Repost und Bild-Proxy", async () => {
  const { app, call } = await setup();
  const s = (await call("/seller", { url: "https://www.vinted.de/member/42-testseller" })).body;
  assert.equal(s.listed, 20);
  assert.equal(s.soldOrReserved, 5);
  assert.equal(s.ai, false);
  assert.equal(s.designers[0].name, "Raf Simons");

  const l = (await call("/listing", { item: "Polo shirt", brand: "Ralph Lauren", size: "M", condition: "sehr gut" })).body;
  assert.equal(l.ai, false);
  assert.match(l.title, /Ralph Lauren Polo shirt/);
  assert.ok(l.hashtags.includes("#ralphlauren"));

  const r = (await call("/repost", { url: "https://www.vinted.de/items/555" })).body;
  assert.equal(r.title, "Raf Simons archive bomber jacket (Test)");
  assert.equal((await call("/image?u=" + encodeURIComponent("https://evil.example/x.jpg"))).status, 400, "kein offener Proxy");
  await app.close();
});

test("AI Filters ohne KI", () => {
  const f = ruleFilters("black Raf Simons jacket under 300 size M very good");
  assert.deepEqual(f.keywords, ["Raf Simons", "black", "jacket"]);
  assert.equal(f.maxPrice, 300);
  assert.equal(f.size, "M");
  assert.equal(f.condition, "very_good");
  const g = ruleFilters("rare archive pieces zwischen 50 und 200 euro");
  assert.equal(g.archive, true);
  assert.equal(g.minPrice, 50);
  assert.equal(g.maxPrice, 200);
  const h = ruleFilters("Black Raf Simons jacket under 300 €, size M, very good condition");
  assert.deepEqual(h.keywords, ["Raf Simons", "black", "jacket"]);
  assert.equal(h.size, "M");
  assert.equal(ruleFilters("Nike Dunk Größe 42,5").size, "42,5");
});

test("Price Estimator erkennt auch Marken ohne Designerliste", async () => {
  assert.equal(guessBrand("Ralph Lauren polo"), "Ralph Lauren");
  assert.equal(guessBrand("polo"), null);
  const { app, call } = await setup();
  const r = await call("/price", { title: "Ralph Lauren polo" });
  assert.equal(r.status, 200);
  assert.equal(r.body.product, "ralph lauren polo");
  assert.equal(r.body.ref.median, 100);
  await app.close();
});

test("Wardrobe Tracker meldet verkaufte Artikel", async () => {
  const { app, call, db } = await setup();
  const added = await call("/tracked", { url: "https://www.vinted.de/items/1003" }); // MockSource: Endung 03 -> verkauft
  assert.equal(added.status, 201);
  await call("/tracked", { url: "https://www.vinted.de/items/1001" });
  const events: any[] = [];
  const stop = startTracker({ ...app.deps!, broadcast: (m) => events.push(m) }, 60_000, 10, () => {});
  await new Promise((r) => setTimeout(r, 6000));
  stop();
  const list = db.listTracked();
  assert.equal(list.find((t) => t.vintedId === "1003")!.status, "sold");
  assert.equal(list.find((t) => t.vintedId === "1001")!.status, "active");
  assert.equal(events.filter((e) => e.type === "sold").length, 1);
  assert.equal((await call("/tracked")).body.length, 2);
  await app.close();
});

test("Verkaufsprüfung: verkaufte Snipes landen unter Flips", async () => {
  const { app, db } = await setup(); // MockSource: Listing 3 ist verkauft
  const events: any[] = [];
  const stop = startSaleChecker({ ...app.deps!, broadcast: (m) => events.push(m) }, 60_000, 10, () => {}, 0);
  await new Promise((r) => setTimeout(r, 300));
  stop();
  const hits = db.listHits(10);
  assert.equal(hits.find((h) => h.vintedId === "3")!.saleStatus, "sold");
  assert.ok(hits.find((h) => h.vintedId === "3")!.soldAt);
  assert.equal(hits.find((h) => h.vintedId === "1")!.saleStatus, "active");
  assert.equal(events.filter((e) => e.type === "hitSold").length, 1);
  // gerade geprüft: kommt erst nach 30 Minuten wieder dran, verkaufte gar nicht mehr
  assert.equal(db.dueSaleChecks(10).length, 0);
  assert.equal(db.setSaleStatus(hits.find((h) => h.vintedId === "3")!.id, "sold"), null);
  await app.close();
});

test("My Charts: Verkäufe eintragen, auflisten und löschen", async () => {
  const db = openDb(":memory:");
  const app = createServer(db, { watcherToken: "t", allowedOrigins: [] });
  await new Promise<void>((r) => app.server.listen(0, r));
  const base = `http://localhost:${(app.server.address() as AddressInfo).port}/api/sales`;
  const post = (b: object) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  assert.equal((await post({ title: "", price: 10 })).status, 400);
  assert.equal((await post({ title: "Polo", price: -1 })).status, 400);
  const res = await post({ title: "Raf Simons bomber", price: 820, buyPrice: 340, country: "Deutschland", soldAt: "2026-10-01" });
  assert.equal(res.status, 201);
  const sale = await res.json();
  assert.equal(sale.buyPrice, 340);
  assert.equal((await (await fetch(base)).json()).length, 1);
  assert.equal((await fetch(`${base}/${sale.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await (await fetch(base)).json()).length, 0);
  await app.close();
});
