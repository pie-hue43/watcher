// Live Sniper: verbindet sich per WebSocket mit dem Backend und zeigt Treffer live an.
// Läuft die Seite auf einer anderen Domain als das Backend, vorher setzen:
//   <script>window.WATCHER_BACKEND = "https://watcher.meine-seite.de";</script>
const BACKEND = (window.WATCHER_BACKEND || location.origin).replace(/\/$/, "");
const WS_URL = BACKEND.replace(/^http/, "ws") + "/ws";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmtPrice = (p, cur) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: cur || "EUR", maximumFractionDigits: p % 1 ? 2 : 0 }).format(p);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const fmtDiff = (d, cur) => (d >= 0 ? "+" : "−") + fmtPrice(Math.abs(Math.round(d)), cur);
const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();

let hits = [];
let searches = [];
const P = window.watchrPlatforms;
// Plattformen, Gebühren und Kurse vom Backend; ohne Backend die Standardwerte aus platforms.js
let platformInfo = P.PLATFORMS.map((p) => ({ id: p.id, name: p.name, country: p.country, eu: p.eu, mode: p.fallbackMode || p.mode, live: p.id === "vinted", env: p.env || [], senders: p.senders || [] }));
let feesNotSet = P.IDS.filter((id) => !P.feesSet(P.DEFAULT_FEES, id));
let alertInbox = { configured: false };
let fx = P.FALLBACK_FX;
const platName = (id) => (P.byId(id) || { name: id }).name;
async function loadPlatforms() {
  const get = (path) => fetch(BACKEND + path).then((r) => (r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : Promise.reject()));
  try {
    const [info, fees, rates] = await Promise.all([get("/api/sources"), get("/api/fees"), get("/api/fx")]);
    platformInfo = info.platforms;
    feesNotSet = info.feesNotSet;
    alertInbox = info.alertInbox;
    fx = rates;
    watchrEval.setContext({ fees, fx });
  } catch {
    watchrEval.setContext({ fees: P.DEFAULT_FEES, fx });
  }
  renderPlatforms();
  renderSearches();
  renderHits();
}
// Snipes, die schon im Stock sind (hitId -> Stock-Eintrag)
let stockByHit = new Map();
function loadStock() {
  return watchrStockApi.list().then(
    (list) => {
      stockByHit = new Map(list.filter((it) => it.hitId != null).map((it) => [it.hitId, it]));
      renderHits();
    },
    () => {},
  );
}

// "Bought it": Snipe als gekauft in Stock übernehmen (ohne Fotos, die macht der Nutzer selbst)
function boughtBtn(h) {
  const inStock = stockByHit.get(h.id);
  if (inStock) {
    const a = el("a", "btn small ghost", "In stock ✓");
    a.href = `stock.html#item-${inStock.id}`;
    return a;
  }
  const b = el("button", "btn small ghost", "Bought it");
  b.type = "button";
  b.title = "Add to Stock with the price, fees and resale estimate";
  b.onclick = async () => {
    b.disabled = true;
    b.textContent = "Adding…";
    const e = watchrEval.evaluate(h);
    try {
      const it = await watchrStockApi.create({
        hitId: h.id, title: h.title, brand: h.brand, size: h.size, buyPrice: e ? e.priceEur : h.price,
        // Käuferschutz, Versand und bei Nicht-EU-Käufen die Einfuhrabgaben, alles in Euro
        buyFees: e ? Math.round((e.fee + e.shipping + e.importTax) * 100) / 100 : watchrStock.buyFees(h.price),
        resaleLow: h.resaleLow ?? null, resaleHigh: h.resaleHigh ?? null, resaleEstimate: h.resaleEstimate ?? null,
      });
      stockByHit.set(h.id, it);
      renderHits();
    } catch (err) {
      b.disabled = false;
      b.textContent = "Try again";
      b.title = `Couldn't add it to Stock: ${err.message}`;
      if (/already/i.test(err.message)) loadStock();
    }
  };
  return b;
}

// Geöffnete Treffer ans Backend melden (für Flips)
function markOpened(h) {
  if (h.openedAt || demo) return;
  h.openedAt = new Date().toISOString();
  const url = `${BACKEND}/api/hits/${h.id}/open`;
  if (!navigator.sendBeacon?.(url)) fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  renderStats();
}

function hitNode(h, fresh) {
  const r = watchrEval.rarity(h);
  const li = el("li", "listing" + (fresh ? " fresh" : "") + (r ? " r-" + r : ""));
  const link = (cls, text) => {
    const a = el("a", cls, text);
    a.href = h.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.addEventListener("click", () => markOpened(h));
    return a;
  };
  const pics = el("div", "pics");
  const photos = (h.photoUrls || []).slice(0, 3);
  if (!photos.length) pics.append(el("div", "pic"));
  for (const src of photos) {
    const a = link();
    a.append(Object.assign(el("img", "pic"), { src, alt: "", loading: "lazy", referrerPolicy: "no-referrer" }));
    pics.append(a);
  }
  const info = el("div");
  const prefTags = h.searchKind || h.searchQuery ? watchrTags.toTags({ query: h.searchQuery || "", kind: h.searchKind }).join(" ") : null;
  const meta = el("span", "meta");
  const src = h.source || "vinted";
  meta.append(el("span", "badge src" + (src === "vinted" ? "" : " ext"), platName(src)), [h.size && `Size ${h.size}`, h.brand, h.location, prefTags, fmtTime(h.detectedAt)].filter(Boolean).join(" · "));
  if (!P.isEu(h)) {
    const n = el("span", "import-note", "Import tax included");
    n.title = "Bought from outside the EU: the cost includes import VAT and, above €150, customs duty";
    meta.append(n);
  }
  info.append(link("title", h.title), meta);
  if (h.alsoOn && h.alsoOn.length) {
    const also = el("span", "also-on", "Also on: ");
    h.alsoOn.forEach((a, i) => {
      if (i) also.append(", ");
      also.append(Object.assign(el("a", null, platName(a.source)), { href: a.url, target: "_blank", rel: "noopener", title: fmtPrice(a.price, a.currency) }));
    });
    info.append(also);
  }
  if (h.archiveScore >= 50) info.append(archBadge(h));
  if (h.saleStatus === "sold") info.append(el("span", "sold-tag", "Sold · in Flips"));
  const acts = el("div", "hit-acts");
  acts.append(link("btn small", "View"), boughtBtn(h));
  li.append(pics, info, pricing(h), acts);
  const check = flipCheck(h);
  if (check) li.append(check);
  return li;
}

// Archive-Score als schwarzes Abzeichen, z. B. „Archive 85 · Raf Simons“
function archBadge(h) {
  const b = el("span", "arch");
  b.title = "Archive score: how strongly this looks like a designer or archive piece (0 to 100)";
  b.append("Archive ", el("b", null, String(h.archiveScore)), h.designer ? ` · ${h.designer}` : "");
  return b;
}

// Vinted-Preis, Resell-Spanne und Netto-Gewinn nach Kosten
function pricing(h) {
  const box = el("div", "pricing");
  box.append(el("span", "price", fmtPrice(h.price, h.currency)));
  const e = watchrEval.evaluate(h);
  if (e && e.currency !== "EUR") box.append(el("span", "resale", `≈ ${fmtPrice(e.priceEur)}`));
  if (e) {
    const best = e.targets.find((t) => t.id === e.bestSellOn.id);
    const r = el("span", "resale", `Resale ${fmtPrice(best.low)}–${fmtPrice(best.high)}`);
    r.title = best.basis === "factor" ? `Rough estimate: Vinted median × ${best.factor}` : `Median ${fmtPrice(best.median)} from ${best.samples ?? "several"} comparable ${best.name} listings`;
    const net = el("span", "diff " + (e.profit > 0 ? "up" : "down"), `Net ${fmtDiff(e.profit)}`);
    if (e.bestSellOn.id !== "vinted") net.title = `Selling on ${e.bestSellOn.name}`;
    box.append(r, net);
  }
  return box;
}

// Archive-Teil ohne Vergleichspreise: keine Rechnung möglich, aber trotzdem gezeigt
function archiveNote() {
  const p = el("p", "flip-check archive-note");
  p.append(el("span", "verdict v-archive", "Archive"), el("span", "muted", " · too rare for a price estimate. Check sold prices on Grailed before you buy."));
  return p;
}

// Aufklappbare Flip-Auswertung unter jedem Snipe
function flipCheck(h) {
  const e = watchrEval.evaluate(h);
  if (!e) return watchrEval.isArchive(h) ? archiveNote() : null;
  const cur = h.currency;
  const d = el("details", "flip-check");
  const sum = el("summary");
  if (e.qualifies) sum.append(el("span", "verdict v-" + e.verdict, e.label), el("span", "muted", ` · ${e.roi}% ROI · ${e.confidence} confidence`));
  else sum.append(el("span", "verdict v-archive", "Archive"), el("span", "muted", ` · ${e.roi}% ROI · rare piece, shown anyway`));
  const src = platName(h.source || "vinted");
  const best = e.targets.find((t) => t.id === e.bestSellOn.id);
  const rows = [
    [`${src} price`, fmtPrice(h.price, cur)],
    e.currency !== "EUR" && [`In euro (1 € = ${e.rate} ${e.currency})`, fmtPrice(e.priceEur)],
    e.fee > 0 && [(h.source || "vinted") === "vinted" ? "Buyer protection (0.70 € + 5%)" : "Buyer fees", "+" + fmtPrice(e.fee)],
    ["Shipping to you" + (h.shipping == null && (h.source || "vinted") !== "vinted" ? " (typical)" : ""), "+" + fmtPrice(e.shipping)],
    e.duty > 0 && ["Customs duty", "+" + fmtPrice(e.duty)],
    e.vat > 0 && ["Import VAT", "+" + fmtPrice(e.vat)],
    ["Total cost", fmtPrice(e.cost), "strong"],
    [`Expected sale on ${best.name} (median −10% for offers)`, fmtPrice(e.sale)],
    e.sellFee > 0 && [`${best.name} seller fees`, "−" + fmtPrice(e.sellFee)],
    ["Sale range", `${fmtPrice(e.saleLow)}–${fmtPrice(e.saleHigh)}`],
    ["Net profit", `${fmtDiff(e.profit)} (${fmtDiff(e.profitLow)} to ${fmtDiff(e.profitHigh)})`, "strong"],
    ["Return on cost", `${e.roi}%`],
    ["Based on", best.basis === "factor" ? `Vinted price × ${best.factor} (rough estimate)` : `${e.samples ?? "a few"} comparable ${best.name} listings`],
  ].filter(Boolean);
  const t = el("table");
  for (const [k, v, cls] of rows) {
    const tr = el("tr", cls);
    tr.append(el("th", null, k), el("td", null, v));
    t.append(tr);
  }
  const buy = el("p", "flip-buy");
  buy.append(boughtBtn(h));
  d.append(sum, arbitrage(e), t, ...e.notes.map((n) => el("p", "muted", n)), buy);
  return d;
}

// "Best place to resell: Grailed, +86 € net" und darunter die anderen Ziele
function arbitrage(e) {
  const box = el("div", "arbitrage");
  const b = e.bestSellOn;
  const line = el("p", "best-sell");
  line.append("Best place to resell: ", el("b", null, `${b.name}, ${fmtDiff(b.net)} net`));
  if (b.basis === "factor") line.append(el("span", "muted", " · rough estimate"));
  box.append(line);
  const others = e.targets.filter((t) => t.id !== b.id);
  if (others.length) {
    const ul = el("ul", "sell-targets");
    for (const t of others)
      ul.append(el("li", null, `${t.name} ${fmtDiff(t.net)} net` + (t.feesSet ? "" : " · fees not set") + (t.basis === "factor" ? " · rough estimate" : "")));
    box.append(ul);
  }
  return box;
}

// Auswertung aller Snipes in der Liste
function renderAnalysis() {
  const s = watchrEval.summarize(hits.filter(visible));
  $("an-potential").textContent = fmtPrice(s.potential);
  $("an-invest").textContent = fmtPrice(s.invest);
  $("an-roi").textContent = s.avgRoi == null ? "–" : `${s.avgRoi}%`;
  $("an-strong").textContent = String(s.byRarity.epic + s.byRarity.legendary);
  $("an-mix").replaceChildren(
    ...[...watchrEval.LEVELS].reverse().map((v) => el("span", "verdict v-" + v, `${s.byRarity[v]} ${watchrEval.LABEL[v]}`)),
  );
  const body = $("an-top");
  body.replaceChildren(
    ...s.ranked.filter(({ h }) => (h.saleStatus || "active") === "active").slice(0, 3).map(({ h, e }, i) => {
      const tr = el("tr");
      const a = Object.assign(el("a", null, h.title), { href: h.url, target: "_blank", rel: "noopener" });
      a.addEventListener("click", () => markOpened(h));
      const name = el("td", "an-item");
      name.append(el("b", null, `${i + 1}. `), a);
      tr.append(
        name,
        el("td", "num", fmtPrice(h.price, h.currency)),
        el("td", "num", fmtPrice(e.cost)),
        el("td", "num", `${fmtPrice(e.saleLow)}–${fmtPrice(e.saleHigh)}`),
        el("td", "num strong " + (e.profit > 0 ? "pos" : "neg"), fmtDiff(e.profit)),
        el("td", "num", `${e.roi}%`),
      );
      const v = el("td");
      v.append(el("span", "verdict v-" + e.verdict, e.label));
      tr.append(v);
      return tr;
    }),
  );
  $("analysis").hidden = s.evaluated === 0;
}

// Rarity-Filter: der Nutzer wählt, welche Stufen er in Live Sniper sieht (im Browser gespeichert)
const RARITY_KEY = "watchr.hiddenRarities"; // gespeichert wird, was ausgeblendet ist, damit neue Stufen sichtbar starten
let hiddenRarities = new Set();
try {
  const saved = JSON.parse(localStorage.getItem(RARITY_KEY));
  if (Array.isArray(saved)) hiddenRarities = new Set(saved);
} catch {}
// Quellen-Filter (.seg): alle oder eine Plattform
const SOURCE_KEY = "watchr.sourceFilter";
let sourceFilter = "all";
try { sourceFilter = localStorage.getItem(SOURCE_KEY) || "all"; } catch {}
const visible = (h) => !hiddenRarities.has(watchrEval.rarity(h)) && (sourceFilter === "all" || (h.source || "vinted") === sourceFilter);

function renderSourceFilter() {
  const ids = [...new Set(hits.map((h) => h.source || "vinted"))];
  if (sourceFilter !== "all" && !ids.includes(sourceFilter)) ids.push(sourceFilter);
  $("source-filter").hidden = ids.length < 2;
  $("source-filter").replaceChildren(
    ...["all", ...P.IDS.filter((id) => ids.includes(id))].map((id) => {
      const b = el("button", null, id === "all" ? "All" : platName(id));
      b.type = "button";
      b.append(el("small", null, String(id === "all" ? hits.length : hits.filter((h) => (h.source || "vinted") === id).length)));
      b.setAttribute("aria-pressed", String(sourceFilter === id));
      b.onclick = () => {
        sourceFilter = id;
        try { localStorage.setItem(SOURCE_KEY, id); } catch {}
        renderHits();
      };
      return b;
    }),
  );
}
const shownHits = () => hits.filter(visible);

function renderRarityFilter() {
  $("rarity-filter").replaceChildren(
    el("span", null, "Show"),
    ...watchrEval.FILTERS.map((v) => {
      const n = hits.filter((h) => watchrEval.rarity(h) === v).length;
      const b = el("button", "verdict v-" + v, `${watchrEval.LABEL[v]} ${n}`);
      b.type = "button";
      b.setAttribute("aria-pressed", String(!hiddenRarities.has(v)));
      b.onclick = () => {
        hiddenRarities.has(v) ? hiddenRarities.delete(v) : hiddenRarities.add(v);
        try { localStorage.setItem(RARITY_KEY, JSON.stringify([...hiddenRarities])); } catch {}
        renderHits();
      };
      return b;
    }),
  );
}

function renderStats() {
  const hits = shownHits();
  $("st-today").textContent = hits.filter((h) => isToday(h.detectedAt)).length;
  $("st-prefs").textContent = searches.filter((s) => s.active).length;
  $("st-missed").textContent = hits.filter((h) => !h.openedAt).length;
  $("st-last").textContent = hits.length ? fmtTime(hits[0].detectedAt) : "–";
}

function renderHits() {
  const shown = shownHits();
  $("hits").replaceChildren(...shown.map((h) => hitNode(h, false)));
  $("hits-empty").hidden = shown.length > 0;
  $("hit-count").textContent = shown.length ? `(${shown.length})` : "";
  renderStats();
  renderAnalysis();
  renderRarityFilter();
  renderSourceFilter();
}

function addHit(h) {
  if (!watchrEval.qualifies(h)) return; // unter 20 % Rendite: gar nicht anzeigen
  if (hits.some((x) => x.id === h.id)) return;
  hits.unshift(h);
  hits = hits.slice(0, 100);
  if (!visible(h)) return; // Rarity abgewählt: merken, aber nicht zeigen und nicht melden
  $("hits").prepend(hitNode(h, true));
  while ($("hits").children.length > 100) $("hits").lastElementChild.remove();
  $("hits-empty").hidden = true;
  $("hit-count").textContent = `(${shownHits().length})`;
  renderStats();
  renderAnalysis();
  renderRarityFilter();
  renderSourceFilter();
  notify(h);
}

function renderSearches() {
  $("searches").replaceChildren(
    ...searches.map((s) => {
      const li = el("li", s.active ? "" : "paused");
      const row = el("div", "pref-row");
      const chips = el("div", "chips");
      for (const t of watchrTags.toTags(s)) chips.append(el("span", "chip static", t));
      const toggle = el("button", "btn ghost small", s.active ? "Pause" : "Resume");
      toggle.type = "button";
      toggle.onclick = () => api(`/api/searches/${s.id}`, "PATCH", { active: !s.active });
      const del = el("button", "btn ghost small", "✕");
      del.type = "button";
      del.title = "Delete";
      del.setAttribute("aria-label", "Delete");
      del.onclick = () => {
        if (del.dataset.armed) return api(`/api/searches/${s.id}`, "DELETE");
        del.dataset.armed = "1";
        del.textContent = "Delete?";
        setTimeout(() => {
          delete del.dataset.armed;
          del.textContent = "✕";
        }, 3000);
      };
      row.append(chips, toggle, del);
      li.append(row, sourceLine(s), prefTools(s));
      return li;
    }),
  );
  $("searches-empty").hidden = searches.length > 0;
  renderStats();
}

// Welche Plattformen eine Präferenz abdeckt und wie (live, per Mail, als Link)
const modeOf = (id) => (platformInfo.find((p) => p.id === id) || {}).mode || "link";
function sourceLine(s) {
  const ids = P.expand(s.sources);
  const line = el("div", "src-chips");
  const live = ids.filter((id) => modeOf(id) === "api");
  const alert = ids.filter((id) => modeOf(id) === "alert");
  const links = ids.filter((id) => modeOf(id) === "link");
  if (live.length) line.append(el("span", null, "Live:"), ...live.map((id) => el("span", "chip static", platName(id))));
  if (alert.length) line.append(el("span", null, "Email alerts:"), ...alert.map((id) => el("span", "chip static kw", platName(id))));
  if (links.length) line.append(el("span", null, links.length > 3 ? `+ ${links.length} platforms as links` : `Links: ${links.map(platName).join(", ")}`));
  return line;
}

function prefTools(s) {
  const box = el("div", "pref-tools");
  const pref = { query: s.query || (s.kind === "archive" ? "archive" : ""), minPrice: s.minPrice, maxPrice: s.maxPrice, size: s.size, condition: s.condition };
  // Alert-Plattformen: Suchauftrag dort anlegen, Mails an die Alert inbox schicken
  for (const id of P.expand(s.sources).filter((id) => modeOf(id) === "alert")) {
    const a = Object.assign(el("a", "btn small", `Create alert on ${platName(id)}`), { href: P.buildSearchUrl(id, pref, fx), target: "_blank", rel: "noopener" });
    const how = el("details", "alert-how");
    how.append(
      el("summary", null, "How to forward the alerts"),
      Object.assign(el("ol"), {
        innerHTML:
          `<li>Open the search on ${platName(id)}, sign in and save it as a search alert with email notifications.</li>` +
          `<li>Send those emails to your alert inbox: use that address on ${platName(id)}, or set an automatic forwarding rule in your mail account so the sender stays ${(P.byId(id).senders || [])[0] || ""}.</li>` +
          `<li>watchr checks the inbox every 2 minutes, reads only unread ${platName(id)} emails and marks them as read.</li>`,
      }),
    );
    box.append(a, how);
  }
  const btn = el("button", "btn small ghost", "Search everywhere");
  btn.type = "button";
  btn.setAttribute("aria-expanded", "false");
  const panel = el("div", "everywhere");
  panel.hidden = true;
  btn.onclick = () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden && !panel.childElementCount) {
      panel.append(el("p", "hint", "Opens each platform's own search in a new tab. Filters are carried over where the platform supports them."));
      const grid = el("div", "plat-links");
      for (const p of P.PLATFORMS.filter((p) => p.id !== "vinted")) {
        const l = P.searchLink(p.id, pref, fx);
        const a = Object.assign(el("a", "plat-link"), { href: l.url, target: "_blank", rel: "noopener" });
        a.append(el("b", null, p.name), el("small", null, [p.country, l.note].filter(Boolean).join(" · ")));
        grid.append(a);
      }
      panel.append(grid);
    }
  };
  box.append(btn, panel);
  return box;
}

// Plattformen, Gebühren und Alert inbox (Seitenleiste)
function renderPlatforms() {
  if (!$("platform-list")) return;
  const label = { api: "Live", alert: "Email alerts", link: "Links" };
  const rows = platformInfo.map((p) => {
    const li = el("li");
    li.append(el("b", null, p.name), el("span", "muted", ` · ${p.country}`));
    const tag = el("span", "mode m-" + p.mode, label[p.mode]);
    li.append(tag);
    if (p.mode === "link" && p.env && p.env.length) li.append(el("span", "muted small", `Live with ${p.env.join(" and ")} in .env`));
    if (feesNotSet.includes(p.id)) li.append(el("span", "fees-warn", "fees not set"));
    return li;
  });
  $("platform-list").replaceChildren(...rows);
  const ib = $("inbox-status");
  if (alertInbox.configured) {
    ib.textContent = `Alert inbox: ${alertInbox.user} on ${alertInbox.host}` + (alertInbox.lastError ? ` · ${alertInbox.lastError}` : alertInbox.lastCheck ? ` · checked ${fmtTime(alertInbox.lastCheck)}, ${alertInbox.lastHits} new` : " · waiting for the first check");
    ib.className = "inbox-status" + (alertInbox.lastError ? " error" : "");
  } else {
    ib.textContent = "Alert inbox is off. Add IMAP_HOST, IMAP_USER and IMAP_PASSWORD to the .env file next to watchr and restart it.";
    ib.className = "inbox-status";
  }
  $("fees-note").hidden = !feesNotSet.length;
  $("fees-note").textContent = `Fees not set for ${feesNotSet.length} platform${feesNotSet.length === 1 ? "" : "s"}. Their numbers use rough defaults until you edit data/fees.json.`;
}

async function api(path, method, body) {
  const res = await fetch(BACKEND + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = watchrTags.parse(e.target.tags.value);
  $("form-error").hidden = true;
  try {
    if (!f.keywords.length && f.kind !== "archive") throw new Error("Add at least one keyword, for example #nike, or use #archive.");
    await api("/api/searches", "POST", {
      kind: f.kind,
      query: f.keywords.join(" "),
      minPrice: f.minPrice,
      maxPrice: f.maxPrice,
      size: f.size,
      condition: f.condition,
      sources: f.sources,
    });
    e.target.reset();
    renderTagPreview();
  } catch (err) {
    $("form-error").textContent =
      err instanceof TypeError ? "watchr isn't reachable right now. Start it with npm start and try again." : err.message;
    $("form-error").hidden = false;
  }
});

// Live-Vorschau der gewählten Plattformen unter dem Eingabefeld
function renderTagPreview() {
  const f = watchrTags.parse($("search-form").tags.value);
  $("tag-sources").replaceChildren(el("span", null, "Platforms:"), ...watchrTags.sourceNames(f.sources).slice(0, 6).map((n) => el("span", "chip static", n)), ...(P.expand(f.sources).length > 6 ? [el("span", null, `+${P.expand(f.sources).length - 6} more`)] : []));
}
$("search-form").tags.addEventListener("input", renderTagPreview);

// Hashtags von der Startseite übernehmen (z. B. /monitor.html?tags=%23nike%20%23max80)
{
  const params = new URLSearchParams(location.search);
  const tags = params.get("tags") || (params.get("q") ? "#" + params.get("q") : "");
  if (tags) {
    $("search-form").tags.value = tags;
    $("search-form").querySelector("button").focus();
  }
  renderTagPreview();
}

// Browser-Benachrichtigungen (optional)
function notify(h) {
  if (!("Notification" in window) || Notification.permission !== "granted" || document.hasFocus()) return;
  const n = new Notification(`watchr · New match: ${h.title}`, {
    body: [
      fmtPrice(h.price, h.currency),
      h.resaleEstimate && `resale ~${fmtPrice(h.resaleEstimate, h.currency)} (${fmtDiff(h.resaleEstimate - h.price, h.currency)})`,
      h.size && `Size ${h.size}`,
    ].filter(Boolean).join(" — "),
    icon: (h.photoUrls && h.photoUrls[0]) || "logo.svg",
  });
  n.onclick = () => {
    markOpened(h);
    window.open(h.url, "_blank");
  };
}
function updateNotifyBtn() {
  const btn = $("notify-btn");
  if (!("Notification" in window)) return (btn.hidden = true);
  btn.textContent = Notification.permission === "granted" ? "Alerts on" : "Turn on alerts";
  btn.disabled = Notification.permission !== "default";
}
$("notify-btn").onclick = () => Notification.requestPermission().then(updateNotifyBtn);
updateNotifyBtn();

// WebSocket mit automatischem Wiederverbinden
let retry = 0;
function connect() {
  const ws = new WebSocket(WS_URL);
  const conn = $("conn");
  ws.onopen = () => {
    retry = 0;
    conn.className = "conn on";
    conn.textContent = "Live";
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "hello") {
      demo = false;
      $("demo-note").hidden = true;
      hits = msg.hits.filter(watchrEval.qualifies);
      searches = msg.searches;
      renderHits();
      renderSearches();
    } else if (msg.type === "hit") addHit(msg.hit);
    else if (msg.type === "hitSold") {
      // Bot hat gemeldet: dieser Snipe ist verkauft und steht jetzt unter Flips
      const i = hits.findIndex((x) => x.id === msg.hit.id);
      if (i >= 0) {
        hits[i] = { ...hits[i], ...msg.hit };
        renderHits();
      }
    }
    else if (msg.type === "hitUpdate") {
      // Dasselbe Teil wurde auf einer anderen Plattform gefunden ("Also on")
      const i = hits.findIndex((x) => x.id === msg.hit.id);
      if (i >= 0) {
        hits[i] = { ...hits[i], ...msg.hit };
        renderHits();
      }
    }
    else if (msg.type === "searches") {
      searches = msg.searches;
      renderSearches();
    }
  };
  ws.onclose = () => {
    if (!demo && !hits.length && retry === 1) showDemo();
    conn.className = "conn";
    conn.textContent = retry ? "Offline, retrying…" : "Connecting…";
    setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
  };
}
// Beispiel-Snipes, solange watchr nicht erreichbar ist (z. B. in der Vorschau)
let demo = false;
function showDemo() {
  demo = true;
  hits = watchrDemoHits().filter((h) => watchrEval.qualifies(h) && isToday(h.detectedAt));
  renderHits();
  $("demo-note").hidden = false;
}
connect();
loadStock();
loadPlatforms();
setInterval(loadPlatforms, 2 * 60_000); // Alert-inbox-Status aktuell halten
