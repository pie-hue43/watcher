import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// public/flip-eval.js ist ein Browser-Skript; hier in einer Sandbox laden
const ctx: any = { window: {} };
vm.runInNewContext(readFileSync(new URL("../public/flip-eval.js", import.meta.url), "utf8"), ctx);
const { evaluate, summarize, qualifies } = ctx.window.watchrEval;

const hit = (o: object) => ({ price: 100, resaleEstimate: 200, resaleLow: 170, resaleHigh: 240, resaleSamples: 30, ...o });

test("Flip-Auswertung rechnet Gebühren, Versand und realistischen Verkaufspreis ein", () => {
  const e = evaluate(hit({}));
  assert.equal(e.fee, 5.7); // 0,70 + 5 %
  assert.equal(e.cost, 110.2); // 100 + 5,70 + 4,50
  assert.equal(e.sale, 180); // Median −10 %
  assert.equal(e.profit, 69.8);
  assert.equal(e.profitLow, 42.8);
  assert.equal(e.profitHigh, 129.8);
  assert.equal(e.roi, 63);
  assert.equal(e.confidence, "high");
  assert.equal(e.verdict, "epic"); // +69,80 € bei 63 %
  assert.equal(evaluate(hit({ price: 60, resaleEstimate: 250 })).verdict, "legendary");
});

test("Flip-Auswertung: Stufen, Unsicherheit und fehlender Resellpreis", () => {
  assert.equal(evaluate(hit({ resaleEstimate: null })), null);
  // unter 20 % geschätzter Rendite: keine Stufe, wird nicht angezeigt
  assert.equal(evaluate(hit({ price: 180 })).verdict, null);
  assert.equal(qualifies(hit({ price: 160 })), false); // +6,80 € = 4 %
  assert.equal(qualifies(hit({ resaleEstimate: null })), false);
  assert.equal(evaluate(hit({ price: 140 })).verdict, null); // +27,80 € = 18 %
  assert.equal(evaluate(hit({ price: 130 })).verdict, "good"); // 27 %
  assert.equal(evaluate(hit({ price: 110 })).verdict, "rare"); // 49 %
  // wenige Vergleiche und schlechtester Fall im Minus -> eine Stufe vorsichtiger
  const unsure = evaluate(hit({ price: 115, resaleLow: 100, resaleSamples: 4 }));
  assert.equal(unsure.confidence, "low");
  assert.equal(unsure.verdict, "good");
  const s = summarize([hit({}), hit({ price: 130 }), hit({ price: 160 }), hit({ resaleEstimate: null })]);
  assert.equal(s.evaluated, 2); // nur die mit 20 %+
  assert.equal(s.byRarity.epic, 1);
  assert.equal(s.byRarity.good, 1);
  assert.equal(s.potential, 108.1); // 69,80 + 38,30
  assert.equal(s.ranked[0].e.verdict, "epic");
});
