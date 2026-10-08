// watchr Dashboard: verbindet sich per WebSocket mit dem Backend und zeigt Treffer live an.
// Läuft das Dashboard auf einer anderen Domain als das Backend, vorher setzen:
//   <script>window.WATCHER_BACKEND = "https://watcher.meine-seite.de";</script>
const BACKEND = (window.WATCHER_BACKEND || location.origin).replace(/\/$/, "");
const WS_URL = BACKEND.replace(/^http/, "ws") + "/ws";

const $ = (id) => document.getElementById(id);
const fmtPrice = (p, cur) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: cur || "EUR", maximumFractionDigits: p % 1 ? 2 : 0 }).format(p);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

let hits = [];
let searches = [];

function hitNode(h, fresh) {
  const node = $("hit-tpl").content.firstElementChild.cloneNode(true);
  if (fresh) node.classList.add("fresh");
  const thumbs = node.querySelector(".thumbs");
  const photos = (h.photoUrls || []).slice(0, 3);
  if (!photos.length) thumbs.append(Object.assign(document.createElement("div"), { className: "thumb empty" }));
  for (const src of photos) {
    const a = Object.assign(document.createElement("a"), { href: h.url, target: "_blank", rel: "noopener" });
    a.append(Object.assign(document.createElement("img"), { src, alt: "", loading: "lazy", referrerPolicy: "no-referrer", className: "thumb" }));
    thumbs.append(a);
  }
  const title = node.querySelector(".title");
  title.textContent = h.title;
  title.href = h.url;
  const meta = [h.size && `Size ${h.size}`, h.brand, h.searchQuery && `#${h.searchQuery.split(/\s+/).join(" #")}`, fmtTime(h.detectedAt)];
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
      q.textContent = watchrTags.toTags(s).join(" ");
      const toggle = document.createElement("button");
      toggle.className = "ghost small";
      toggle.textContent = s.active ? "Pause" : "Resume";
      toggle.onclick = () => api(`/api/searches/${s.id}`, "PATCH", { active: !s.active });
      const del = document.createElement("button");
      del.className = "ghost small";
      del.textContent = "✕";
      del.title = "Delete";
      del.setAttribute("aria-label", "Delete");
      del.onclick = () => {
        if (del.dataset.armed) return api(`/api/searches/${s.id}`, "DELETE");
        del.dataset.armed = "1";
        del.textContent = "Delete?";
        setTimeout(() => { delete del.dataset.armed; del.textContent = "✕"; }, 3000);
      };
      const txt = document.createElement("div");
      txt.className = "txt";
      txt.append(q);
      li.append(txt, toggle, del);
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
  const f = watchrTags.parse(e.target.tags.value);
  $("form-error").hidden = true;
  try {
    if (!f.keywords.length) throw new Error("Add at least one keyword, for example #nike.");
    await api("/api/searches", "POST", {
      query: f.keywords.join(" "),
      minPrice: f.minPrice,
      maxPrice: f.maxPrice,
      size: f.size,
      condition: f.condition,
    });
    e.target.reset();
  } catch (err) {
    $("form-error").textContent = err.message;
    $("form-error").hidden = false;
  }
});

// Suchbegriff aus der Landingpage übernehmen (z. B. /?q=Sneaker)
// Preferences handed over from the landing page (e.g. /?tags=%23nike%20%23max80)
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
    body: [fmtPrice(h.price, h.currency), h.size && `Size ${h.size}`].filter(Boolean).join(" — "),
    icon: (h.photoUrls && h.photoUrls[0]) || "logo.svg",
  });
  n.onclick = () => window.open(h.url, "_blank");
}
function updateNotifyBtn() {
  const btn = $("notify-btn");
  if (!("Notification" in window)) return (btn.hidden = true);
  btn.textContent = Notification.permission === "granted" ? "🔔 Notifications on" : "🔔 Notifications";
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
    conn.textContent = "Disconnected, reconnecting…";
    setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
  };
}
connect();
