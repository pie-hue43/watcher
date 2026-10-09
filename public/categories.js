// Kategorien: die besten noch offenen Listings, die watchr gefunden hat, je Kategorie nach Netto-Gewinn
const BACKEND = (window.WATCHER_BACKEND || location.origin).replace(/\/$/, "");
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmtPrice = (p, cur = "EUR") =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: cur, maximumFractionDigits: p % 1 ? 2 : 0 }).format(p);
const fmtDiff = (d, cur) => (d >= 0 ? "+" : "−") + fmtPrice(Math.abs(Math.round(d)), cur);

// Zuordnung über den Titel (deutsch und englisch), Archive über den Archive-Score
const CATS = {
  archive: { name: "Archive", tags: "#archive", test: (h) => (h.archiveScore || 0) >= 50 },
  sneakers: { name: "Sneakers", tags: "#sneakers", re: /sneaker|schuh|shoe|trainer|dunk|jordan|air max|boots?\b|stiefel|geobasket|tabi|loafer|derby/i },
  jackets: { name: "Jackets", tags: "#jacket", re: /jacke|jacket|bomber|parka|coat|mantel|blazer|fleece|shell|anorak|weste|\bvest|overshirt|windbreaker/i },
  pants: { name: "Pants", tags: "#pants", re: /jeans|\b50[15]\b|hose|pants|trousers|cargo|shorts|chino|denim/i },
  tops: { name: "Tops", tags: "#tops", re: /t-?shirt|\btee\b|shirt|hemd|sweater|pullover|hoodie|polo|longsleeve|\btop\b|bluse|blouse|knit|crewneck|strick|cardigan|jersey/i },
  accessories: { name: "Accessories", tags: "#accessories", re: /belt|gürtel|bag\b|tasche|wallet|portemonnaie|\bcap\b|beanie|m[üu]tze|scarf|schal|\bring\b|kette|necklace|bracelet|armband|earring|ohrring|sunglasses|sonnenbrille|watch\b|\buhr\b|gloves|handschuhe|keychain|cardholder/i },
  all: { name: "All categories", tags: "", test: () => true },
};
const inCat = (c, h) => (c.test ? c.test(h) : c.re.test(h.title || ""));

let hits = [];
let cat = new URLSearchParams(location.search).get("cat") || "all";
if (!CATS[cat]) cat = "all";

function render() {
  const c = CATS[cat];
  document.querySelectorAll(".cat[data-cat]").forEach((a) => a.setAttribute("aria-current", String(a.dataset.cat === cat)));
  const open = hits
    .filter((h) => (h.saleStatus || "active") === "active" && watchrEval.qualifies(h) && inCat(c, h))
    .map((h) => ({ h, e: watchrEval.evaluate(h), r: watchrEval.rarity(h) }))
    // lohnende Flips nach Gewinn zuerst, reine Archive-Funde danach nach Archive-Score
    .sort((a, b) => (b.e?.qualifies ? b.e.profit : -1e6 + (b.h.archiveScore || 0)) - (a.e?.qualifies ? a.e.profit : -1e6 + (a.h.archiveScore || 0)))
    .slice(0, 12);
  $("cat-title").textContent = c.name;
  const total = open.filter((x) => x.e?.qualifies).reduce((s, x) => s + x.e.profit, 0);
  $("cat-sub").textContent = open.length ? `${open.length} still for sale · est. ${fmtPrice(Math.round(total))} net profit` : "";
  const snipe = c.tags ? `monitor.html?tags=${encodeURIComponent(c.tags)}` : "monitor.html";
  $("cat-snipe").href = $("cat-more").href = snipe;
  $("cat-more").hidden = !open.length;
  $("cat-empty").hidden = open.length > 0;
  $("cat-list").replaceChildren(
    ...open.map(({ h, e, r }, i) => {
      const li = el("li", `lb-row r-${r}` + (i < 3 ? ` podium p${i + 1}` : ""));
      li.append(el("span", "lb-rank", i < 3 ? ["🥇", "🥈", "🥉"][i] : String(i + 1)));
      const name = el("div", "lb-name");
      const a = Object.assign(el("a", null, h.title), { href: h.url, target: "_blank", rel: "noopener" });
      const resale = e ? ` → ~${fmtPrice(e.sale, h.currency)}` : " · too rare for a price estimate";
      name.append(a, el("span", "meta", `${fmtPrice(h.price, h.currency)}${resale}${h.size ? ` · Size ${h.size}` : ""}`));
      const showProfit = e && e.qualifies;
      li.append(
        name,
        el("span", "verdict v-" + r, watchrEval.LABEL[r]),
        el("span", "lb-profit", showProfit ? fmtDiff(e.profit, h.currency) : `Archive ${h.archiveScore}`),
        el("span", "lb-roi", showProfit ? `${e.roi}%` : ""),
      );
      return li;
    }),
  );
}

document.querySelectorAll(".cat[data-cat]").forEach((a) =>
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    cat = a.dataset.cat;
    history.replaceState(null, "", `?cat=${cat}`);
    render();
    $("cat-title").scrollIntoView({ behavior: "smooth", block: "start" });
  }),
);

async function load() {
  try {
    const res = await fetch(`${BACKEND}/api/hits?limit=200`);
    if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) throw new Error();
    hits = await res.json();
    $("demo-note").hidden = true;
  } catch {
    // Vorschau ohne Backend: Beispieldaten
    if (!hits.length) hits = watchrDemoHits();
    $("demo-note").hidden = false;
  }
  render();
}
watchrPlatforms.loadContext(BACKEND).finally(load);
setInterval(load, 60_000);
