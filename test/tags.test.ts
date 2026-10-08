import { test } from "node:test";
import assert from "node:assert/strict";
import { keywordMatches, missingKeywords } from "../src/tags.ts";
import { matches, type Listing } from "../src/vinted.ts";
import type { Search } from "../src/types.ts";

const l = (title: string, brand: string | null = null, extra: Partial<Listing> = {}): Listing => ({
  id: "1", title, price: 50, currency: "EUR", size: "M", brand, url: "", photoUrls: [], ...extra,
});
const s: Search = { id: 1, query: "", minPrice: null, maxPrice: null, size: null, condition: null, kind: "standard", active: true, createdAt: "" };

test("jeder Hashtag muss zum Artikel passen", () => {
  assert.deepEqual(missingKeywords("#ralph #lauren #polo", l("Polo Ralph Lauren Poloshirt navy")), []);
  assert.deepEqual(missingKeywords("#ralph #lauren #polo #red", l("Polo Ralph Lauren Poloshirt navy")), ["red"]);
  assert.equal(matches({ ...s, query: "nike dunk" }, l("Nike Air Max 90")), false, "Vinted liefert auch lose Treffer");
  assert.equal(matches({ ...s, query: "nike dunk" }, l("Dunk Low Panda", "Nike")), true, "Marke zählt mit");
});

test("deutsch/englisch, Komposita und Designer-Kürzel", () => {
  assert.equal(keywordMatches("jacket", "Raf Simons Jacke schwarz"), true);
  assert.equal(keywordMatches("black", "Raf Simons Jacke schwarz"), true);
  assert.equal(keywordMatches("cdg", "Comme des Garçons Homme Plus blazer"), true);
  assert.equal(keywordMatches("ralphlauren", "Ralph Lauren polo"), true);
  assert.equal(keywordMatches("pullover", "Strick Kapuzenpullover"), true);
  assert.equal(keywordMatches("tee", "Steel toe boots"), false);
});

test("Mindestzustand wird geprüft, wenn Vinted ihn liefert", () => {
  const vg = { ...s, query: "prada", condition: "very_good" as const };
  assert.equal(matches(vg, l("Prada bag", null, { condition: "good" })), false);
  assert.equal(matches(vg, l("Prada bag", null, { condition: "new" })), true);
  assert.equal(matches(vg, l("Prada bag")), true, "unbekannter Zustand: Vinted-Filter gilt");
});
