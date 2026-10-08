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

// Geöffnete Treffer ans Backend melden (für Flips)
function markOpened(h) {
  if (h.openedAt || demo) return;
  h.openedAt = new Date().toISOString();
  const url = `${BACKEND}/api/hits/${h.id}/open`;
  if (!navigator.sendBeacon?.(url)) fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  renderStats();
}

function hitNode(h, fresh) {
  const ev = watchrEval.evaluate(h);
  const li = el("li", "listing" + (fresh ? " fresh" : "") + (ev ? " r-" + ev.verdict : ""));
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
  info.append(
    link("title", h.title),
    el("span", "meta", [h.size && `Size ${h.size}`, h.brand, prefTags, fmtTime(h.detectedAt)].filter(Boolean).join(" · ")),
  );
  if (h.archiveScore >= 50) info.append(archBadge(h));
  if (h.saleStatus === "sold") info.append(el("span", "sold-tag", "Sold · in Flips"));
  li.append(pics, info, pricing(h), link("btn small", "View"));
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
  if (e) {
    const r = el("span", "resale", h.resaleLow ? `Resale ${fmtPrice(h.resaleLow, h.currency)}–${fmtPrice(h.resaleHigh, h.currency)}` : `Resale ~${fmtPrice(h.resaleEstimate, h.currency)}`);
    r.title = `Median ${fmtPrice(h.resaleEstimate, h.currency)} from ${h.resaleSamples ?? "several"} comparable Vinted listings`;
    box.append(r, el("span", "diff " + (e.profit > 0 ? "up" : "down"), `Net ${fmtDiff(e.profit, h.currency)}`));
  }
  return box;
}

// Aufklappbare Flip-Auswertung unter jedem Snipe
function flipCheck(h) {
  const e = watchrEval.evaluate(h);
  if (!e) return null;
  const cur = h.currency;
  const d = el("details", "flip-check");
  const sum = el("summary");
  sum.append(el("span", "verdict v-" + e.verdict, e.label), el("span", "muted", ` · ${e.roi}% ROI · ${e.confidence} confidence`));
  const rows = [
    ["Vinted price", fmtPrice(h.price, cur)],
    ["Buyer protection (0.70 € + 5%)", "+" + fmtPrice(e.fee, cur)],
    ["Shipping to you", "+" + fmtPrice(e.shipping, cur)],
    ["Total cost", fmtPrice(e.cost, cur), "strong"],
    ["Expected sale (median −10% for offers)", fmtPrice(e.sale, cur)],
    ["Sale range", `${fmtPrice(e.saleLow, cur)}–${fmtPrice(e.saleHigh, cur)}`],
    ["Net profit", `${fmtDiff(e.profit, cur)} (${fmtDiff(e.profitLow, cur)} to ${fmtDiff(e.profitHigh, cur)})`, "strong"],
    ["Return on cost", `${e.roi}%`],
    ["Based on", `${e.samples ?? "a few"} comparable listings`],
  ];
  const t = el("table");
  for (const [k, v, cls] of rows) {
    const tr = el("tr", cls);
    tr.append(el("th", null, k), el("td", null, v));
    t.append(tr);
  }
  d.append(sum, t, ...e.notes.map((n) => el("p", "muted", n)));
  return d;
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
    ...s.ranked.slice(0, 10).map(({ h, e }, i) => {
      const tr = el("tr");
      const a = Object.assign(el("a", null, h.title), { href: h.url, target: "_blank", rel: "noopener" });
      a.addEventListener("click", () => markOpened(h));
      const name = el("td", "an-item");
      name.append(el("b", null, `${i + 1}. `), a);
      tr.append(
        name,
        el("td", "num", fmtPrice(h.price, h.currency)),
        el("td", "num", fmtPrice(e.cost, h.currency)),
        el("td", "num", `${fmtPrice(e.saleLow, h.currency)}–${fmtPrice(e.saleHigh, h.currency)}`),
        el("td", "num strong " + (e.profit > 0 ? "pos" : "neg"), fmtDiff(e.profit, h.currency)),
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
const RARITY_KEY = "watchr.rarities";
let shownRarities = new Set(watchrEval.LEVELS);
try {
  const saved = JSON.parse(localStorage.getItem(RARITY_KEY));
  if (Array.isArray(saved)) shownRarities = new Set(saved.filter((v) => watchrEval.LEVELS.includes(v)));
} catch {}
const visible = (h) => shownRarities.has(watchrEval.evaluate(h)?.verdict);
const shownHits = () => hits.filter(visible);

function renderRarityFilter() {
  $("rarity-filter").replaceChildren(
    el("span", null, "Show"),
    ...watchrEval.LEVELS.map((v) => {
      const n = hits.filter((h) => watchrEval.evaluate(h)?.verdict === v).length;
      const b = el("button", "verdict v-" + v, `${watchrEval.LABEL[v]} ${n}`);
      b.type = "button";
      b.setAttribute("aria-pressed", String(shownRarities.has(v)));
      b.onclick = () => {
        shownRarities.has(v) ? shownRarities.delete(v) : shownRarities.add(v);
        try { localStorage.setItem(RARITY_KEY, JSON.stringify([...shownRarities])); } catch {}
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
  notify(h);
}

function renderSearches() {
  $("searches").replaceChildren(
    ...searches.map((s) => {
      const li = el("li", s.active ? "" : "paused");
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
      li.append(chips, toggle, del);
      return li;
    }),
  );
  $("searches-empty").hidden = searches.length > 0;
  renderStats();
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
    });
    e.target.reset();
  } catch (err) {
    $("form-error").textContent =
      err instanceof TypeError ? "watchr isn't reachable right now. Start it with npm start and try again." : err.message;
    $("form-error").hidden = false;
  }
});

// Hashtags von der Startseite übernehmen (z. B. /monitor.html?tags=%23nike%20%23max80)
{
  const params = new URLSearchParams(location.search);
  const tags = params.get("tags") || (params.get("q") ? "#" + params.get("q") : "");
  if (tags) {
    $("search-form").tags.value = tags;
    $("search-form").querySelector("button").focus();
  }
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
