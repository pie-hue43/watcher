// Beispiel-Snipes für die Vorschau ohne watchr-Backend (Live Sniper und Flips).
// Sobald watchr läuft, kommen die echten Treffer vom Server und diese Datei wird nicht benutzt.
window.watchrDemoHits = () => {
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  const ex = (id, title, brand, size, price, est, low, high, n, min, arch, designer, soldMin, opened) => ({
    id, vintedId: String(-id), title, brand, size, price, currency: "EUR", resaleEstimate: est, resaleLow: low, resaleHigh: high, resaleSamples: n,
    detectedAt: ago(min), url: "https://www.vinted.de/catalog?search_text=" + encodeURIComponent(title), photoUrls: [], archiveScore: arch, designer,
    openedAt: opened ? ago(min - 1) : null, saleStatus: soldMin != null ? "sold" : "active", soldAt: soldMin != null ? ago(soldMin) : null,
  });
  // Treffer von anderen Plattformen (eBay per API, Kleinanzeigen aus der Alert inbox)
  const other = (o) => ({ ...ex(o.id, o.title, o.brand, o.size, o.price, o.est, o.low, o.high, o.n, o.min, o.arch ?? null, o.designer ?? null), vintedId: `${o.source}:${-o.id}`, source: o.source, sourceId: String(-o.id), url: o.url, shipping: o.shipping ?? null, location: o.location ?? null, country: o.country ?? null, currency: o.currency || "EUR", resaleBy: o.resaleBy ?? null });
  const panda = { ...ex(-5, "Nike Dunk Low Panda", "Nike", "43", 52, 85, 75, 95, 60, 44, null, null), alsoOn: [{ source: "ebay", url: "https://www.ebay.de/sch/i.html?_nkw=nike+dunk+low+panda", price: 55, currency: "EUR" }, { source: "kleinanzeigen", url: "https://www.kleinanzeigen.de/s-nike-dunk-low-panda/k0", price: 49, currency: "EUR" }] };
  return [
    other({ id: -20, source: "ebay", title: "Stone Island Ghost Piece overshirt", brand: "Stone Island", size: "L", price: 95, shipping: 5.99, location: "20095 Hamburg DE", country: "DE", est: 210, low: 170, high: 260, n: 24, min: 4, url: "https://www.ebay.de/sch/i.html?_nkw=stone+island+ghost+piece", resaleBy: { ebay: { median: 240, low: 205, high: 290, samples: 31 } } }),
    other({ id: -21, source: "kleinanzeigen", title: "Barbour Bedale Wachsjacke (VB)", brand: "Barbour", size: "L", price: 45, location: "50667 Köln", country: "DE", est: 110, low: 90, high: 135, n: 33, min: 7, url: "https://www.kleinanzeigen.de/s-barbour-bedale/k0" }),
    ex(-1, "Raf Simons AW02 bomber jacket", "Raf Simons", "M", 340, 900, 700, 1150, 14, 2, 95, "Raf Simons"),
    ex(-2, "Helmut Lang 1999 painter jeans", "Helmut Lang", "W31", 120, 260, 210, 320, 26, 9, 85, "Helmut Lang", 4, true),
    ex(-3, "Ralph Lauren polo slim fit", "Ralph Lauren", "M", 12, 30, 25, 35, 48, 15, null, null),
    ex(-4, "Maison Margiela Tabi boots", "Maison Margiela", "41", 210, 380, 290, 470, 22, 31, 65, "Maison Margiela", 12),
    panda,
    ex(-6, "Stone Island crewneck knit", "Stone Island", "L", 110, 140, 95, 190, 7, 58, null, null),
    ex(-7, "Carhartt Detroit jacket", "Carhartt", "L", 60, 110, 90, 135, 34, 75, null, null, 40, true),
    ex(-8, "Prada Re-Edition 2005 bag", "Prada", null, 380, 400, 340, 480, 18, 96, 40, "Prada"),
    ex(-13, "Carol Christian Poell drip rubber boots, 2003", "Carol Christian Poell", "42", 690, null, null, null, null, 6, 85, "Carol Christian Poell"),
    ex(-14, "Jean Paul Gaultier vintage mesh top 90s", "Jean Paul Gaultier", "S", 165, 190, 150, 240, 9, 22, 75, "Jean Paul Gaultier"),
    ex(-15, "Undercover AW03 Scab patch jacket", "Undercover", "3", 140, 300, 250, 380, 12, 27, 90, "Undercover"),
    ex(-16, "Nike Air Max 95 Neon OG 2015", "Nike", "44", 70, 160, 130, 190, 38, 60 * 4, null, null),
    ex(-17, "Salomon XT-6 sneakers", "Salomon", "42", 60, 115, 95, 135, 44, 60 * 6, null, null),
    ex(-18, "Chrome Hearts cross ring silver", "Chrome Hearts", "9", 180, 420, 340, 520, 15, 60 * 3, 75, "Chrome Hearts"),
    ex(-19, "Levi's 501 vintage 90s made in USA", "Levi's", "W32", 25, 55, 45, 70, 52, 60 * 8, 20, null),
    ex(-9, "Rick Owens Geobasket sneakers", "Rick Owens", "43", 180, 420, 360, 520, 31, 60 * 26, 80, "Rick Owens", 60 * 20, true),
    ex(-10, "Yohji Yamamoto wool coat", "Yohji Yamamoto", "M", 150, 330, 260, 410, 17, 60 * 50, 75, "Yohji Yamamoto", 60 * 30),
    ex(-11, "Stüssy 8-ball fleece", "Stüssy", "L", 35, 75, 60, 90, 41, 60 * 30, null, null, 60 * 28, true),
    ex(-12, "Arc'teryx Beta AR shell", "Arc'teryx", "M", 140, 260, 220, 300, 52, 60 * 75, null, null, 60 * 70),
  ];
};
