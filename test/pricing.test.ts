import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PriceEstimator, productKey, robustStats } from "../src/pricing.ts";
import { archiveScore, findDesigner } from "../src/designers.ts";
import { openDb } from "../src/db.ts";
import { createServer } from "../src/server.ts";
import { Watcher } from "../src/watcher.ts";
import type { Listing, Source } from "../src/vinted.ts";

test("productKey fasst gleiche Produkte zusammen", () => {
  assert.deepEqual(productKey({ title: "Ralph Lauren Polo Shirt blau M", brand: "Ralph Lauren" }), { key: "ralph lauren|polo", query: "ralph lauren polo" });
  assert.equal(productKey({ title: "Polo Ralph Lauren Poloshirt grün", brand: "Ralph Lauren" })!.key, "ralph lauren|polo");
  assert.equal(productKey({ title: "Raf Simons hoodie AW02", brand: null })!.key, "raf simons|hoodie");
  assert.equal(productKey({ title: "Shirt", brand: null }), null);
});

test("robustStats ignoriert Ausreißer", () => {
  assert.equal(robustStats([10, 20, 30]), null);
  const s = robustStats([1, 30, 32, 35, 35, 36, 38, 40, 42, 900])!;
  assert.equal(s.median, 36); // (35 + 36) / 2 gerundet
  assert.ok(s.low >= 30 && s.high <= 42);
});

test("PriceEstimator: ein Wert pro Produkt, zwischengespeichert", async () => {
  let calls = 0;
  const file = join(mkdtempSync(join(tmpdir(), "watchr-")), "cache.json");
  const est = new PriceEstimator(async () => (calls++, [30, 35, 38, 40, 40, 42, 45, 50]), file);
  const a = await est.estimate({ title: "Ralph Lauren Polo rot", brand: "Ralph Lauren" });
  const b = await est.estimate({ title: "Polo Ralph Lauren Slim Fit", brand: "Ralph Lauren" });
  assert.equal(calls, 1);
  assert.equal(a!.median, 40);
  assert.deepEqual(a, b);
  // neuer Prozess liest den gespeicherten Wert, ohne erneut zu fragen
  const again = new PriceEstimator(async () => (calls++, []), file);
  assert.equal((await again.estimate({ title: "Ralph Lauren polo", brand: "Ralph Lauren" }))!.median, 40);
  assert.equal(calls, 1);
});

test("archiveScore bevorzugt Archiv-Designer", () => {
  assert.equal(findDesigner("vintage Maison Martin Margiela tabi")!.name, "Maison Margiela");
  const grail = archiveScore({ title: "Raf Simons AW02 Virginia Creeper archive bomber", brand: "Raf Simons", price: 400 }, 1200);
  assert.ok(grail.score >= 90, `score ${grail.score}`);
  assert.equal(grail.designer, "Raf Simons");
  assert.equal(archiveScore({ title: "H&M T-Shirt", brand: "H&M", price: 5 }).score, 0);
  assert.ok(archiveScore({ title: "Stone Island Pullover", brand: "Stone Island", price: 80 }).score < 50);
});

test("#archive-Suche: Designer reihum, nur hoher Score, mit Resellpreis", async () => {
  const db = openDb(":memory:");
  const app = createServer(db, { watcherToken: "t", allowedOrigins: [] });
  await new Promise<void>((r) => app.server.listen(0, r));
  const base = `http://localhost:${(app.server.address() as AddressInfo).port}`;

  const created = await fetch(`${base}/api/searches`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "", kind: "archive" }),
  });
  assert.equal(created.status, 201, "Archive-Suche braucht keine Stichwörter");
  const noKeyword = await fetch(`${base}/api/searches`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "" }) });
  assert.equal(noKeyword.status, 400);

  const queries: string[] = [];
  let round = 0;
  const l = (id: string, title: string, brand: string, price: number): Listing =>
    ({ id, title, brand, price, currency: "EUR", size: null, url: `https://www.vinted.de/items/${id}`, photoUrls: [] });
  const source: Source = {
    async search(s) {
      queries.push(s.query);
      if (s.query !== "Raf Simons") return [];
      round++;
      return round === 1 ? [] : [l("1", "Raf Simons archive AW03 parka", "Raf Simons", 350), l("2", "Pullover", "Zara", 10)];
    },
    async comparables() {
      return [700, 800, 850, 900, 950, 1000, 1100];
    },
  };
  const w = new Watcher(source, base, "t", 60_000, () => {});
  w.gapMs = 0;
  for (let i = 0; i < 15; i++) await w.runOnce(); // einmal komplett durch die Designerliste und wieder bei Raf Simons
  assert.equal(queries.filter((q) => q === "Raf Simons").length >= 2, true);
  const hits = db.listHits();
  assert.equal(hits.length, 1);
  assert.equal(hits[0].designer, "Raf Simons");
  assert.equal(hits[0].resaleEstimate, 900);
  assert.ok(hits[0].archiveScore! >= 50);

  await app.close();
});
