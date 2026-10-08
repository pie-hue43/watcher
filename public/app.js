// watchr Dashboard: verbindet sich per WebSocket mit dem Backend und zeigt Treffer live an.
// Läuft das Dashboard auf einer anderen Domain als das Backend, vorher setzen:
//   <script>window.WATCHER_BACKEND = "https://watcher.meine-seite.de";</script>
const BACKEND = (window.WATCHER_BACKEND || location.origin).replace(/\/$/, "");
const WS_URL = BACKEND.replace(/^http/, "ws") + "/ws";

const $ = (id) => document.getElementById(id);
const fmtPrice = (p, cur) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: cur || "EUR", maximumFractionDigits: p % 1 ? 2 : 0 }).format(p);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

let hits = [];
let searches = [];

function hitNode(h, fresh) {
  const node = $("hit-tpl").content.firstElementChild.cloneNode(true);
  if (fresh) node.classList.add("fresh");
  if (h.photoUrl) node.querySelector(".thumb").style.backgroundImage = `url("${encodeURI(h.photoUrl)}")`;
  const title = node.querySelector(".title");
  title.textContent = h.title;
  title.href = h.url;
  const meta = [h.size && `Größe ${h.size}`, h.brand, h.searchQuery && `Suche: ${h.searchQuery}`, fmtTime(h.detectedAt)];
  node.querySelector(".meta").textContent = meta.filter(Boolean).join(" · ");
  node.querySelector(".price").textContent = fmtPrice(h.price, h.currency);
  node.querySelector(".cta").href = h.url;
  return node;
}

function renderHits() {
  $("hits").replaceChildren(...hits.map((h) => hitNode(h, false)));
  $("hits-empty").hidden = hits.length > 0;
  $("hit-count").textContent = hits.length ? `(${hits.length})` : "";
}

function addHit(h) {
  if (hits.some((x) => x.id === h.id)) return;
  hits.unshift(h);
  hits = hits.slice(0, 100);
  $("hits").prepend(hitNode(h, true));
  while ($("hits").children.length > 100) $("hits").lastElementChild.remove();
  $("hits-empty").hidden = true;
  $("hit-count").textContent = `(${hits.length})`;
  notify(h);
}

function renderSearches() {
  $("searches").replaceChildren(
    ...searches.map((s) => {
      const li = document.createElement("li");
      li.className = "search" + (s.active ? "" : " paused");
      const q = document.createElement("span");
      q.className = "q";
      q.textContent = s.query;
      const f = document.createElement("span");
      f.className = "f";
      f.textContent = [s.maxPrice != null && `Max. ${fmtPrice(s.maxPrice, "EUR")}`, s.size && `Gr. ${s.size}`]
        .filter(Boolean)
        .join(" · ");
      const toggle = document.createElement("button");
      toggle.className = "ghost small";
      toggle.textContent = s.active ? "Pause" : "Start";
      toggle.onclick = () => api(`/api/searches/${s.id}`, "PATCH", { active: !s.active });
      const del = document.createElement("button");
      del.className = "ghost small";
      del.textContent = "✕";
      del.title = "Löschen";
      del.onclick = () => confirm(`Suchauftrag „${s.query}“ löschen?`) && api(`/api/searches/${s.id}`, "DELETE");
      li.append(q, f, toggle, del);
      return li;
    }),
  );
  $("searches-empty").hidden = searches.length > 0;
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
  const fd = new FormData(e.target);
  $("form-error").hidden = true;
  try {
    await api("/api/searches", "POST", {
      query: fd.get("query"),
      maxPrice: fd.get("maxPrice") || null,
      size: fd.get("size") || null,
    });
    e.target.reset();
  } catch (err) {
    $("form-error").textContent = err.message;
    $("form-error").hidden = false;
  }
});

// Suchbegriff aus der Landingpage übernehmen (z. B. /?q=Sneaker)
const presetQuery = new URLSearchParams(location.search).get("q");
if (presetQuery) {
  const form = $("search-form");
  form.query.value = presetQuery;
  form.maxPrice.focus();
}

// Browser-Benachrichtigungen (optional)
function notify(h) {
  if (!("Notification" in window) || Notification.permission !== "granted" || document.hasFocus()) return;
  const n = new Notification(`watchr · Neuer Treffer: ${h.title}`, {
    body: [fmtPrice(h.price, h.currency), h.size && `Größe ${h.size}`].filter(Boolean).join(" — "),
    icon: h.photoUrl || "logo.svg",
  });
  n.onclick = () => window.open(h.url, "_blank");
}
function updateNotifyBtn() {
  const btn = $("notify-btn");
  if (!("Notification" in window)) return (btn.hidden = true);
  btn.textContent = Notification.permission === "granted" ? "🔔 Benachrichtigungen an" : "🔔 Benachrichtigungen";
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
      hits = msg.hits;
      searches = msg.searches;
      renderHits();
      renderSearches();
    } else if (msg.type === "hit") addHit(msg.hit);
    else if (msg.type === "searches") {
      searches = msg.searches;
      renderSearches();
    }
  };
  ws.onclose = () => {
    conn.className = "conn off";
    conn.textContent = "Getrennt, verbinde neu…";
    setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
  };
}
connect();
