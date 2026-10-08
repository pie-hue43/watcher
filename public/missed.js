// Flips: alle gefundenen Listings, gruppiert nach Tag; nicht geöffnete gelten als verpasst.
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
const prefLabel = (h) => watchrTags.toTags({ query: h.searchQuery || "", kind: h.searchKind }).join(" ");
const fmtDay = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
};
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

let hits = [];
let filter = null; // searchQuery oder null = alle
let missedOnly = false;

// Ranking der verkauften Flips: was der Bot als verkauft gemeldet hat, nach geschätztem Netto-Gewinn
function renderSold() {
  const sold = hits
    .filter((h) => h.saleStatus === "sold")
    .map((h) => ({ h, e: watchrEval.evaluate(h) }))
    .filter((x) => x.e && x.e.qualifies)
    .sort((a, b) => b.e.profit - a.e.profit);
  $("m-sold").textContent = sold.length;
  $("sold-rank").hidden = sold.length === 0;
  $("sold-n").textContent = sold.length;
  $("sold-sum").textContent = fmtPrice(Math.round(sold.reduce((s, x) => s + x.e.profit, 0)));
  $("sold-list").replaceChildren(
    ...sold.slice(0, 20).map(({ h, e }, i) => {
      const li = el("li", `lb-row r-${e.verdict}` + (i < 3 ? ` podium p${i + 1}` : ""));
      li.append(el("span", "lb-rank", i < 3 ? ["🥇", "🥈", "🥉"][i] : String(i + 1)));
      const name = el("div", "lb-name");
      const a = Object.assign(el("a", null, h.title), { href: h.url, target: "_blank", rel: "noopener" });
      const when = h.soldAt ? `sold ${fmtDay(h.soldAt).replace(/^(Today|Yesterday)$/, (d) => d.toLowerCase())}` : "sold";
      name.append(a, el("span", "meta", `${fmtPrice(h.price, h.currency)} → ~${fmtPrice(e.sale, h.currency)} · ${when}${h.openedAt ? "" : " · missed"}`));
      li.append(name, el("span", "verdict v-" + e.verdict, e.label), el("span", "lb-profit", fmtDiff(e.profit, h.currency)), el("span", "lb-roi", `${e.roi}%`));
      return li;
    }),
  );
}

function render() {
  renderSold();
  const missed = hits.filter((h) => !h.openedAt);
  $("m-total").textContent = hits.length;
  $("m-missed").textContent = missed.length;
  $("m-opened").textContent = hits.length - missed.length;
  $("m-value").textContent = fmtPrice(missed.reduce((sum, h) => sum + h.price, 0));
  // geschätzte Spanne nur aus verpassten Treffern mit Resellpreis über dem Vinted-Preis
  $("m-margin").textContent = fmtPrice(missed.reduce((sum, h) => sum + (h.resaleEstimate > h.price ? h.resaleEstimate - h.price : 0), 0));

  // Filter: eine Schaltfläche pro Präferenz, die Treffer hat
  const prefOf = (h) => (h.searchKind || h.searchQuery ? prefLabel(h) : null);
  const prefs = [...new Set(hits.map(prefOf).filter(Boolean))];
  const box = $("filters");
  const btn = (label, value, count) => {
    const b = el("button", null, `${label} (${count})`);
    b.type = "button";
    b.setAttribute("aria-pressed", String(filter === value));
    b.onclick = () => {
      filter = value;
      render();
    };
    return b;
  };
  const toggle = el("label");
  const cb = Object.assign(el("input"), { type: "checkbox", checked: missedOnly, id: "missed-only" });
  cb.onchange = () => {
    missedOnly = cb.checked;
    render();
  };
  toggle.append(cb, "Missed only");
  box.replaceChildren(
    btn("All", null, hits.length),
    ...prefs.map((p) => btn(p, p, hits.filter((h) => prefOf(h) === p).length)),
    toggle,
  );

  const shown = hits.filter((h) => (filter === null || prefOf(h) === filter) && (!missedOnly || !h.openedAt));
  const days = new Map();
  for (const h of shown) {
    const key = new Date(h.detectedAt).toDateString();
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(h);
  }
  $("ledger").replaceChildren(
    ...[...days.values()].map((list) => {
      const day = el("div", "day");
      day.append(el("h2", null, `${fmtDay(list[0].detectedAt)} · ${list.length}`));
      const wrap = el("div", "table-wrap");
      const table = el("table");
      table.innerHTML = "<thead><tr><th>Found</th><th>Listing</th><th>Preference</th><th>Price</th><th>Resale est.</th><th>Difference</th><th>Status</th></tr></thead>";
      const body = el("tbody");
      for (const h of list) {
        const tr = el("tr");
        const item = el("div", "item");
        const photo = h.photoUrls && h.photoUrls[0];
        item.append(photo ? Object.assign(el("img"), { src: photo, alt: "", loading: "lazy", referrerPolicy: "no-referrer" }) : el("span", "ph"));
        const text = el("div");
        const a = Object.assign(el("a", null, h.title), { href: h.url, target: "_blank", rel: "noopener" });
        text.append(a, el("small", null, [h.size && `Size ${h.size}`, h.brand].filter(Boolean).join(" · ")));
        if (h.archiveScore >= 50) {
          const b = el("span", "arch");
          b.append("Archive ", el("b", null, String(h.archiveScore)), h.designer ? ` · ${h.designer}` : "");
          text.append(b);
        }
        // kompakte Preiszeile für schmale Bildschirme
        const mp = el("div", "m-price");
        mp.append(el("b", null, fmtPrice(h.price, h.currency)));
        if (h.resaleEstimate) {
          const d = h.resaleEstimate - h.price;
          mp.append(el("span", "resale", `Resale ~${fmtPrice(h.resaleEstimate, h.currency)}`), el("span", "diff " + (d >= 0 ? "up" : "down"), fmtDiff(d, h.currency)));
        }
        text.append(mp);
        item.append(text);
        const cells = [
          el("td", "time", fmtTime(h.detectedAt)),
          Object.assign(el("td"), {}),
          el("td", "muted", prefOf(h) || "–"),
          el("td", "num", fmtPrice(h.price, h.currency)),
          el("td", "num muted", h.resaleEstimate ? `~${fmtPrice(h.resaleEstimate, h.currency)}` : "–"),
          el("td", "num"),
          el("td"),
        ];
        cells[1].append(item);
        if (h.resaleEstimate) {
          const d = h.resaleEstimate - h.price;
          cells[5].append(el("span", "diff " + (d >= 0 ? "up" : "down"), fmtDiff(d, h.currency)));
        } else cells[5].textContent = "–";
        cells[6].append(el("span", "status " + (h.openedAt ? "opened" : "missed"), h.openedAt ? "Opened" : "Missed"));
        if (h.saleStatus === "sold") cells[6].append(" ", el("span", "status sold", "Sold"));
        tr.append(...cells);
        body.append(tr);
      }
      table.append(body);
      wrap.append(table);
      day.append(wrap);
      return day;
    }),
  );
  $("ledger-empty").hidden = shown.length > 0;
}

async function load() {
  try {
    const res = await fetch(`${BACKEND}/api/hits?limit=200`);
    if (!res.ok) throw new Error();
    hits = (await res.json()).filter(watchrEval.qualifies); // nur Snipes mit mindestens 20 % geschätzter Rendite
    $("demo-note").hidden = true;
  } catch {
    // Vorschau ohne Backend: Beispieldaten statt leerer Seite
    if (!hits.length || !$("demo-note").hidden) {
      hits = watchrDemoHits().filter(watchrEval.qualifies);
      $("demo-note").hidden = false;
    }
  }
  render();
}
load();
setInterval(load, 60_000);
