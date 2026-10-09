import { test } from "node:test";
import assert from "node:assert/strict";
import net, { type AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { openDb } from "../src/db.ts";
import { createServer } from "../src/server.ts";
import { Watcher } from "../src/watcher.ts";
import { FeeStore } from "../src/fees.ts";
import { FxRates } from "../src/fx.ts";
import { makeAdapters } from "../src/sources/index.ts";
import { catalog } from "../src/sources/catalog.ts";
import { parseMail } from "../src/alerts/mime.ts";
import { brandFromTitle } from "../src/pricing.ts";
import { parseAlertEmail } from "../src/sources/kleinanzeigen.ts";
import type { Listing, Source } from "../src/sources/vinted.ts";
import type { Hit } from "../src/types.ts";

const MAIL = readFileSync(new URL("./fixtures/kleinanzeigen-alert.eml", import.meta.url));

test("Kleinanzeigen-Suchauftrag-Mail wird korrekt gelesen", () => {
  const mail = parseMail(MAIL);
  assert.equal(mail.subject, 'Neue Anzeigen für deinen Suchauftrag "nike dunk"');
  assert.match(mail.from, /kleinanzeigen\.de/);
  const hits = parseAlertEmail(mail);
  assert.equal(hits.length, 2); // die dritte Anzeige hat keinen Preis (nur "VB")
  assert.deepEqual(
    hits.map((h) => [h.sourceId, h.title, h.price, h.location, h.url]),
    [
      ["2876543210", "Nike Dunk Low Panda Gr. 43 (VB)", 65, "10115 Berlin", "https://www.kleinanzeigen.de/s-anzeige/nike-dunk-low-panda-gr-43/2876543210"],
      ["2876999001", 'Nike Dunk High Retro "Michigan" 43', 1050, "80331 München", "https://www.kleinanzeigen.de/s-anzeige/nike-dunk-high-retro-43/2876999001"],
    ],
  );
  assert.equal(brandFromTitle(hits[0].title), "Nike");
  assert.equal(brandFromTitle("Vintage Levis 501 W32"), "Levi's");
  assert.equal(brandFromTitle("Raf Simons AW02 bomber"), "Raf Simons");
  assert.equal(brandFromTitle("Schöne Jacke"), null);
  assert.equal(hits[0].photoUrls[0], "https://img.kleinanzeigen.de/api/v1/prod-ads/images/aa/aa11-0001?rule=$_2.JPG");
  assert.equal(hits[0].source, "kleinanzeigen");
  assert.equal(hits[0].detectedAt, "2026-10-09T14:40:00.000Z");
  // nur Text, kein HTML: dieselben Angebote
  const textOnly = parseAlertEmail({ ...mail, html: "" });
  assert.deepEqual(textOnly.map((h) => [h.sourceId, h.price]), [["2876543210", 65], ["2876999001", 1050]]);
});

test("Such-Links übersetzen Filter so gut wie möglich und sagen, was fehlt", () => {
  const pref = { query: "nike dunk", minPrice: 20, maxPrice: 80, size: "43", condition: "new" as const };
  const ebay = catalog.searchLink("ebay", pref)!;
  assert.match(ebay.url, /^https:\/\/www\.ebay\.de\/sch\/i\.html\?_nkw=nike\+dunk&_sop=10&_udlo=20&_udhi=80&LH_ItemCondition=1000%7C1500/);
  assert.equal(ebay.note, "price and condition filter only");
  const ka = catalog.searchLink("kleinanzeigen", pref)!;
  assert.equal(ka.url, "https://www.kleinanzeigen.de/s-sortierung:neueste/preis:20:80/nike-dunk/k0");
  assert.equal(ka.note, "price filter only");
  assert.equal(catalog.searchLink("grailed", pref)!.note, "search words only");
  assert.equal(catalog.searchLink("grailed", { query: "raf simons" })!.note, "");
  // Japan: Preise in Yen umgerechnet (Ersatzkurs 172)
  assert.match(catalog.searchLink("mercari-jp", pref)!.url, /price_min=3440&price_max=13760/);
  assert.deepEqual(JSON.parse(JSON.stringify(catalog.expand([]))), ["vinted"]);
  assert.equal(catalog.expand(["all"]).length, catalog.IDS.length);
  assert.equal(catalog.byTag("#yahoojp"), "yahoo-auctions-jp");
});

test("Arbitrage: bester Verkaufsort mit Gebühren, Wechselkurs und Einfuhrabgaben", () => {
  const ctx: any = { window: {} };
  vm.runInNewContext(readFileSync(new URL("../public/platforms.js", import.meta.url), "utf8"), ctx);
  vm.runInNewContext(readFileSync(new URL("../public/flip-eval.js", import.meta.url), "utf8"), ctx);
  const { evaluate } = ctx.window.watchrEval;
  const base = { source: "vinted", price: 100, currency: "EUR", resaleEstimate: 200, resaleLow: 170, resaleHigh: 240, resaleSamples: 30 };

  // Designer-Teil: Grailed (Vinted × 1,5) schlägt Vinted trotz 9 % + 3,49 % + 0,49 $
  const e = evaluate({ ...base, archiveScore: 80 });
  assert.equal(e.bestSellOn.id, "grailed");
  const grailedFee = Math.round((270 * 0.1249 + Math.round((0.49 / 1.16) * 100) / 100) * 100) / 100;
  assert.equal(e.bestSellOn.net, Math.round((270 - grailedFee - 110.2) * 100) / 100); // +125,66 €
  assert.deepEqual(JSON.parse(JSON.stringify(e.targets.map((t: any) => t.id))), ["grailed", "vinted"]);
  assert.equal(e.targets[1].net, 69.8);
  // normales Teil: kein Preisfaktor, Vinted bleibt das Ziel, Zahlen wie bisher
  const plain = evaluate(base);
  assert.equal(plain.bestSellOn.id, "vinted");
  assert.equal(plain.profit, 69.8);
  // echte eBay-Vergleichspreise über der Vinted-Spanne, eBay-Gebühren noch nicht gesetzt -> Vinted bleibt bestes Ziel
  const withEbay = evaluate({ ...base, resaleBy: { ebay: { median: 300, low: 260, high: 340, samples: 40 } } });
  assert.equal(withEbay.bestSellOn.id, "vinted");
  assert.equal(withEbay.targets[0].id, "ebay");
  assert.equal(withEbay.targets[0].feesSet, false);

  // Kauf außerhalb der EU (Grailed, 100 $): Umrechnung, Standardversand 25 $, 19 % Einfuhrumsatzsteuer, unter 150 € kein Zoll
  const us = evaluate({ ...base, source: "grailed", currency: "USD" });
  const price = Math.round((100 / 1.16) * 100) / 100;
  const ship = Math.round((25 / 1.16) * 100) / 100;
  assert.equal(us.eu, false);
  assert.equal(us.duty, 0);
  assert.equal(us.vat, Math.round((price + ship) * 0.19 * 100) / 100);
  assert.equal(us.cost, Math.round((price + ship + us.vat) * 100) / 100);
  // über 150 €: 12 % Zoll, Steuer auch auf den Zoll
  const big = evaluate({ ...base, source: "grailed", currency: "USD", price: 400, resaleEstimate: 800, resaleLow: 700, resaleHigh: 900 });
  const value = Math.round((400 / 1.16) * 100) / 100 + ship;
  assert.equal(big.duty, Math.round(value * 0.12 * 100) / 100);
  assert.equal(big.vat, Math.round((value + big.duty) * 0.19 * 100) / 100);
  // Treffer aus einem EU-Land auf einer Nicht-EU-Plattform: keine Einfuhrabgaben
  assert.equal(evaluate({ ...base, source: "etsy", currency: "EUR", country: "FR" }).importTax, 0);
});

test("eBay: Browse API mit Schlüssel, sonst nur Such-Link", async () => {
  assert.equal(makeAdapters(source([]), {}).get("ebay")!.mode, "link");
  assert.equal(makeAdapters(source([]), {}).get("ebay")!.search, undefined);
  const calls: string[] = [];
  const ebay = makeAdapters(source([]), { EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret" }, fakeEbay(calls, () => [ebayItem("v1|111|0", "Nike Dunk Low Retro", 70)])).get("ebay")!;
  assert.equal(ebay.mode, "api");
  const hits = await ebay.search!({ query: "nike dunk", maxPrice: 80, condition: "new" });
  assert.equal(hits.length, 1);
  assert.deepEqual([hits[0].source, hits[0].sourceId, hits[0].price, hits[0].shipping, hits[0].country, hits[0].condition], ["ebay", "111", 70, 4.99, "DE", "new_tags"]);
  const search = new URL(calls.find((c) => c.includes("/item_summary/search"))!);
  assert.equal(search.searchParams.get("sort"), "newlyListed");
  assert.equal(search.searchParams.get("filter"), "buyingOptions:{FIXED_PRICE|BEST_OFFER},price:[..80],priceCurrency:EUR,conditionIds:{1000|1500}");
  assert.ok(calls[0].endsWith("/identity/v1/oauth2/token"));
});

test("#all: Vinted live, eBay per API, Kleinanzeigen aus der Alert inbox, Dubletten zusammengefasst", async (t) => {
  const db = openDb(":memory:");
  let vintedNow: Listing[] = [];
  let ebayNow: any[] = [];
  const vinted = source(() => vintedNow);
  const adapters = makeAdapters(vinted, { EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret" }, fakeEbay([], () => ebayNow));
  const app = createServer(db, { watcherToken: "t", allowedOrigins: [] }, null, { adapters, fees: new FeeStore(null), fx: new FxRates(null) });
  await new Promise<void>((r) => app.server.listen(0, r));
  t.after(() => app.close());
  const base = `http://localhost:${(app.server.address() as AddressInfo).port}`;
  const imap = await fakeImap(MAIL);
  t.after(() => imap.close());

  const created = await fetch(`${base}/api/searches`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "nike dunk", sources: ["all"] }) });
  assert.equal(created.status, 201);
  assert.deepEqual((await created.json()).sources, ["all"]);
  const bad = await fetch(`${base}/api/searches`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "x", sources: ["myspace"] }) });
  assert.equal(bad.status, 400);

  const w = new Watcher(vinted, base, "t", 1000, () => {}, null, adapters);
  w.gapMs = 0;
  w.hashPhotos = false;
  w.imap = { host: "127.0.0.1", port: imap.port, secure: false, user: "me@example.com", password: 'pa"ss' };
  assert.equal(await w.runOnce(), 0); // erster Durchlauf merkt nur
  vintedNow = [{ id: "5001", title: "Nike Dunk Low Panda 43", price: 60, currency: "EUR", size: "43", brand: "Nike", url: "https://www.vinted.de/items/5001", photoUrls: [] }];
  ebayNow = [ebayItem("v1|222|0", "Nike Dunk Low Retro White Black", 70)];
  assert.equal(await w.runOnce(), 2);

  const alerts = await w.checkAlerts();
  assert.deepEqual(alerts, { mails: 1, hits: 2, reported: 1 }); // Panda ist schon von Vinted da -> "Also on"
  assert.deepEqual(imap.seen, [7]); // Mail als gelesen markiert
  assert.deepEqual(await w.checkAlerts(), { mails: 0, hits: 0, reported: 0 });
  assert.equal(imap.logins[0], 'LOGIN "me@example.com" "pa\\"ss"');

  const hits: Hit[] = await (await fetch(`${base}/api/hits`)).json();
  const bySource = Object.fromEntries(hits.map((h) => [h.source, h]));
  assert.deepEqual(Object.keys(bySource).sort(), ["ebay", "kleinanzeigen", "vinted"]);
  assert.equal(bySource.ebay.shipping, 4.99);
  assert.ok(bySource.ebay.resaleBy?.ebay, "eBay-Vergleichspreise als zusätzliches Verkaufsziel");
  assert.equal(bySource.kleinanzeigen.title, 'Nike Dunk High Retro "Michigan" 43');
  assert.equal(bySource.kleinanzeigen.location, "80331 München");
  assert.deepEqual(bySource.vinted.alsoOn.map((a) => [a.source, a.price]), [["kleinanzeigen", 65]]);

  const info = await (await fetch(`${base}/api/sources`)).json();
  assert.equal(info.platforms.find((p: any) => p.id === "ebay").mode, "api");
  assert.equal(info.platforms.find((p: any) => p.id === "grailed").mode, "link");
  assert.ok(info.feesNotSet.includes("depop"));
  assert.ok(!info.feesNotSet.includes("vinted"));
  const fees = await (await fetch(`${base}/api/fees/depop`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sell: { rate: 0.1, paymentRate: 0.029, paymentFixed: 0.3 } }) })).json();
  assert.equal(fees.platforms.depop.sell.set, true);
  assert.equal(fees.platforms.depop.sell.rate, 0.1);
});

// ---------- Hilfen ----------
function source(list: Listing[] | (() => Listing[])): Source {
  return {
    search: async () => (typeof list === "function" ? list() : list),
    comparables: async () => Array.from({ length: 24 }, (_, i) => 90 + i * 3),
  };
}

function ebayItem(itemId: string, title: string, price: number) {
  const legacy = itemId.split("|")[1];
  return {
    itemId, legacyItemId: legacy, title, price: { value: String(price), currency: "EUR" }, conditionId: "1000", condition: "Neu mit Etikett",
    itemWebUrl: `https://www.ebay.de/itm/${legacy}`, image: { imageUrl: `https://i.ebayimg.com/${legacy}.jpg` },
    shippingOptions: [{ shippingCost: { value: "4.99", currency: "EUR" } }], itemLocation: { postalCode: "10*", country: "DE" },
  };
}

function fakeEbay(calls: string[], items: () => any[]): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith("/oauth2/token")) return Response.json({ access_token: "tok", expires_in: 7200 });
    const q = new URL(u).searchParams;
    // Vergleichspreise (ohne sort) vs. neue Angebote (sort=newlyListed)
    if (!q.get("sort")) return Response.json({ itemSummaries: Array.from({ length: 30 }, (_, i) => ({ price: { value: String(120 + i * 4), currency: "EUR" } })) });
    return Response.json({ itemSummaries: items() });
  }) as typeof fetch;
}

/** Winziger IMAP-Server für den Test: eine ungelesene Mail mit UID 7 */
async function fakeImap(raw: Buffer) {
  const state = { seen: [] as number[], logins: [] as string[] };
  const server = net.createServer((sock) => {
    sock.write("* OK test IMAP ready\r\n");
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const [tag, ...rest] = line.split(" ");
        const cmd = rest.join(" ");
        if (/^LOGIN/i.test(cmd)) state.logins.push(cmd);
        if (/^UID SEARCH UNSEEN FROM "kleinanzeigen\.de"/i.test(cmd)) sock.write(`* SEARCH${state.seen.includes(7) ? "" : " 7"}\r\n`);
        if (/^UID FETCH 7/i.test(cmd)) {
          sock.write(`* 1 FETCH (UID 7 BODY[] {${raw.length}}\r\n`);
          sock.write(raw);
          sock.write(")\r\n");
        }
        if (/^UID STORE 7 \+FLAGS/i.test(cmd)) state.seen.push(7);
        if (/^LOGOUT/i.test(cmd)) sock.write("* BYE\r\n");
        sock.write(`${tag} OK done\r\n`);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { ...state, get seen() { return state.seen; }, port: (server.address() as AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) };
}
