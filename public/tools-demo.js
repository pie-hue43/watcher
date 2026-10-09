// Vorschau ohne watchr-Backend: Die Tools zeigen hier Beispieldaten statt einer Fehlermeldung.
// Sobald watchr mit npm start läuft, kommen die echten Daten vom Server und diese Datei wird nicht benutzt.
(() => {
  const now = Date.now();
  const ago = (min) => new Date(now - min * 60_000).toISOString();
  const pic = (label) =>
    "data:image/svg+xml," +
    encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 46 46"><rect width="46" height="46" rx="8" fill="#e7f8ee"/><text x="23" y="28" font-family="sans-serif" font-size="11" font-weight="700" text-anchor="middle" fill="#15803d">${label}</text></svg>`);
  const hit = (id, title, brand, size, price, resale, min) => ({
    id, vintedId: String(id), title, brand, size, price, currency: "EUR", resaleEstimate: resale, detectedAt: ago(min),
    url: `https://www.vinted.de/items/${id}`, photoUrls: [pic(brand.split(" ")[0].slice(0, 5))],
  });
  const HITS = [
    hit(4815162301, "Raf Simons AW02 bomber jacket", "Raf Simons", "M", 340, 900, 3),
    hit(4815162302, "Helmut Lang 1999 bondage jeans", "Helmut Lang", "W31", 120, 260, 18),
    hit(4815162303, "Ralph Lauren polo, navy", "Ralph Lauren", "L", 14, 30, 42),
    hit(4815162304, "Maison Margiela Tabi boots", "Maison Margiela", "41", 210, 380, 65),
    hit(4815162305, "Stone Island crewneck knit", "Stone Island", "L", 85, 140, 120),
    hit(4815162306, "Prada nylon shoulder bag", "Prada", null, 160, 290, 190),
  ];
  const round = (n) => Math.round(n);

  // Wie im Backend: Marke aus der Beschreibung lesen
  const TYPES = [[/\bpolo/i, "polo"], [/\bhoodie/i, "hoodie"], [/\bt-?shirt|\btee\b/i, "t-shirt"], [/\bshirt|\bhemd/i, "shirt"], [/\bpullover|\bsweater|\bknit|\bjumper/i, "sweater"],
    [/\bjacke|\bjacket|\bbomber|\bparka/i, "jacket"], [/\bmantel|\bcoat/i, "coat"], [/\bjeans|\bhose|\bpants|\btrousers/i, "pants"], [/\bschuhe|\bshoes|\bsneaker|\bboots/i, "shoes"], [/\bbag|\btasche/i, "bag"]];
  const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  const CONDITION_DE = { "New with tags": "Neu mit Etikett", "New without tags": "Neu ohne Etikett", "Very good": "Sehr gut", Good: "Gut", Satisfactory: "Zufriedenstellend" };
  const DESIGNERS = ["raf simons", "helmut lang", "rick owens", "maison margiela", "prada", "comme des garcons", "yohji yamamoto", "jean paul gaultier", "stone island", "dior", "gucci", "balenciaga"];

  function filters(text) {
    let t = ` ${text.toLowerCase()} `;
    const take = (re) => { const m = t.match(re); if (m) t = t.replace(m[0], " "); return m; };
    const between = take(/(?:between|zwischen)\s*€?\s*(\d+)\s*(?:€|eur|euro)?\s*(?:and|und|-|bis)\s*€?\s*(\d+)/);
    const max = between ? null : take(/(?:under|below|max|unter|bis|höchstens)\s*€?\s*(\d+)/);
    const min = between ? null : take(/(?:over|above|min|über|ab|mindestens)\s*€?\s*(\d+)/);
    const size = take(/(?:size|größe|grösse|gr\.?)\s*(\d+(?:[.,]\d)?|[a-z0-9/]+)/) ?? take(/\b(xxs|xs|s|m|l|xl|xxl)\b/);
    const conds = [[/new with tags|mit etikett|nwt/, "new_tags", "#newtags"], [/\bnew\b|\bneu\b/, "new", "#new"], [/very good|sehr gut|like new|wie neu/, "very_good", "#verygood"], [/\bgood\b|\bgut\b/, "good", "#good"]];
    const c = conds.find(([re]) => take(re));
    const archive = !!take(/\b(archive|archiv|grail|runway|rare|selten)\b/);
    const designer = DESIGNERS.find((d) => t.includes(d));
    if (designer) t = t.replace(designer, " ");
    const stop = new Set("a an the in im for für mit with and und or oder i want ich suche looking search find me some ein eine einen der die das von from to zu condition zustand size größe price preis".split(" "));
    const words = t.replace(/[€$.,!?]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !stop.has(w) && !/^\d+$/.test(w)).slice(0, 4);
    const keywords = [...(designer ? [designer.replace(/\b\w/g, (x) => x.toUpperCase())] : []), ...words];
    const minPrice = between ? +between[1] : min ? +min[1] : null;
    const maxPrice = between ? +between[2] : max ? +max[1] : null;
    const tags = [archive && !designer ? "#archive" : null, ...keywords.map((k) => "#" + k.replace(/\s+/g, "")), size ? "#size" + size[1].toUpperCase() : null,
      minPrice ? "#min" + minPrice : null, maxPrice ? "#max" + maxPrice : null, c ? c[2] : null].filter(Boolean);
    const p = new URLSearchParams({ search_text: keywords.join(" "), order: "newest_first" });
    if (minPrice) p.set("price_from", String(minPrice));
    if (maxPrice) p.set("price_to", String(maxPrice));
    return { tags, vintedUrl: `https://www.vinted.de/catalog?${p}`, ai: false };
  }

  let tracked = [
    { id: 1, vintedId: "4815162311", title: "Rick Owens Geobasket sneakers", seller: "archive.berlin", price: 260, currency: "EUR", status: "active", url: "https://www.vinted.de/items/4815162311", photoUrl: pic("Rick") },
    { id: 2, vintedId: "4815162312", title: "Yohji Yamamoto wool coat", seller: "tokyo.closet", price: 330, currency: "EUR", status: "sold", url: "https://www.vinted.de/items/4815162312", photoUrl: pic("Yohji") },
  ];

  window.DEMO_API = (path, body) => {
    if (path === "/price") {
      const title = body.title || "Raf Simons bomber jacket";
      const m = TYPES.map(([re]) => title.match(re)).find(Boolean);
      const brand = (m ? title.slice(0, m.index) : title).trim() || title;
      const median = 25 + (hash(brand.toLowerCase()) % 30) * (DESIGNERS.some((d) => brand.toLowerCase().includes(d)) ? 20 : 2);
      return { item: { title, brand }, product: title.toLowerCase(), ref: { median, low: round(median * 0.8), high: round(median * 1.25), samples: 38 }, difference: null };
    }
    if (path === "/niches")
      return [
        { product: "helmut lang jeans", finds: 7, typicalBuy: 110, resale: 260, multiple: 2.4 },
        { product: "raf simons jacket", finds: 4, typicalBuy: 380, resale: 900, multiple: 2.4 },
        { product: "ralph lauren polo", finds: 23, typicalBuy: 13, resale: 30, multiple: 2.3 },
        { product: "prada bag", finds: 5, typicalBuy: 140, resale: 290, multiple: 2.1 },
      ];
    if (path.startsWith("/deals"))
      return HITS.map((h) => ({ ...h, profit: h.resaleEstimate - h.price, roi: round(((h.resaleEstimate - h.price) / h.price) * 100) })).sort((a, b) => b.roi - a.roi);
    if (path === "/offers")
      return [
        hit(4815162321, "Rick Owens Geobasket sneakers", "Rick Owens", "43", 290, 360, 25),
        hit(4815162322, "Stone Island ghost piece overshirt", "Stone Island", "L", 150, 180, 70),
        hit(4815162323, "Prada Linea Rossa fleece", "Prada", "M", 95, 120, 140),
      ].map((h) => {
        const offer = Math.floor(h.resaleEstimate * 0.7);
        return { ...h, offer, discount: round((1 - offer / h.price) * 100), profit: h.resaleEstimate - offer };
      }).filter((h) => h.discount >= 1 && h.discount <= 30);
    if (path === "/seller")
      return {
        user: { login: "archive.berlin", city: "Berlin", rating: 4.9, reviews: 212 }, listed: 64, soldOrReserved: 17, medianPrice: 145,
        topBrands: [{ name: "Raf Simons", n: 9 }, { name: "Helmut Lang", n: 8 }, { name: "Prada", n: 6 }, { name: "Stone Island", n: 5 }],
        designers: [{ name: "Raf Simons", n: 9 }, { name: "Helmut Lang", n: 8 }, { name: "Prada", n: 6 }], summary: null,
      };
    if (path === "/listing") {
      const de = body.language !== "en";
      const cond = body.condition && (de ? CONDITION_DE[body.condition] || body.condition : body.condition);
      const title = [body.brand, body.item, body.size && (de ? `Gr. ${body.size}` : `size ${body.size}`)].filter(Boolean).join(" ").slice(0, 60);
      if (!title) throw new Error("Describe the item or add a photo.");
      const description = [[body.brand, body.item].filter(Boolean).join(" "), cond && `${de ? "Zustand" : "Condition"}: ${cond}`, body.size && `${de ? "Größe" : "Size"}: ${body.size}`, body.notes,
        de ? "Bei Fragen gerne schreiben, Bündel möglich." : "Feel free to ask, bundles welcome."].filter(Boolean).join("\n");
      // Maße und Mängel als eigene Zeilen, wie im Backend
      const extras = window.watchrStock ? window.watchrStock.listingExtras({ measurements: body.measurements, flaws: body.flaws }, de ? "de" : "en") : [];
      const full = [description, ...extras].join("\n\n");
      const words = `${body.brand || ""} ${body.item || ""}`.toLowerCase().split(/[^a-zà-ÿ0-9]+/).filter((w) => w.length > 2);
      const hashtags = [...new Set([...words, (body.brand || "").toLowerCase().replace(/\s+/g, ""), "vintage"].filter(Boolean))].slice(0, 10).map((t) => "#" + t);
      return { title, description: full, hashtags, ai: false };
    }
    if (path === "/repost")
      return { title: "Raf Simons AW02 bomber jacket", price: 340, currency: "EUR", description: "Raf Simons bomber jacket from AW02.\nSize M, very good condition.\nPit to pit 58 cm, length 66 cm.", photos: [] };
    if (path === "/tracked" && body === undefined) return tracked;
    if (path === "/tracked") {
      const id = (body.url || "").match(/(\d{5,})/)?.[1];
      if (!id) throw new Error("Paste a Vinted listing or profile link.");
      const t = { id: Date.now(), vintedId: id, title: "Tracked listing " + id, seller: "seller", price: 90 + (+id.slice(-2) || 0), currency: "EUR", status: "active", url: body.url, photoUrl: pic("New") };
      tracked = [t, ...tracked];
      return t;
    }
    const del = path.match(/^\/tracked\/(\d+)$/);
    if (del) {
      tracked = tracked.filter((t) => t.id !== +del[1]);
      return null;
    }
    if (path === "/filters") return filters(body.text || "");
    throw new Error("This tool needs watchr running. Start it with npm start.");
  };
})();
