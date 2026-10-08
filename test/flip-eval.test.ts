import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// public/flip-eval.js ist ein Browser-Skript; hier in einer Sandbox laden
const ctx: any = { window: {} };
vm.runInNewContext(readFileSync(new URL("../public/flip-eval.js", import.meta.url), "utf8"), ctx);
const { evaluate, summarize } = ctx.window.watchrEval;

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
  assert.equal(e.verdict, "strong");
});

test("Flip-Auswertung: Stufen, Unsicherheit und fehlender Resellpreis", () => {
  assert.equal(evaluate(hit({ resaleEstimate: null })), null);
  assert.equal(evaluate(hit({ price: 180 })).verdict, "skip");
  assert.equal(evaluate(hit({ price: 160 })).verdict, "thin");
  assert.equal(evaluate(hit({ price: 150 })).verdict, "thin");
  assert.equal(evaluate(hit({ price: 130 })).verdict, "good");
  // wenige Vergleiche und schlechtester Fall im Minus -> eine Stufe vorsichtiger
  const unsure = evaluate(hit({ price: 115, resaleLow: 100, resaleSamples: 4 }));
  assert.equal(unsure.confidence, "low");
  assert.equal(unsure.verdict, "thin");
  const s = summarize([hit({}), hit({ price: 160 }), hit({ resaleEstimate: null })]);
  assert.equal(s.evaluated, 2);
  assert.equal(s.unpriced, 1);
  assert.equal(s.strong, 1);
  assert.equal(s.potential, 76.6); // 69,80 + 6,80
  assert.equal(s.ranked[0].e.verdict, "strong");
});
