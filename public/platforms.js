// Plattformen für den Live Sniper: Namen, Länder, Hashtags, Such-Links und Standard-Gebühren.
// Läuft im Browser (window.watchrPlatforms) und im Backend/in den Tests (per vm geladen, wie flip-eval.js).
// watchr liest neue Plattformen nur über offizielle Schnittstellen ("api"), über die eigenen
// Benachrichtigungs-Mails des Nutzers ("alert") oder als fertige Such-Links ("link"). Keine Scraper.
(function (root) {
  const enc = encodeURIComponent;
  const slug = (q) => q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const plus = (q) => q.trim().split(/\s+/).map(enc).join("+");
  const qs = (o) =>
    Object.entries(o)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}=${typeof v === "string" && v.includes("+") ? v : enc(v)}`)
      .join("&");

  // Vinted-Zustands-IDs wie im Backend
  const VINTED_STATUS = { new_tags: [6], new: [6, 1], very_good: [6, 1, 2], good: [6, 1, 2, 3] };

  // filters: welche Filter der Such-Link übernimmt (price, size, condition)
  const PLATFORMS = [
    {
      id: "vinted", name: "Vinted", country: "Germany", eu: true, currency: "EUR", mode: "api", tags: ["vinted"], filters: ["price", "condition"],
      url: (p) => {
        const parts = [qs({ search_text: p.query, order: "newest_first", price_from: p.minPrice, price_to: p.maxPrice })];
        for (const id of p.condition ? VINTED_STATUS[p.condition] : []) parts.push(`status_ids[]=${id}`);
        return "https://www.vinted.de/catalog?" + parts.join("&");
      },
    },
    {
      id: "ebay", name: "eBay", country: "Germany", eu: true, currency: "EUR", mode: "api", fallbackMode: "link", tags: ["ebay"], filters: ["price", "condition"],
      env: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
      url: (p) => {
        const cond = p.condition === "new_tags" ? "1000" : p.condition === "new" ? "1000|1500" : null;
        return "https://www.ebay.de/sch/i.html?" + qs({ _nkw: plus(p.query), _sop: 10, _udlo: p.minPrice, _udhi: p.maxPrice, LH_ItemCondition: cond, LH_BIN: 1 });
      },
    },
    {
      id: "kleinanzeigen", name: "Kleinanzeigen", country: "Germany", eu: true, currency: "EUR", mode: "alert", tags: ["kleinanzeigen"], filters: ["price"],
      senders: ["kleinanzeigen.de"],
      url: (p) => {
        const price = p.minPrice != null || p.maxPrice != null ? `preis:${p.minPrice ?? ""}:${p.maxPrice ?? ""}/` : "";
        return `https://www.kleinanzeigen.de/s-sortierung:neueste/${price}${slug(p.query) || "angebote"}/k0`;
      },
    },
    { id: "grailed", name: "Grailed", country: "US", eu: false, currency: "USD", mode: "link", tags: ["grailed"], filters: [], url: (p) => "https://www.grailed.com/shop?" + qs({ query: p.query }) },
    { id: "vestiaire", name: "Vestiaire Collective", country: "France", eu: true, currency: "EUR", mode: "link", tags: ["vestiaire", "vestiairecollective"], filters: [], url: (p) => "https://www.vestiairecollective.com/search/?" + qs({ q: p.query }) },
    {
      id: "depop", name: "Depop", country: "UK", eu: false, currency: "GBP", mode: "link", tags: ["depop"], filters: ["price"],
      url: (p) => "https://www.depop.com/search/?" + qs({ q: p.query, priceMin: p.minPrice, priceMax: p.maxPrice, sort: "newlyListed" }),
    },
    {
      id: "etsy", name: "Etsy", country: "worldwide", eu: false, currency: "USD", mode: "api", fallbackMode: "link", tags: ["etsy"], filters: ["price"],
      env: ["ETSY_API_KEY"],
      url: (p) => "https://www.etsy.com/search?" + qs({ q: p.query, min: p.minPrice, max: p.maxPrice, order: "date_desc" }),
    },
    {
      id: "willhaben", name: "willhaben", country: "Austria", eu: true, currency: "EUR", mode: "link", tags: ["willhaben"], filters: ["price"],
      url: (p) => "https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz?" + qs({ keyword: p.query, PRICE_FROM: p.minPrice, PRICE_TO: p.maxPrice, sort: 1 }),
    },
    {
      id: "marktplaats", name: "Marktplaats", country: "Netherlands", eu: true, currency: "EUR", mode: "link", tags: ["marktplaats"], filters: ["price"],
      url: (p) => {
        const hash = [p.minPrice != null && `PriceCentsFrom:${Math.round(p.minPrice * 100)}`, p.maxPrice != null && `PriceCentsTo:${Math.round(p.maxPrice * 100)}`, "sortBy:SORT_INDEX", "sortOrder:DECREASING"].filter(Boolean).join("|");
        return `https://www.marktplaats.nl/q/${plus(p.query)}/#${hash}`;
      },
    },
    {
      id: "leboncoin", name: "leboncoin", country: "France", eu: true, currency: "EUR", mode: "link", tags: ["leboncoin"], filters: ["price"],
      url: (p) => {
        const price = p.minPrice != null || p.maxPrice != null ? `${p.minPrice ?? "min"}-${p.maxPrice ?? "max"}` : null;
        return "https://www.leboncoin.fr/recherche?" + qs({ text: p.query, price, sort: "time", order: "desc" });
      },
    },
    {
      id: "wallapop", name: "Wallapop", country: "Spain", eu: true, currency: "EUR", mode: "link", tags: ["wallapop"], filters: ["price"],
      url: (p) => "https://es.wallapop.com/app/search?" + qs({ keywords: p.query, min_sale_price: p.minPrice, max_sale_price: p.maxPrice, order_by: "newest" }),
    },
    {
      id: "subito", name: "Subito", country: "Italy", eu: true, currency: "EUR", mode: "link", tags: ["subito"], filters: ["price"],
      url: (p) => "https://www.subito.it/annunci-italia/vendita/usato/?" + qs({ q: p.query, ps: p.minPrice, pe: p.maxPrice, order: "datedesc" }),
    },
    {
      id: "mercari-jp", name: "Mercari Japan", country: "Japan, via Buyee", eu: false, currency: "JPY", mode: "link", tags: ["mercari", "mercarijp", "mercari-jp"], filters: ["price"],
      url: (p) => "https://buyee.jp/mercari/search?" + qs({ keyword: p.query, price_min: p.minPrice, price_max: p.maxPrice, order: "desc", sort: "created_time" }),
    },
    {
      id: "yahoo-auctions-jp", name: "Yahoo Auctions Japan", country: "Japan, via Buyee", eu: false, currency: "JPY", mode: "link", tags: ["yahoo", "yahoojp", "yahooauctions", "yahoo-auctions-jp"], filters: ["price"],
      url: (p) => `https://buyee.jp/item/search/query/${enc(p.query)}?` + qs({ aucminprice: p.minPrice, aucmaxprice: p.maxPrice, sort: "end", order: "d" }),
    },
  ];
  const IDS = PLATFORMS.map((p) => p.id);
  const byId = (id) => PLATFORMS.find((p) => p.id === id) || null;
  // Hashtag -> Plattform-ID ("all" für alle)
  function byTag(word) {
    const t = String(word || "").replace(/^#+/, "").toLowerCase();
    if (t === "all" || t === "everywhere") return "all";
    const p = PLATFORMS.find((x) => x.tags.includes(t));
    return p ? p.id : null;
  }
  // ["all"] oder leere Liste -> konkrete IDs (leer = nur Vinted, wie bisher)
  const expand = (list) => (!list || !list.length ? ["vinted"] : list.includes("all") ? IDS.slice() : IDS.filter((id) => list.includes(id)));

  // EU-Länder: Käufe von dort sind ohne Einfuhrabgaben
  const EU = "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" ");
  function isEu(hit) {
    if (hit && hit.country) return EU.includes(String(hit.country).toUpperCase());
    const p = byId((hit && hit.source) || "vinted");
    return p ? p.eu : true;
  }

  const FALLBACK_FX = { base: "EUR", date: "2026-10-01", fallback: true, rates: { EUR: 1, USD: 1.16, GBP: 0.86, JPY: 172, CHF: 0.93, PLN: 4.25, SEK: 11, DKK: 7.46, CZK: 24.4, HUF: 390, CAD: 1.6, AUD: 1.76 } };
  // Betrag in Fremdwährung -> Euro; null, wenn der Kurs fehlt
  function toEur(amount, currency, fx) {
    if (amount == null) return null;
    const cur = (currency || "EUR").toUpperCase();
    if (cur === "EUR") return amount;
    const r = ((fx && fx.rates) || FALLBACK_FX.rates)[cur];
    return r ? Math.round((amount / r) * 100) / 100 : null;
  }
  function fromEur(amount, currency, fx) {
    if (amount == null) return null;
    const cur = (currency || "EUR").toUpperCase();
    if (cur === "EUR") return amount;
    const r = ((fx && fx.rates) || FALLBACK_FX.rates)[cur];
    return r ? Math.round(amount * r) : null;
  }

  /**
   * Such-Link für eine Präferenz ({ query, minPrice, maxPrice, size, condition }, Preise in Euro).
   * Preise werden in die Währung der Plattform umgerechnet. note sagt, welche Filter nicht übernommen wurden.
   */
  function searchLink(id, pref, fx) {
    const p = byId(id);
    if (!p) return null;
    const conv = (v) => (v == null ? null : fromEur(v, p.currency, fx));
    const priceOk = p.filters.includes("price") && (p.currency === "EUR" || conv(1) != null);
    const q = {
      query: String(pref.query || "").trim() || "archive",
      minPrice: priceOk ? conv(pref.minPrice ?? null) : null,
      maxPrice: priceOk ? conv(pref.maxPrice ?? null) : null,
      size: p.filters.includes("size") ? pref.size : null,
      condition: p.filters.includes("condition") ? pref.condition : null,
    };
    const wanted = [pref.minPrice != null || pref.maxPrice != null ? "price" : null, pref.size ? "size" : null, pref.condition ? "condition" : null].filter(Boolean);
    const kept = wanted.filter((f) => (f === "price" ? priceOk : p.filters.includes(f)));
    const note = !wanted.length || kept.length === wanted.length ? "" : kept.length ? `${kept.join(" and ")} filter only` : "search words only";
    return { id, name: p.name, country: p.country, url: p.url(q), note, currency: p.currency };
  }
  const buildSearchUrl = (id, pref, fx) => searchLink(id, pref, fx)?.url ?? null;

  // Standard-Gebühren. set: false = Platzhalter, watchr warnt mit "fees not set".
  // buy: Käuferschutz (fixed + rate × Preis) und Versand zu dir, in der Währung der Plattform
  // sell: Provision (rate), Zahlungsgebühr (paymentRate + paymentFixed in fixedCurrency)
  // priceFactor: Wiederverkaufswert = Vinted-Median × Faktor, für Plattformen ohne eigene Vergleichspreise (leer = aus).
  // Grailed startet mit 1,5 (grobe Annahme, im Live Sniper als "rough estimate" markiert).
  const placeholder = (shipping, currency = "EUR") => ({
    buy: { fixed: 0, rate: 0, shipping, currency, set: false },
    sell: { rate: 0, paymentRate: 0, paymentFixed: 0, fixedCurrency: currency, set: false },
    priceFactor: null,
  });
  const DEFAULT_FEES = {
    updatedAt: "2026-10-09T00:00:00.000Z",
    importVatRate: 0.19,
    dutyRate: 0.12,
    dutyFreeUpToEur: 150,
    platforms: {
      vinted: { buy: { fixed: 0.7, rate: 0.05, shipping: 4.5, currency: "EUR", set: true }, sell: { rate: 0, paymentRate: 0, paymentFixed: 0, fixedCurrency: "EUR", set: true }, priceFactor: null },
      ebay: placeholder(5),
      kleinanzeigen: placeholder(5),
      grailed: { buy: { fixed: 0, rate: 0, shipping: 25, currency: "USD", set: false }, sell: { rate: 0.09, paymentRate: 0.0349, paymentFixed: 0.49, fixedCurrency: "USD", set: true }, priceFactor: 1.5 },
      vestiaire: placeholder(10),
      depop: placeholder(15, "GBP"),
      etsy: placeholder(15, "USD"),
      willhaben: placeholder(6),
      marktplaats: placeholder(8),
      leboncoin: placeholder(8),
      wallapop: placeholder(10),
      subito: placeholder(10),
      "mercari-jp": placeholder(4500, "JPY"),
      "yahoo-auctions-jp": placeholder(4500, "JPY"),
    },
  };
  // Ergänzt fehlende Plattformen/Felder mit den Standardwerten
  function mergeFees(saved) {
    const out = JSON.parse(JSON.stringify(DEFAULT_FEES));
    if (!saved || typeof saved !== "object") return out;
    for (const k of ["updatedAt", "importVatRate", "dutyRate", "dutyFreeUpToEur"]) if (saved[k] != null) out[k] = saved[k];
    for (const id of IDS) {
      const s = saved.platforms && saved.platforms[id];
      if (!s) continue;
      out.platforms[id] = { buy: { ...out.platforms[id].buy, ...(s.buy || {}) }, sell: { ...out.platforms[id].sell, ...(s.sell || {}) }, priceFactor: s.priceFactor ?? out.platforms[id].priceFactor };
    }
    return out;
  }
  const feesSet = (fees, id) => {
    const f = fees.platforms[id];
    return !!(f && f.buy.set && f.sell.set);
  };

  // Gebühren und Kurse vom Backend für flip-eval.js laden (ohne Backend gelten die Standardwerte)
  function loadContext(backend) {
    const get = (path) => fetch(backend + path).then((r) => (r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : Promise.reject()));
    return Promise.all([get("/api/fees"), get("/api/fx")]).then(
      ([fees, fx]) => {
        root.watchrEval && root.watchrEval.setContext({ fees, fx });
        return { fees, fx };
      },
      () => null,
    );
  }

  const api = { loadContext, PLATFORMS, IDS, EU, isEu, byId, byTag, expand, searchLink, buildSearchUrl, toEur, fromEur, FALLBACK_FX, DEFAULT_FEES, mergeFees, feesSet };
  root.watchrPlatforms = api;
})(typeof window !== "undefined" ? window : globalThis);
