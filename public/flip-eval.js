// Flip-Auswertung für einen Snipe: was der Kauf wirklich kostet, wofür er sich realistisch
// weiterverkaufen lässt, was netto übrig bleibt und wie sicher die Schätzung ist.
// Läuft im Browser (window.watchrEval) und in den Tests (module.exports).
(function (root) {
  const COSTS = {
    protectionFixed: 0.7, // Vinted-Käuferschutz: fester Anteil
    protectionRate: 0.05, // plus 5 % vom Artikelpreis
    shipping: 4.5, // typischer Versand zu dir
    saleDiscount: 0.9, // Verkauf meist ~10 % unter dem Angebotspreis (Preisvorschläge)
  };
  const r2 = (n) => Math.round(n * 100) / 100;

  function confidenceOf(h) {
    const n = h.resaleSamples || 0;
    const spread = h.resaleLow && h.resaleHigh && h.resaleEstimate ? (h.resaleHigh - h.resaleLow) / h.resaleEstimate : 1;
    if (n >= 20 && spread <= 0.5) return "high";
    if (n >= 10 && spread <= 0.9) return "medium";
    return "low";
  }

  const LEVELS = ["skip", "thin", "good", "strong"];
  const LABEL = { strong: "Strong flip", good: "Good flip", thin: "Thin margin", skip: "No flip" };

  function evaluate(h, costs = COSTS) {
    if (!h || !h.resaleEstimate || !(h.price > 0)) return null;
    const fee = r2(costs.protectionFixed + h.price * costs.protectionRate);
    const cost = r2(h.price + fee + costs.shipping);
    const sale = r2(h.resaleEstimate * costs.saleDiscount);
    const saleLow = r2((h.resaleLow || h.resaleEstimate) * costs.saleDiscount);
    const saleHigh = r2(h.resaleHigh || h.resaleEstimate);
    const profit = r2(sale - cost);
    const profitLow = r2(saleLow - cost);
    const profitHigh = r2(saleHigh - cost);
    const roi = Math.round((profit / cost) * 100);
    const confidence = confidenceOf(h);
    let level = profit >= 30 && roi >= 50 ? 3 : profit >= 10 && roi >= 20 ? 2 : profit > 0 ? 1 : 0;
    // unsichere Schätzung: eine Stufe vorsichtiger, außer der schlechteste Fall ist trotzdem im Plus
    if (confidence === "low" && level > 1 && profitLow <= 0) level -= 1;
    const verdict = LEVELS[level];
    const notes = [];
    if (profitLow > 0) notes.push("Profitable even at the low end of the price range.");
    else if (profit > 0) notes.push("Only profitable if it sells near the typical price.");
    if (confidence === "low") notes.push(`Based on only ${h.resaleSamples || "a few"} comparable listings, so treat it as a rough guide.`);
    if (h.archiveScore >= 70) notes.push("High archive score: rare pieces can sell well above the estimate.");
    return { fee, shipping: costs.shipping, cost, sale, saleLow, saleHigh, profit, profitLow, profitHigh, roi, confidence, verdict, label: LABEL[verdict], samples: h.resaleSamples || null, notes };
  }

  // Zusammenfassung über mehrere Snipes
  function summarize(hits) {
    const evals = hits.map((h) => ({ h, e: evaluate(h) })).filter((x) => x.e);
    const positive = evals.filter((x) => x.e.profit > 0);
    const count = (v) => evals.filter((x) => x.e.verdict === v).length;
    return {
      evaluated: evals.length,
      unpriced: hits.length - evals.length,
      potential: r2(positive.reduce((s, x) => s + x.e.profit, 0)),
      invest: r2(positive.reduce((s, x) => s + x.e.cost, 0)),
      avgRoi: positive.length ? Math.round(positive.reduce((s, x) => s + x.e.roi, 0) / positive.length) : null,
      strong: count("strong"),
      good: count("good"),
      thin: count("thin"),
      skip: count("skip"),
      ranked: evals.sort((a, b) => b.e.profit - a.e.profit),
    };
  }

  const api = { COSTS, evaluate, summarize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.watchrEval = api;
})(typeof window !== "undefined" ? window : globalThis);
