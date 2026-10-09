// My Charts: eigene Verkäufe als Kennzahlen, Tagesumsatz mit Vorperiode und Käuferländer
const BACKEND = (window.WATCHER_BACKEND || location.origin).replace(/\/$/, "");
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const eur = (n, digits) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: digits ?? (n % 1 ? 2 : 0), maximumFractionDigits: digits ?? 2 }).format(n);
const DAY = 864e5;
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const fmtDay = (key) => new Date(key + "T12:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

let sales = [];
let demo = false;
let days = 30;
try { days = Number(localStorage.getItem("watchr.chartDays")) || 30; } catch {}

// Beispieldaten für die Vorschau (ähnlich einem echten Monat)
function demoSales() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const items = ["Ralph Lauren polo", "Nike Dunk Low", "Carhartt Detroit jacket", "Stone Island knit", "Levi's 501", "Stüssy hoodie", "Arc'teryx fleece", "Helmut Lang jeans", "Prada nylon bag", "Adidas track jacket"];
  const countries = [["Germany", 41], ["France", 21], ["Austria", 17], ["Italy", 12], ["Belgium", 9]];
  const pick = () => { let r = rnd() * 100; for (const [c, w] of countries) if ((r -= w) <= 0) return c; return "Germany"; };
  const out = [];
  for (let d = 0; d < 90; d++) {
    const n = rnd() < 0.3 ? 0 : Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const price = Math.round(12 + rnd() * rnd() * 110);
      out.push({ id: -out.length - 1, title: items[Math.floor(rnd() * items.length)], price, buyPrice: rnd() < 0.8 ? Math.round(price * (0.35 + rnd() * 0.35)) : null, country: pick(), soldAt: new Date(Date.now() - d * DAY - rnd() * 8 * 36e5).toISOString() });
    }
  }
  return out;
}

function inRange(from, to) {
  return sales.filter((s) => { const t = new Date(s.soldAt).getTime(); return t > from && t <= to; });
}

function render() {
  document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.days) === days)));
  $("range-label").textContent = `last ${days} days`;
  const now = Date.now();
  const cur = inRange(now - days * DAY, now);
  const prev = inRange(now - 2 * days * DAY, now - days * DAY);
  const sum = (list) => list.reduce((s, x) => s + x.price, 0);
  const revenue = sum(cur), prevRevenue = sum(prev);

  $("k-revenue").textContent = eur(revenue, 2);
  const delta = $("k-delta");
  if (prevRevenue > 0) {
    const pct = ((revenue - prevRevenue) / prevRevenue) * 100;
    delta.hidden = false;
    delta.className = "delta " + (pct >= 0 ? "up" : "down");
    delta.textContent = `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
    $("k-prev").textContent = `vs ${eur(prevRevenue, 0)} the ${days} days before`;
  } else {
    delta.hidden = true;
    $("k-prev").textContent = "No sales in the previous period";
  }
  $("k-orders").textContent = cur.length;
  $("k-orders-sub").textContent = prev.length ? `${prev.length} the period before` : "";
  $("k-aov").textContent = cur.length ? eur(revenue / cur.length, 2) : "–";
  $("k-aov-sub").textContent = prev.length ? `${eur(prevRevenue / prev.length, 2)} before` : "";
  const withBuy = cur.filter((s) => s.buyPrice != null);
  if (withBuy.length) {
    const profit = withBuy.reduce((s, x) => s + x.price - x.buyPrice, 0);
    $("k-profit").textContent = eur(Math.round(profit), 0);
    $("k-profit-sub").textContent = `${Math.round((profit / sum(withBuy)) * 100)}% margin · ${withBuy.length} of ${cur.length} sales with buy price`;
  } else {
    $("k-profit").textContent = "–";
    $("k-profit-sub").textContent = "Add buy prices to see it";
  }

  // Länder
  const byCountry = new Map();
  for (const s of cur) if (s.country) byCountry.set(s.country, (byCountry.get(s.country) || 0) + s.price);
  const countries = [...byCountry.entries()].sort((a, b) => b[1] - a[1]);
  const known = countries.reduce((s, [, v]) => s + v, 0);
  $("k-countries").textContent = countries.length;
  $("k-top").textContent = countries.length ? `Most from ${countries[0][0]}` : "";
  $("w-sub").textContent = known ? `${eur(known, 0)} with a country` : "";
  $("countries").replaceChildren(
    ...(countries.length
      ? countries.map(([c, v]) => {
          const li = el("li");
          const val = el("span", "val", eur(v, 0));
          val.append(el("small", null, `${((v / known) * 100).toFixed(1)}%`));
          const bar = el("div", "bar");
          const fill = el("span");
          fill.style.width = `${(v / countries[0][1]) * 100}%`;
          bar.append(fill);
          li.append(el("span", null, c), val, bar);
          return li;
        })
      : [el("li", "note", "Add the buyer country to your sales to see this.")]),
  );

  // Letzte Verkäufe
  $("t-sub").textContent = `${cur.length} in ${days} days`;
  $("sales").replaceChildren(
    ...cur.slice(0, 8).map((s) => {
      const tr = el("tr");
      const name = el("td", null, s.title);
      if (s.stockId != null) name.append(Object.assign(el("a", "badge stock-tag", "Stock"), { href: `stock.html#item-${s.stockId}`, title: "Logged from Stock" }));
      name.append(el("div", "note", new Date(s.soldAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })));
      const p = s.buyPrice != null ? s.price - s.buyPrice : null;
      const del = el("td");
      if (!demo) {
        const b = el("button", null, "Remove");
        b.type = "button";
        b.onclick = async () => {
          await fetch(`${BACKEND}/api/sales/${s.id}`, { method: "DELETE" }).catch(() => {});
          load();
        };
        del.append(b);
      }
      tr.append(name, el("td", null, s.country || "–"), el("td", "num", eur(s.price)), el("td", "num " + (p > 0 ? "pos" : ""), p == null ? "–" : (p >= 0 ? "+" : "−") + eur(Math.abs(p))), del);
      return tr;
    }),
  );
  if (!cur.length) $("sales").replaceChildren(Object.assign(el("tr"), { innerHTML: '<td colspan="5" class="note">No sales in this period yet. Add your first one below.</td>' }));

  renderChart(cur, prev, now);
}

// Säulen = Umsatz pro Tag, gestrichelte Linie = gleicher Tag der Vorperiode
function renderChart(cur, prev, now) {
  const svg = $("chart");
  const W = svg.clientWidth || 800, H = svg.clientHeight || 260;
  const pad = { l: 44, r: 18, t: 12, b: 26 };
  const keys = Array.from({ length: days }, (_, i) => dayKey(now - (days - 1 - i) * DAY));
  const curBy = new Map(), prevBy = new Map();
  for (const s of cur) curBy.set(dayKey(s.soldAt), (curBy.get(dayKey(s.soldAt)) || 0) + s.price);
  for (const s of prev) { const k = dayKey(new Date(s.soldAt).getTime() + days * DAY); prevBy.set(k, (prevBy.get(k) || 0) + s.price); }
  const vals = keys.map((k) => curBy.get(k) || 0), pvals = keys.map((k) => prevBy.get(k) || 0);
  const rawMax = Math.max(10, ...vals, ...pvals);
  const step = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => rawMax / s <= 4) || 2000;
  const max = Math.ceil(rawMax / step) * step;
  const x = (i) => pad.l + ((i + 0.5) * (W - pad.l - pad.r)) / days;
  const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const bw = Math.max(3, Math.min(18, ((W - pad.l - pad.r) / days) * 0.6));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.replaceChildren();
  for (let v = 0; v <= max; v += step) {
    svg.append(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), stroke: "#e1ebe3", "stroke-width": 1 }));
    const t = svgEl("text", { x: pad.l - 8, y: y(v) + 4, "text-anchor": "end", "font-size": 11, fill: "#56625a" });
    t.textContent = v >= 1000 ? `€${v / 1000}k` : `€${v}`;
    svg.append(t);
  }
  const every = Math.ceil(days / (W < 520 ? 4 : 8));
  keys.forEach((k, i) => {
    if ((days - 1 - i) % every) return;
    const t = svgEl("text", { x: x(i), y: H - 6, "text-anchor": "middle", "font-size": 11, fill: "#56625a" });
    t.textContent = fmtDay(k);
    svg.append(t);
  });
  // Balken mit runder Oberkante, unten am Nullpunkt verankert
  vals.forEach((v, i) => {
    if (!v) return;
    const h = Math.max(2, y(0) - y(v)), r = Math.min(4, bw / 2, h);
    const x0 = x(i) - bw / 2, y0 = y(v);
    svg.append(svgEl("path", { d: `M${x0},${y(0)}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${y(0)}Z`, fill: "#15803d" }));
  });
  svg.append(svgEl("polyline", { points: pvals.map((v, i) => `${x(i)},${y(v)}`).join(" "), fill: "none", stroke: "#8a948d", "stroke-width": 2, "stroke-dasharray": "4 4", "stroke-linejoin": "round" }));
  // Hover: ganze Tagesspalte als Trefferfläche
  const tip = $("tip");
  const colW = (W - pad.l - pad.r) / days;
  keys.forEach((k, i) => {
    const hit = svgEl("rect", { x: pad.l + i * colW, y: pad.t, width: colW, height: H - pad.t - pad.b, fill: "transparent" });
    const show = () => {
      const n = cur.filter((s) => dayKey(s.soldAt) === k).length;
      tip.innerHTML = `${new Date(k + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · <b>${eur(vals[i])}</b> · ${n} order${n === 1 ? "" : "s"}<br><span style="color:#b9c4bc">Previous period ${eur(pvals[i])}</span>`;
      const rect = svg.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max((x(i) / W) * rect.width, 90), rect.width - 90)}px`;
      tip.style.top = `${(y(Math.max(vals[i], pvals[i])) / H) * rect.height}px`;
      tip.hidden = false;
    };
    hit.addEventListener("mouseenter", show);
    hit.addEventListener("touchstart", show, { passive: true });
    hit.addEventListener("mouseleave", () => (tip.hidden = true));
    svg.append(hit);
  });
  const peakI = vals.indexOf(Math.max(...vals));
  $("c-peak").textContent = vals[peakI] ? `Best day ${new Date(keys[peakI] + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · ${eur(vals[peakI])}` : "";
  $("c-avg").textContent = `Ø ${eur(vals.reduce((a, b) => a + b, 0) / days, 2)} per day`;
}

document.querySelectorAll(".seg button").forEach((b) =>
  b.addEventListener("click", () => {
    days = Number(b.dataset.days);
    try { localStorage.setItem("watchr.chartDays", String(days)); } catch {}
    render();
  }),
);
window.addEventListener("resize", () => render());

$("add-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const body = Object.fromEntries(f.entries());
  const msg = $("form-msg");
  // Aus Stock: als verkauft markieren, das legt den Verkauf mit den vollen Kosten an
  if (body.stockId) {
    try {
      const r = await watchrStockApi.sold(Number(body.stockId), { soldPrice: body.price, buyerCountry: body.country || null, soldAt: body.soldAt || undefined });
      msg.textContent = "";
      ev.target.reset();
      if (demo) sales.unshift(r.sale);
      await loadStock();
      return demo ? render() : load();
    } catch (e) {
      return void (msg.textContent = `Couldn't save: ${e.message}`);
    }
  }
  if (demo) return void (msg.textContent = "watchr isn't running here, so sales can't be saved. Start it with npm start.");
  try {
    const res = await fetch(`${BACKEND}/api/sales`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    msg.textContent = "";
    ev.target.reset();
    load();
  } catch (e) {
    msg.textContent = `Couldn't save: ${e.message}`;
  }
});

// "From stock": noch nicht verkaufte Teile füllen Titel und Einkaufspreis (Preis + Gebühren)
let stock = [];
async function loadStock() {
  stock = await watchrStockApi.list().catch(() => []);
  const open = stock.filter((it) => it.status !== "sold" && it.status !== "kept");
  const sel = $("from-stock");
  sel.replaceChildren(Object.assign(el("option", null, "No, enter it myself"), { value: "" }), ...open.map((it) => Object.assign(el("option", null, `${it.title} · cost ${eur(watchrStock.totalCost(it))}`), { value: it.id })));
  $("from-stock-wrap").hidden = !open.length;
  renderStockSide();
}

// Stock-Tabelle an der Seite: zuerst die offenen Aufgaben, dann alles, was noch im Bestand ist
const STATUS = { bought: "Bought", arrived: "Arrived", listed: "Listed", sold: "Sold", kept: "Kept" };
function renderStockSide() {
  const S = watchrStock;
  const tasks = S.tasks(stock);
  const withTask = new Set(tasks.map((t) => t.item.id));
  const rest = stock.filter((it) => !withTask.has(it.id) && it.status !== "kept" && !(it.status === "sold" && it.shippedAt));
  const rows = [...tasks, ...rest.map((item) => ({ kind: null, item }))];
  window.watchrSetStockCount?.(tasks.length);
  $("sk-sub").textContent = tasks.length ? `${tasks.length} open task${tasks.length === 1 ? "" : "s"} · ${rest.length} waiting` : rest.length ? `${rest.length} in stock, nothing to do right now` : "What you bought and what to do next.";
  $("sk-empty").hidden = rows.length > 0;
  $("sk-rows").replaceChildren(...rows.map(stockRow));
}
function stockRow(t) {
  const it = t.item;
  const tr = el("tr", t.kind ? "k-" + t.kind : "idle");
  const item = el("td", "item");
  const a = Object.assign(el("a", null, it.title), { href: `stock.html#item-${it.id}`, title: it.title });
  const label = t.kind ? t.label : it.status === "listed" ? `Listed · next price check ${nextCheck(it)}` : STATUS[it.status];
  const cost = watchrStock.totalCost(it);
  item.append(a, el("span", "what", label), el("span", "meta", [it.size && `Size ${it.size}`, `cost ${eur(Math.round(cost))}`, it.status !== "sold" && `floor ${eur(it.pricePlan.floor)}`].filter(Boolean).join(" · ")));
  const acts = sideActions(t);
  if (acts) item.append(acts);
  const price = el("td", "num", eur(it.status === "sold" ? it.soldPrice : it.price));
  const profit = it.status === "sold" ? watchrStock.realProfit(it) : watchrStock.expectedProfit(it);
  price.append(el("small", null, `${it.status === "sold" ? "profit" : "exp."} ${profit >= 0 ? "+" : "−"}${eur(Math.abs(Math.round(profit)))}`));
  tr.append(item, price);
  return tr;
}
const nextCheck = (it) => {
  const due = Date.parse(watchrStock.lastPriceChange(it)) + it.pricePlan.everyDays * DAY;
  const d = Math.ceil((due - Date.now()) / DAY);
  return d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
};
// Dieselben Knöpfe wie unter "Next up" auf der Stock-Seite; auf Vinted ändert der Nutzer selbst
function sideActions(t) {
  if (!t.kind) return null;
  const it = t.item;
  const box = el("div", "side-acts");
  const err = el("p", "error");
  err.hidden = true;
  const now = () => new Date().toISOString();
  const act = (label, primary, fn) => {
    const b = el("button", primary ? "btn small" : "btn small ghost", label);
    b.type = "button";
    b.onclick = async () => {
      b.disabled = true;
      err.hidden = true;
      try {
        await fn();
        await loadStock();
      } catch (e) {
        b.disabled = false;
        err.textContent = e.message;
        err.hidden = false;
      }
    };
    return b;
  };
  const link = (label, href, primary) => Object.assign(el("a", primary ? "btn small" : "btn small ghost", label), { href });
  const A = watchrStockApi;
  if (t.kind === "ship") box.append(act("Shipped", true, () => A.patch(it.id, { shippedAt: now() })));
  if (t.kind === "write") box.append(link("Write listing", `stock.html#item-${it.id}`, true));
  if (t.kind === "arrived") box.append(act("Arrived", true, () => A.patch(it.id, { status: "arrived" })));
  if (t.kind === "price") {
    if (it.vintedUrl) box.append(Object.assign(link("Open on Vinted", it.vintedUrl), { target: "_blank", rel: "noopener" }));
    box.append(act("Done", true, () => A.patch(it.id, { price: t.price })));
  }
  if (t.kind === "refresh") box.append(link("Refresh", `tools.html?stock=${it.id}#vinted-repost`, true), act("Done", false, () => A.patch(it.id, { refreshedAt: now() })));
  if (t.kind === "floor") box.append(act("Keep listed", true, () => A.patch(it.id, { floorAckAt: now() })), act("Kept for myself", false, () => A.patch(it.id, { status: "kept" })));
  box.append(err);
  return box;
}
$("from-stock").addEventListener("change", (e) => {
  const it = stock.find((x) => String(x.id) === e.target.value);
  const f = $("add-form");
  f.buyPrice.readOnly = !!it;
  if (!it) return;
  f.title.value = it.title;
  f.buyPrice.value = watchrStock.totalCost(it);
  if (it.status === "listed") f.price.value = it.price;
});

async function load() {
  try {
    const res = await fetch(`${BACKEND}/api/sales`);
    if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) throw new Error();
    sales = await res.json();
    demo = false;
  } catch {
    // Beispiel-Monat plus die Verkäufe aus dem Beispiel-Stock
    sales = [...watchrStockApi.demoSales(), ...demoSales()].sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt));
    demo = true;
  }
  $("demo-note").hidden = !demo;
  render();
}
load();
loadStock();
