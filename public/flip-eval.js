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

  // Seltenheitsstufen wie in Games: Good bis Legendary. Unter MIN_ROI wird ein Snipe gar nicht gezeigt.
  const MIN_ROI = 20;
  const LEVELS = ["good", "rare", "epic", "legendary"];
  const LABEL = { good: "Good", rare: "Rare", epic: "Epic", legendary: "Legendary", archive: "Archive" };
  const FILTERS = [...LEVELS, "archive"]; // Auswahl im Live Sniper

  // Gebühren und Wechselkurse: Standardwerte aus platforms.js, im Browser per setContext mit den Werten vom Backend
  const P = () => root.watchrPlatforms || null;
  let context = null;
  function setContext(c) {
    context = c;
  }
  const ctxOf = (c) => {
    const base = c || context || {};
    const p = P();
    return { fees: base.fees || (p ? p.DEFAULT_FEES : null), fx: base.fx || (p ? p.FALLBACK_FX : null) };
  };
  const rateOf = (fx, cur) => (cur === "EUR" ? 1 : fx && fx.rates && fx.rates[cur]) || null;
  const eurOf = (v, cur, fx) => {
    const r = rateOf(fx, (cur || "EUR").toUpperCase());
    return v == null || !r ? null : r2(v / r);
  };
  // Teile ab diesem Archive-Score bekommen auch Verkaufsziele mit Preisfaktor (z. B. Grailed)
  const FACTOR_MIN_SCORE = 50;

  // Was der Kauf in Euro kostet: Preis, Käuferschutz, Versand, Umrechnung und bei Nicht-EU Einfuhrabgaben
  function buyCost(h, fees, fx, legacy) {
    const src = h.source || "vinted";
    const pf = fees && fees.platforms[src];
    const plat = P() && P().byId(src);
    if (legacy || !pf) {
      const c = legacy || COSTS;
      const fee = r2(c.protectionFixed + h.price * c.protectionRate);
      return { fee, shipping: c.shipping, priceEur: h.price, rate: 1, duty: 0, vat: 0, importTax: 0, cost: r2(h.price + fee + c.shipping), eu: true, feesSet: true };
    }
    const cur = (h.currency || (plat && plat.currency) || "EUR").toUpperCase();
    const priceEur = eurOf(h.price, cur, fx);
    if (priceEur == null) return null;
    const fee = r2((eurOf(pf.buy.fixed, pf.buy.currency, fx) || 0) + priceEur * pf.buy.rate);
    const shipping = h.shipping != null ? eurOf(h.shipping, cur, fx) ?? 0 : eurOf(pf.buy.shipping, pf.buy.currency, fx) || 0;
    const eu = h.eu != null ? !!h.eu : P() ? P().isEu(h) : true;
    let duty = 0;
    let vat = 0;
    if (!eu) {
      const value = priceEur + shipping;
      duty = value > fees.dutyFreeUpToEur ? r2(value * fees.dutyRate) : 0;
      vat = r2((value + duty) * fees.importVatRate);
    }
    const importTax = r2(duty + vat);
    return { fee, shipping: r2(shipping), priceEur, rate: rateOf(fx, cur), currency: cur, duty, vat, importTax, cost: r2(priceEur + fee + shipping + importTax), eu, feesSet: pf.buy.set };
  }

  // Wiederverkaufswerte je Ziel: eigene Vergleichspreise (Vinted, eBay/Etsy per API) oder Vinted × Preisfaktor
  function resaleTargets(h, fees) {
    const by = { ...(h.resaleBy || {}) };
    if (!by.vinted && h.resaleEstimate) by.vinted = { median: h.resaleEstimate, low: h.resaleLow, high: h.resaleHigh, samples: h.resaleSamples };
    const out = Object.entries(by)
      .filter(([, r]) => r && r.median > 0)
      .map(([id, r]) => ({ id, median: r.median, low: r.low || r.median, high: r.high || r.median, samples: r.samples || null, basis: "comparables" }));
    const v = by.vinted;
    if (fees && v && v.median > 0 && (h.archiveScore || 0) >= FACTOR_MIN_SCORE)
      for (const [id, f] of Object.entries(fees.platforms))
        if (f.priceFactor > 0 && !by[id]) out.push({ id, median: r2(v.median * f.priceFactor), low: r2((v.low || v.median) * f.priceFactor), high: r2((v.high || v.median) * f.priceFactor), samples: v.samples || null, basis: "factor", factor: f.priceFactor });
    return out;
  }

  function evaluate(h, c) {
    if (!h || !(h.price > 0)) return null;
    const legacy = c && c.protectionFixed != null ? c : null; // alte Signatur evaluate(hit, COSTS)
    const { fees, fx } = legacy ? { fees: null, fx: null } : ctxOf(c);
    const buy = buyCost(h, fees, fx, legacy);
    if (!buy) return null;
    const disc = (legacy || COSTS).saleDiscount;
    const targets = (legacy ? resaleTargets(h, null).filter((t) => t.id === "vinted") : resaleTargets(h, fees)).map((t) => {
      const pf = fees && fees.platforms[t.id];
      const sell = pf ? pf.sell : { rate: 0, paymentRate: 0, paymentFixed: 0, fixedCurrency: "EUR", set: true };
      const feeAt = (sale) => r2(sale * (sell.rate + sell.paymentRate) + (sell.paymentFixed ? eurOf(sell.paymentFixed, sell.fixedCurrency, fx) || 0 : 0));
      const sale = r2(t.median * disc);
      const saleLow = r2(t.low * disc);
      const saleHigh = r2(t.high);
      const sellFee = feeAt(sale);
      const plat = P() && P().byId(t.id);
      return {
        ...t, name: plat ? plat.name : t.id, sale, saleLow, saleHigh, sellFee,
        net: r2(sale - sellFee - buy.cost), netLow: r2(saleLow - feeAt(saleLow) - buy.cost), netHigh: r2(saleHigh - feeAt(saleHigh) - buy.cost),
        feesSet: !!sell.set,
      };
    });
    if (!targets.length) return null;
    targets.sort((a, b) => b.net - a.net);
    // Bestes Ziel: nur Plattformen mit eingetragenen Verkaufsgebühren, sonst das beste überhaupt
    const best = targets.find((t) => t.feesSet) || targets[0];
    const conf = confidenceOf({ resaleSamples: best.samples, resaleLow: best.low, resaleHigh: best.high, resaleEstimate: best.median });
    const confidence = best.basis === "factor" ? "low" : conf;
    const profit = best.net;
    const profitLow = best.netLow;
    const profitHigh = best.netHigh;
    const cost = buy.cost;
    const roi = Math.round((profit / cost) * 100);
    let level = profit >= 100 && roi >= 80 ? 3 : profit >= 30 && roi >= 50 ? 2 : profit >= 15 && roi >= 30 ? 1 : 0;
    // unsichere Schätzung: eine Stufe vorsichtiger, außer der schlechteste Fall ist trotzdem im Plus
    if (confidence === "low" && level > 0 && profitLow <= 0) level -= 1;
    const qualifies = profit > 0 && roi >= MIN_ROI;
    const verdict = qualifies ? LEVELS[level] : null;
    const notes = [];
    if (profitLow > 0) notes.push("Profitable even at the low end of the price range.");
    else if (profit > 0) notes.push("Only profitable if it sells near the typical price.");
    if (best.basis === "factor") notes.push(`The ${best.name} price is a rough estimate: the Vinted price × ${best.factor}.`);
    else if (confidence === "low") notes.push(`Based on only ${best.samples || "a few"} comparable listings, so treat it as a rough guide.`);
    if (!buy.eu) notes.push(`Bought outside the EU: includes ${Math.round(fees.importVatRate * 100)}% import VAT${buy.duty ? ` and ${Math.round(fees.dutyRate * 100)}% customs duty` : ` (no customs duty up to €${fees.dutyFreeUpToEur})`}.`);
    if (!buy.feesSet) notes.push(`Buying fees for ${(P() && P().byId(h.source || "vinted") || {}).name || h.source} are not set yet, so the cost uses rough defaults.`);
    if (h.archiveScore >= 70) notes.push("High archive score: rare pieces can sell well above the estimate.");
    return {
      fee: buy.fee, shipping: buy.shipping, priceEur: buy.priceEur, currency: buy.currency || "EUR", rate: buy.rate, eu: buy.eu, duty: buy.duty, vat: buy.vat, importTax: buy.importTax, buyFeesSet: buy.feesSet,
      cost, sale: best.sale, saleLow: best.saleLow, saleHigh: best.saleHigh, sellFee: best.sellFee, profit, profitLow, profitHigh, roi, confidence, verdict, qualifies,
      label: verdict ? LABEL[verdict] : null, samples: best.samples, notes,
      bestSellOn: { id: best.id, name: best.name, net: best.net, basis: best.basis, feesSet: best.feesSet }, targets,
    };
  }

  // Seltene Archive-Teile (hoher Archive-Score vom Bot) werden immer gezeigt, auch ohne 20 % Rendite
  // oder ohne Vergleichspreise. Sie bekommen dann die eigene Stufe „Archive“.
  const ARCHIVE_MIN = 65;
  const isArchive = (h) => !!h && (h.archiveScore || 0) >= ARCHIVE_MIN;
  function rarity(h) {
    const e = evaluate(h);
    if (e && e.qualifies) return e.verdict;
    return isArchive(h) ? "archive" : null;
  }

  // Angezeigt wird: mindestens MIN_ROI % geschätzte Rendite oder ein seltenes Archive-Teil
  function qualifies(h) {
    return rarity(h) !== null;
  }

  // Zusammenfassung über mehrere (angezeigte) Snipes
  function summarize(hits) {
    const evals = hits.map((h) => ({ h, e: evaluate(h) })).filter((x) => x.e && x.e.qualifies);
    const positive = evals.filter((x) => x.e.profit > 0);
    const count = (v) => evals.filter((x) => x.e.verdict === v).length;
    const byRarity = Object.fromEntries(LEVELS.map((v) => [v, count(v)]));
    return {
      evaluated: evals.length,
      potential: r2(positive.reduce((s, x) => s + x.e.profit, 0)),
      invest: r2(positive.reduce((s, x) => s + x.e.cost, 0)),
      avgRoi: positive.length ? Math.round(positive.reduce((s, x) => s + x.e.roi, 0) / positive.length) : null,
      byRarity,
      ranked: evals.sort((a, b) => b.e.profit - a.e.profit),
    };
  }

  const api = { COSTS, MIN_ROI, FACTOR_MIN_SCORE, setContext, buyCost: (h, c) => { const x = ctxOf(c); return buyCost(h, x.fees, x.fx, null); }, ARCHIVE_MIN, LEVELS, FILTERS, LABEL, evaluate, isArchive, rarity, qualifies, summarize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.watchrEval = api;
})(typeof window !== "undefined" ? window : globalThis);
