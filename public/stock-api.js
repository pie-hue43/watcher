// Stock-Daten für alle Seiten (window.watchrStockApi). Spricht mit watchrs Backend (/api/stock);
// ist es nicht erreichbar (z. B. in der Vorschau), arbeitet alles mit Beispiel-Einträgen,
// die nur im Speicher dieses Browser-Tabs liegen (sessionStorage).
(function () {
  const BACKEND = (window.WATCHER_BACKEND || location.origin).replace(/\/$/, "");
  const S = window.watchrStock;
  const KEY = "watchr.demoStock";
  const DAY = 864e5;
  let mode = null; // "live" | "demo"

  async function req(method, path, body) {
    if (mode === "demo") return demo(method, path, body);
    let res;
    try {
      res = await fetch(BACKEND + "/api" + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    } catch {
      mode = "demo";
      return demo(method, path, body);
    }
    if (res.status === 204) return (mode = "live"), null;
    if (!(res.headers.get("content-type") || "").includes("application/json")) {
      mode = "demo";
      return demo(method, path, body);
    }
    mode = "live";
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Something went wrong (HTTP ${res.status}).`);
    return data;
  }

  // ---------- Beispiel-Bestand (nur in diesem Tab) ----------
  function load() {
    try {
      const s = JSON.parse(sessionStorage.getItem(KEY));
      if (s && Array.isArray(s.items)) return s;
    } catch {}
    return seed();
  }
  function save(s) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      throw new Error("The preview can't store more here. Photos are large, so try a smaller one.");
    }
  }
  function seed() {
    const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
    const fee = (p) => S.buyFees(p);
    const ex = (id, o) =>
      S.normalize({
        id, hitId: null, category: S.guessCategory(o.title), condition: "Very good", measurements: {}, flaws: "", photos: [], listing: null, vintedUrl: null,
        listedAt: null, priceHistory: [], refreshedAt: null, floorAckAt: null, arrivedAt: null, soldAt: null, soldPrice: null, buyerCountry: null, shippedAt: null, saleId: null,
        resaleLow: null, resaleHigh: null, resaleEstimate: null, pricePlan: {}, price: null, buyFees: fee(o.buyPrice), ...o,
      });
    const listing = (title) => ({ title, description: `${title}\nCondition: Very good`, hashtags: "#vintage", language: "en" });
    const items = [
      ex(-1, { title: "Carhartt Detroit Jacket", brand: "Carhartt", size: "L", buyPrice: 60, boughtAt: ago(19), arrivedAt: ago(15), status: "listed", resaleLow: 95, resaleHigh: 130, resaleEstimate: 110,
        listing: listing("Carhartt Detroit Jacket size L"), vintedUrl: "https://www.vinted.de/items/1", listedAt: ago(9), price: 130, priceHistory: [{ price: 130, at: ago(9) }], measurements: { pitToPit: 63, length: 71 } }),
      ex(-2, { title: "Ralph Lauren Polo", brand: "Ralph Lauren", size: "M", buyPrice: 12, boughtAt: ago(12), arrivedAt: ago(9), status: "sold", resaleLow: 25, resaleHigh: 35, resaleEstimate: 30,
        listing: listing("Ralph Lauren Polo size M"), vintedUrl: "https://www.vinted.de/items/2", listedAt: ago(8), price: 32, priceHistory: [{ price: 35, at: ago(8) }, { price: 32, at: ago(1.5) }], soldAt: ago(1), soldPrice: 30, buyerCountry: "France", saleId: -2 }),
      ex(-3, { title: "Nike Dunk Low Panda", brand: "Nike", size: "43", buyPrice: 55, boughtAt: ago(7), arrivedAt: ago(1), status: "arrived", resaleLow: 80, resaleHigh: 110, resaleEstimate: 95 }),
      ex(-4, { title: "Stone Island Overshirt", brand: "Stone Island", size: "L", buyPrice: 85, boughtAt: ago(6), status: "bought", resaleLow: 140, resaleHigh: 190, resaleEstimate: 165 }),
      ex(-5, { title: "Levi's 501 Vintage", brand: "Levi's", size: "W32", buyPrice: 18, boughtAt: ago(2), status: "bought", resaleLow: 30, resaleHigh: 45, resaleEstimate: 38 }),
      ex(-6, { title: "Arc'teryx Fleece", brand: "Arc'teryx", size: "M", buyPrice: 45, boughtAt: ago(50), arrivedAt: ago(46), status: "listed", resaleHigh: 95, listing: listing("Arc'teryx Fleece size M"),
        vintedUrl: "https://www.vinted.de/items/6", listedAt: ago(45), price: 58, priceHistory: [{ price: 95, at: ago(45) }, { price: 58, at: ago(16) }], pricePlan: { minProfit: 5 } }),
      ex(-7, { title: "Stüssy Hoodie", brand: "Stüssy", size: "M", buyPrice: 25, boughtAt: ago(30), arrivedAt: ago(27), status: "sold", resaleHigh: 60, listing: listing("Stüssy Hoodie size M"),
        vintedUrl: "https://www.vinted.de/items/7", listedAt: ago(26), price: 60, priceHistory: [{ price: 60, at: ago(26) }], soldAt: ago(20), soldPrice: 55, buyerCountry: "Germany", shippedAt: ago(19), saleId: -7 }),
      ex(-8, { title: "Helmut Lang Painter Jeans", brand: "Helmut Lang", size: "W31", buyPrice: 120, boughtAt: ago(22), arrivedAt: ago(18), status: "listed", resaleLow: 210, resaleHigh: 320, resaleEstimate: 260,
        listing: listing("Helmut Lang Painter Jeans W31"), vintedUrl: "https://www.vinted.de/items/8", listedAt: ago(15), price: 320, priceHistory: [{ price: 320, at: ago(15) }], pricePlan: { everyDays: 21 } }),
    ];
    const cost = (it) => S.totalCost(it);
    const sales = items.filter((it) => it.status === "sold").map((it) => ({ id: it.saleId, title: it.title, price: it.soldPrice, buyPrice: cost(it), country: it.buyerCountry, soldAt: it.soldAt, stockId: it.id }));
    return { items, sales, next: -100 };
  }

  function demo(method, path, body) {
    const s = load();
    const now = new Date().toISOString();
    const find = (id) => {
      const it = s.items.find((x) => x.id === id);
      if (!it) throw new Error("Item not found");
      return it;
    };
    const put = (it) => {
      s.items = s.items.map((x) => (x.id === it.id ? it : x));
      save(s);
      return it;
    };
    if (path === "/stock" && method === "GET") return s.items;
    if (path === "/stock/next" && method === "GET") return S.tasks(s.items).map(({ item, ...t }) => ({ ...t, itemId: item.id, title: item.title }));
    if (path === "/sales" && method === "GET") return s.sales;
    if (path === "/stock" && method === "POST") {
      if (!String(body.title || "").trim()) throw new Error("Add a title");
      if (!(Number(body.buyPrice) > 0)) throw new Error("Buy price must be a number above 0");
      if (body.hitId != null && s.items.some((x) => x.hitId === body.hitId)) throw new Error("This snipe is already in your stock");
      const it = S.normalize({
        id: s.next--, hitId: body.hitId ?? null, status: "bought", boughtAt: body.boughtAt ? new Date(body.boughtAt).toISOString() : now, measurements: {}, flaws: "", photos: [],
        listing: null, vintedUrl: null, listedAt: null, priceHistory: [], refreshedAt: null, floorAckAt: null, arrivedAt: null, soldAt: null, soldPrice: null, buyerCountry: null,
        shippedAt: null, saleId: null, resaleLow: null, resaleHigh: null, resaleEstimate: null, pricePlan: {}, price: null, ...body,
        buyPrice: Number(body.buyPrice), buyFees: body.buyFees != null && body.buyFees !== "" ? Number(body.buyFees) : S.buyFees(Number(body.buyPrice)),
        category: body.category || S.guessCategory(body.title),
      });
      s.items.unshift(it);
      save(s);
      return it;
    }
    const m = path.match(/^\/stock\/(-?\d+)(\/sold|\/photos(?:\/(-?\d+))?)?$/);
    if (!m) throw new Error("This needs watchr running. Start it with npm start.");
    const id = Number(m[1]);
    const cur = find(id);
    if (!m[2] && method === "GET") return cur;
    if (!m[2] && method === "DELETE") {
      s.items = s.items.filter((x) => x.id !== id);
      save(s);
      return null;
    }
    if (!m[2] && method === "PATCH") {
      if (body.status === "sold" && cur.status !== "sold") throw new Error("Use Mark as sold, so the sale lands in My Charts");
      const next = { ...cur, ...body, pricePlan: body.pricePlan ? { ...cur.pricePlan, ...body.pricePlan } : cur.pricePlan };
      if (body.pricePlan && body.pricePlan.start !== undefined) {
        next.pricePlan.custom = body.pricePlan.start !== null && body.pricePlan.start !== "";
        next.pricePlan.start = next.pricePlan.custom ? Number(body.pricePlan.start) : 0;
      }
      for (const k of ["buyPrice", "buyFees", "price"]) if (body[k] !== undefined) next[k] = Number(body[k]);
      if (body.status === "arrived" && cur.status === "bought") next.arrivedAt = now;
      if (body.status === "listed" && cur.status !== "listed") {
        next.listedAt = cur.listedAt || now;
        if (body.price == null) next.price = S.normalize({ ...next, status: "arrived" }).price;
        next.priceHistory = [...(cur.priceHistory || []), { price: next.price, at: now }];
      } else if (cur.status === "listed" && body.price != null && Number(body.price) !== cur.price) {
        next.priceHistory = [...(cur.priceHistory || []), { price: Number(body.price), at: now }];
      }
      return put(S.normalize(next));
    }
    if (m[2] === "/sold" && method === "POST") {
      if (cur.status === "sold") throw new Error("Already marked as sold");
      const soldPrice = Number(body.soldPrice);
      if (!(soldPrice > 0)) throw new Error("Sold for must be a number above 0");
      const soldAt = body.soldAt ? new Date(body.soldAt).toISOString() : now;
      const sale = { id: s.next--, title: cur.title, price: soldPrice, buyPrice: S.totalCost(cur), country: body.buyerCountry || null, soldAt, stockId: cur.id };
      s.sales.unshift(sale);
      const it = S.normalize({ ...cur, status: "sold", soldPrice, soldAt, buyerCountry: body.buyerCountry || null, saleId: sale.id });
      put(it);
      return { item: it, sale, profit: Math.round((soldPrice - S.totalCost(cur)) * 100) / 100 };
    }
    if (m[2] === "/photos" && method === "POST") {
      const photo = { id: s.next--, url: body.photo, studio: !!body.studio };
      const photos = [...cur.photos, photo].sort((a, b) => b.studio - a.studio);
      return put({ ...cur, photos });
    }
    if (m[3] && method === "DELETE") return put({ ...cur, photos: cur.photos.filter((p) => p.id !== Number(m[3])) });
    throw new Error("Not supported in the preview");
  }

  // Foto-Adresse: vom Backend relativ, im Beispiel ein data:-Bild
  const photoUrl = (p) => (p.url.startsWith("data:") ? p.url : BACKEND + p.url);

  window.watchrStockApi = {
    get isDemo() {
      return mode === "demo";
    },
    list: () => req("GET", "/stock"),
    next: () => req("GET", "/stock/next"),
    get: (id) => req("GET", `/stock/${id}`),
    create: (b) => req("POST", "/stock", b),
    patch: (id, b) => req("PATCH", `/stock/${id}`, b),
    remove: (id) => req("DELETE", `/stock/${id}`),
    sold: (id, b) => req("POST", `/stock/${id}/sold`, b),
    addPhoto: (id, dataUrl, studio) => req("POST", `/stock/${id}/photos`, { photo: dataUrl, studio: !!studio }),
    removePhoto: (id, pid) => req("DELETE", `/stock/${id}/photos/${pid}`),
    // Verkäufe aus dem Beispiel-Bestand (für My Charts in der Vorschau)
    demoSales: () => load().sales,
    photoUrl,
  };
})();
