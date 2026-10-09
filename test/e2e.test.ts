import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { openDb } from "../src/db.ts";
import { createServer } from "../src/server.ts";
import { Watcher } from "../src/watcher.ts";
import { matches, type Listing, type Source } from "../src/sources/vinted.ts";
import type { Search, ServerMessage } from "../src/types.ts";

const listing = (id: string, price: number, size: string | null): Listing => ({
  id, title: `Nike Dunk Low ${id}`, price, currency: "EUR", size, brand: "Nike",
  url: `https://www.vinted.de/items/${id}`,
  photoUrls: [`https://img.example/${id}-1.jpg`],
});

test("matches: Preis und Größe", () => {
  const s: Search = { id: 1, query: "nike", minPrice: null, maxPrice: 80, size: "43", condition: null, kind: "standard", sources: [], active: true, createdAt: "" };
  assert.equal(matches(s, listing("1", 65, "43")), true);
  assert.equal(matches(s, listing("2", 85, "43")), false);
  assert.equal(matches(s, listing("3", 65, "42")), false);
  assert.equal(matches(s, listing("4", 65, "EU 43")), true);
  assert.equal(matches({ ...s, size: "M" }, listing("5", 50, "M / 38 / 10")), true);
  assert.equal(matches({ ...s, size: "42,5" }, listing("6", 50, "42.5")), true);
  assert.equal(matches({ ...s, minPrice: 60 }, listing("7", 50, "43")), false);
});

test("Watcher → Backend → Datenbank → WebSocket", async () => {
  const db = openDb(":memory:");
  const app = createServer(db, { watcherToken: "t", allowedOrigins: [] });
  await new Promise<void>((r) => app.server.listen(0, r));
  const base = `http://localhost:${(app.server.address() as AddressInfo).port}`;

  // Suchauftrag per API anlegen
  const created = await fetch(`${base}/api/searches`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "Nike Dunk", minPrice: 20, maxPrice: 80, size: "43", condition: "very_good" }),
  });
  assert.equal(created.status, 201);
  const createdSearch = await created.json();
  assert.equal(createdSearch.minPrice, 20);
  assert.equal(createdSearch.condition, "very_good");

  // Dashboard verbindet sich per WebSocket
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws`);
  const msgs: ServerMessage[] = [];
  ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
  await new Promise((r) => ws.once("open", r));

  // Gefälschte Datenquelle: erster Durchlauf = Bestand, zweiter = neue Listings
  let round = 0;
  const source: Source = {
    async photos(l) {
      return [...l.photoUrls, `https://img.example/${l.id}-2.jpg`, `https://img.example/${l.id}-3.jpg`, `https://img.example/${l.id}-4.jpg`].slice(0, 3);
    },
    async search() {
      round++;
      return round === 1
        ? [listing("100", 60, "43")]
        : [listing("101", 65, "43"), listing("102", 95, "43"), listing("103", 50, "41"), listing("100", 60, "43")];
    },
  };
  const w = new Watcher(source, base, "t", 60_000, () => {});
  w.gapMs = 0;
  assert.equal(await w.runOnce(), 0, "Bestand wird nicht gemeldet");
  assert.equal(await w.runOnce(), 1, "nur das neue, passende Listing");
  assert.equal(await w.runOnce(), 0, "keine Dubletten");

  await new Promise((r) => setTimeout(r, 100));
  const pushed = msgs.filter((m) => m.type === "hit");
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].type === "hit" && pushed[0].hit.vintedId, "101");
  assert.equal(db.listHits().length, 1);
  assert.deepEqual(db.listHits()[0].photoUrls, ["https://img.example/101-1.jpg", "https://img.example/101-2.jpg", "https://img.example/101-3.jpg"]);

  // Treffer im Monitor öffnen: danach nicht mehr verpasst
  const hitId = db.listHits()[0].id;
  assert.equal(db.listHits()[0].openedAt, null);
  const opened = await fetch(`${base}/api/hits/${hitId}/open`, { method: "POST" });
  assert.equal(opened.status, 200);
  assert.ok(db.listHits()[0].openedAt);

  // Ohne Token darf niemand Treffer einschleusen
  const bad = await fetch(`${base}/api/hits`, { method: "POST", body: "{}" });
  assert.equal(bad.status, 401);

  ws.close();
  await app.close();
});
