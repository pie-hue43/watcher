import { test } from "node:test";
import assert from "node:assert/strict";
import { VintedSource } from "../src/sources/vinted.ts";

// Nachgebaut nach dem Ablauf der Vinted-Website seit September 2026 (keine echten Antworten)
test("Vinted-Suche nutzt api.<domain>/svc-catalogue/items mit Session-Cookie und X-Anon-Id", async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const real = globalThis.fetch;
  let apiCalls = 0;
  globalThis.fetch = (async (url: string, init: any = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });
    if (String(url) === "https://www.vinted.de/") {
      const h = new Headers({ "x-anon-id": "anon-123" });
      h.append("set-cookie", "access_token_web=; Max-Age=-1; Domain=.www.vinted.de");
      h.append("set-cookie", "access_token_web=tok-abc; Max-Age=604800; Domain=.vinted.de");
      h.append("set-cookie", "anon_id=anon-123; Domain=.vinted.de");
      return new Response("<html></html>", { status: 200, headers: h });
    }
    apiCalls++;
    // erster Abruf: abgelaufen, zweiter: Treffer
    if (apiCalls === 1) return new Response('{"code":"FORBIDDEN"}', { status: 403 });
    return Response.json({ items: [{ id: 42, title: "Ralph Lauren Polo", price: { amount: "9.0", currency_code: "EUR" }, path: "/items/42-polo", brand_title: "Ralph Lauren", size_title: "M", photo: { url: "https://img/1.jpg" }, status: "Sehr gut" }] });
  }) as any;
  try {
    const src = new VintedSource("www.vinted.de");
    const hits = await src.search({ id: 1, query: "ralph lauren polo", maxPrice: 15, condition: "very_good" } as any);
    const api = calls.filter((c) => c.url.startsWith("https://api.vinted.de/svc-catalogue/items?"));
    assert.equal(api.length, 2);
    const u = new URL(api[1].url);
    assert.equal(u.searchParams.get("search_text"), "ralph lauren polo");
    assert.equal(u.searchParams.get("price_to"), "15");
    assert.equal(u.searchParams.get("attribute_ids[status]"), "6,1,2");
    assert.equal(api[1].headers.Cookie, "access_token_web=tok-abc; anon_id=anon-123");
    assert.equal(api[1].headers["X-Anon-Id"], "anon-123");
    assert.equal(api[1].headers.Origin, "https://www.vinted.de");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].url, "https://www.vinted.de/items/42-polo");
    assert.equal(hits[0].price, 9);
    assert.equal(hits[0].condition, "very_good");
  } finally {
    globalThis.fetch = real;
  }
});

test("Gesperrte Startseite pausiert statt Vinted weiter anzufragen", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("blocked", { status: 403 });
  }) as any;
  try {
    const { RateLimitError } = await import("../src/sources/vinted.ts");
    const src = new VintedSource("www.vinted.de");
    const q = { id: 1, query: "dior" } as any;
    await assert.rejects(src.search(q), RateLimitError);
    await assert.rejects(src.search(q), RateLimitError);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = real;
  }
});
