// Stock: Rechnungen und Aufgaben für gekaufte Teile (Kosten, Untergrenze, Preisplan, "Next up").
// Läuft im Browser (window.watchrStock) und im Backend/in den Tests (per vm geladen, wie flip-eval.js).
(function (root) {
  const DAY = 864e5;
  const DEFAULT_PLAN = { minProfit: 5, stepPercent: 10, everyDays: 7 };
  const STATUSES = ["bought", "arrived", "listed", "sold", "kept"];
  const STALE_DAYS = 14; // so lange ohne Verkauf, bis watchr Auffrischen oder eine Entscheidung vorschlägt
  const ARRIVAL_DAYS = 5;
  const r2 = (n) => Math.round(n * 100) / 100;
  const days = (from, now) => (from ? (now - Date.parse(from)) / DAY : 0);

  // Käuferschutz + Versand aus der bestehenden Flip-Rechnung
  function buyFees(price, costs) {
    const c = costs || (root.watchrEval && root.watchrEval.COSTS) || { protectionFixed: 0.7, protectionRate: 0.05, shipping: 4.5 };
    return r2(c.protectionFixed + price * c.protectionRate + c.shipping);
  }

  const totalCost = (it) => r2((Number(it.buyPrice) || 0) + (Number(it.buyFees) || 0));
  const floorOf = (it, minProfit) => Math.ceil(totalCost(it) + (minProfit ?? (it.pricePlan && it.pricePlan.minProfit) ?? DEFAULT_PLAN.minProfit));
  // Startpreis: obere Resell-Spanne, sonst Schätzung, sonst Kosten × 1,5; nie unter der Untergrenze
  function autoStart(it, floor) {
    const base = it.resaleHigh || it.resaleEstimate || totalCost(it) * 1.5;
    return Math.max(floor, Math.round(base));
  }

  // Ergänzt abgeleitete Werte (Untergrenze, Startpreis, Preis vor dem Einstellen)
  function normalize(it) {
    const plan = { ...DEFAULT_PLAN, ...(it.pricePlan || {}) };
    plan.minProfit = Math.max(0, Number(plan.minProfit) || 0);
    plan.stepPercent = Math.min(50, Math.max(1, Number(plan.stepPercent) || DEFAULT_PLAN.stepPercent));
    plan.everyDays = Math.min(60, Math.max(1, Math.round(Number(plan.everyDays) || DEFAULT_PLAN.everyDays)));
    plan.floor = floorOf(it, plan.minProfit);
    plan.start = plan.custom && plan.start > 0 ? Math.max(plan.floor, Math.round(plan.start)) : autoStart(it, plan.floor);
    const out = { ...it, pricePlan: plan };
    if (out.status === "bought" || out.status === "arrived" || out.price == null) out.price = plan.start;
    return out;
  }

  // Eine Stufe tiefer: um stepPercent senken, auf ganze Euro gerundet, mindestens 1 € weniger, nie unter floor
  function lower(price, plan) {
    let p = Math.round(price * (1 - plan.stepPercent / 100));
    if (p >= price) p = price - 1;
    return Math.max(plan.floor, p);
  }
  // Stufenleiste vom Start bis zur Untergrenze
  function ladder(it) {
    const plan = it.pricePlan;
    const steps = [plan.start];
    while (steps.length < 30 && steps[steps.length - 1] > plan.floor) steps.push(lower(steps[steps.length - 1], plan));
    return steps;
  }

  const lastPriceChange = (it) => {
    const h = it.priceHistory || [];
    return h.length ? h[h.length - 1].at : it.listedAt;
  };
  // Nächste vorgeschlagene Preisstufe (oder null), sobald everyDays seit der letzten Änderung vergangen sind
  function nextStep(it, now = Date.now()) {
    if (it.status !== "listed" || !(it.price > it.pricePlan.floor)) return null;
    const since = days(lastPriceChange(it), now);
    if (since < it.pricePlan.everyDays) return null;
    return { price: lower(it.price, it.pricePlan), floor: it.pricePlan.floor };
  }

  const expectedProfit = (it) => r2((it.status === "sold" ? it.soldPrice : it.price) - totalCost(it));
  const realProfit = (it) => (it.status === "sold" && it.soldPrice != null ? r2(it.soldPrice - totalCost(it)) : null);
  const hasListing = (it) => !!(it.listing && (it.listing.title || "").trim());

  // "Next up": eine Aufgabe pro Teil, sortiert nach Dringlichkeit
  function tasks(items, now = Date.now()) {
    const out = [];
    for (const it of items) {
      const t = taskFor(it, now);
      if (t) out.push({ ...t, item: it });
    }
    return out.sort((a, b) => a.rank - b.rank || a.since - b.since);
  }
  function taskFor(it, now) {
    if (it.status === "sold") {
      if (it.shippedAt) return null;
      return { kind: "ship", rank: 0, since: Date.parse(it.soldAt || 0), label: it.buyerCountry ? `Ship to ${it.buyerCountry}` : "Ship it" };
    }
    if (it.status === "arrived" && !hasListing(it)) return { kind: "write", rank: 1, since: Date.parse(it.arrivedAt || it.boughtAt), label: "Write the listing" };
    if (it.status === "bought" && days(it.boughtAt, now) > ARRIVAL_DAYS) return { kind: "arrived", rank: 2, since: Date.parse(it.boughtAt), label: "Has it arrived?" };
    if (it.status !== "listed") return null;
    const plan = it.pricePlan;
    const quiet = Math.min(days(lastPriceChange(it), now), days(it.floorAckAt, now) || Infinity);
    if (it.price <= plan.floor && quiet >= STALE_DAYS) return { kind: "floor", rank: 3, since: Date.parse(lastPriceChange(it)), label: "Floor reached: keep, bundle or move to another platform?" };
    const step = nextStep(it, now);
    if (step) return { kind: "price", rank: 4, since: Date.parse(lastPriceChange(it)), label: `Lower to ${eur(step.price)} (floor ${eur(step.floor)})`, price: step.price };
    const fresh = Math.max(Date.parse(it.listedAt || 0), Date.parse(it.refreshedAt || 0), Date.parse(it.floorAckAt || 0));
    if ((now - fresh) / DAY >= STALE_DAYS) return { kind: "refresh", rank: 5, since: fresh, label: "Refresh this listing" };
    return null;
  }

  const eur = (p) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: p % 1 ? 2 : 0 }).format(p);

  // Kennzahlen über den ganzen Bestand
  function summary(items, now = Date.now()) {
    const inStock = items.filter((it) => it.status !== "sold" && it.status !== "kept");
    const sold90 = items.filter((it) => it.status === "sold" && it.soldAt && days(it.soldAt, now) <= 90 && it.boughtAt);
    return {
      inStock: inStock.length,
      capital: r2(inStock.reduce((s, it) => s + totalCost(it), 0)),
      expected: r2(inStock.reduce((s, it) => s + (it.price - totalCost(it)), 0)),
      avgDays: sold90.length ? Math.round(sold90.reduce((s, it) => s + (Date.parse(it.soldAt) - Date.parse(it.boughtAt)) / DAY, 0) / sold90.length) : null,
    };
  }

  // Maße und Mängel als feste Zeilen in der Beschreibung
  const MEASURE = {
    en: { head: "Measurements (flat)", pitToPit: "pit to pit", length: "length", sleeve: "sleeve", waist: "waist", inseam: "inseam", flaws: "Flaws", none: "none known" },
    de: { head: "Maße (liegend)", pitToPit: "Achsel zu Achsel", length: "Länge", sleeve: "Ärmel", waist: "Bund", inseam: "Innenbein", flaws: "Mängel", none: "keine bekannt" },
  };
  function listingExtras(f, language) {
    const t = MEASURE[language === "en" ? "en" : "de"];
    const m = f.measurements || {};
    const parts = ["pitToPit", "length", "sleeve", "waist", "inseam"].filter((k) => Number(m[k]) > 0).map((k) => `${t[k]} ${Number(m[k])} cm`);
    const lines = [];
    if (parts.length) lines.push(`${t.head}: ${parts.join(", ")}`);
    if (f.flaws !== undefined) lines.push(`${t.flaws}: ${String(f.flaws || "").trim() || t.none}`);
    return lines;
  }

  function guessCategory(title) {
    const s = String(title || "");
    if (/sneaker|schuh|shoe|trainer|dunk|jordan|air max|boots?\b|stiefel|tabi|loafer/i.test(s)) return "Sneakers";
    if (/jacke|jacket|bomber|parka|coat|mantel|blazer|fleece|anorak|weste|\bvest|overshirt/i.test(s)) return "Jackets";
    if (/jeans|\b50[15]\b|hose|pants|trousers|cargo|shorts|chino/i.test(s)) return "Pants";
    if (/belt|gürtel|bag\b|tasche|wallet|\bcap\b|beanie|scarf|schal|\bring\b|necklace|sunglasses|watch\b/i.test(s)) return "Accessories";
    if (/shirt|hemd|sweater|pullover|hoodie|polo|\btop\b|knit|crewneck|cardigan|jersey|\btee\b/i.test(s)) return "Tops";
    return "Other";
  }

  const api = { DAY, DEFAULT_PLAN, STATUSES, STALE_DAYS, ARRIVAL_DAYS, buyFees, totalCost, floorOf, autoStart, normalize, lower, ladder, nextStep, lastPriceChange, expectedProfit, realProfit, hasListing, tasks, summary, listingExtras, guessCategory };
  root.watchrStock = api;
})(typeof window !== "undefined" ? window : globalThis);
