// Beispiel-Snipes für die Vorschau ohne watchr-Backend (Live Sniper und Flips).
// Sobald watchr läuft, kommen die echten Treffer vom Server und diese Datei wird nicht benutzt.
window.watchrDemoHits = () => {
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  const ex = (id, title, brand, size, price, est, low, high, n, min, arch, designer, soldMin, opened) => ({
    id, vintedId: String(-id), title, brand, size, price, currency: "EUR", resaleEstimate: est, resaleLow: low, resaleHigh: high, resaleSamples: n,
    detectedAt: ago(min), url: "https://www.vinted.de/catalog?search_text=" + encodeURIComponent(title), photoUrls: [], archiveScore: arch, designer,
    openedAt: opened ? ago(min - 1) : null, saleStatus: soldMin != null ? "sold" : "active", soldAt: soldMin != null ? ago(soldMin) : null,
  });
  return [
    ex(-1, "Raf Simons AW02 bomber jacket", "Raf Simons", "M", 340, 900, 700, 1150, 14, 2, 95, "Raf Simons"),
    ex(-2, "Helmut Lang 1999 painter jeans", "Helmut Lang", "W31", 120, 260, 210, 320, 26, 9, 85, "Helmut Lang", 4, true),
    ex(-3, "Ralph Lauren polo slim fit", "Ralph Lauren", "M", 12, 30, 25, 35, 48, 15, null, null),
    ex(-4, "Maison Margiela Tabi boots", "Maison Margiela", "41", 210, 380, 290, 470, 22, 31, 65, "Maison Margiela", 12),
    ex(-5, "Nike Dunk Low Panda", "Nike", "43", 65, 85, 75, 95, 60, 44, null, null),
    ex(-6, "Stone Island crewneck knit", "Stone Island", "L", 110, 140, 95, 190, 7, 58, null, null),
    ex(-7, "Carhartt Detroit jacket", "Carhartt", "L", 60, 110, 90, 135, 34, 75, null, null, 40, true),
    ex(-8, "Prada Re-Edition 2005 bag", "Prada", null, 380, 400, 340, 480, 18, 96, 40, "Prada"),
    ex(-13, "Carol Christian Poell drip rubber boots, 2003", "Carol Christian Poell", "42", 690, null, null, null, null, 6, 85, "Carol Christian Poell"),
    ex(-14, "Jean Paul Gaultier vintage mesh top 90s", "Jean Paul Gaultier", "S", 165, 190, 150, 240, 9, 22, 75, "Jean Paul Gaultier"),
    ex(-15, "Undercover AW03 Scab patch jacket", "Undercover", "3", 140, 300, 250, 380, 12, 27, 90, "Undercover"),
    ex(-9, "Rick Owens Geobasket sneakers", "Rick Owens", "43", 180, 420, 360, 520, 31, 60 * 26, 80, "Rick Owens", 60 * 20, true),
    ex(-10, "Yohji Yamamoto wool coat", "Yohji Yamamoto", "M", 150, 330, 260, 410, 17, 60 * 50, 75, "Yohji Yamamoto", 60 * 30),
    ex(-11, "Stüssy 8-ball fleece", "Stüssy", "L", 35, 75, 60, 90, 41, 60 * 30, null, null, 60 * 28, true),
    ex(-12, "Arc'teryx Beta AR shell", "Arc'teryx", "M", 140, 260, 220, 300, 52, 60 * 75, null, null, 60 * 70),
  ];
};
