// Live Listings Monitor: verbindet sich per WebSocket mit dem Backend und zeigt Treffer live an.
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
const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();

let hits = [];
let searches = [];

// Geöffnete Treffer ans Backend melden (für Missed Flips)
function markOpened(h) {
  if (h.openedAt) return;
  h.openedAt = new Date().toISOString();
  const url = `${BACKEND}/api/hits/${h.id}/open`;
  if (!navigator.sendBeacon?.(url)) fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  renderStats();
}

function hitNode(h, fresh) {
  const li = el("li", "listing" + (fresh ? " fresh" : ""));
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
  const prefTags = h.searchQuery ? watchrTags.toTags({ query: h.searchQuery }).join(" ") : null;
  info.append(
    link("title", h.title),
    el("span", "meta", [h.size && `Size ${h.size}`, h.brand, prefTags, fmtTime(h.detectedAt)].filter(Boolean).join(" · ")),
  );
  li.append(pics, info, el("span", "price", fmtPrice(h.price, h.currency)), link("btn small", "View"));
  return li;
}

function renderStats() {
  $("st-today").textContent = hits.filter((h) => isToday(h.detectedAt)).length;
  $("st-prefs").textContent = searches.filter((s) => s.active).length;
  $("st-missed").textContent = hits.filter((h) => !h.openedAt).length;
  $("st-last").textContent = hits.length ? fmtTime(hits[0].detectedAt) : "–";
}

function renderHits() {
  $("hits").replaceChildren(...hits.map((h) => hitNode(h, false)));
  $("hits-empty").hidden = hits.length > 0;
  $("hit-count").textContent = hits.length ? `(${hits.length})` : "";
  renderStats();
}

function addHit(h) {
  if (hits.some((x) => x.id === h.id)) return;
  hits.unshift(h);
  hits = hits.slice(0, 100);
  $("hits").prepend(hitNode(h, true));
  while ($("hits").children.length > 100) $("hits").lastElementChild.remove();
  $("hits-empty").hidden = true;
  $("hit-count").textContent = `(${hits.length})`;
  renderStats();
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
    body: [fmtPrice(h.price, h.currency), h.size && `Size ${h.size}`].filter(Boolean).join(" — "),
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
    conn.className = "conn";
    conn.textContent = retry ? "Offline, retrying…" : "Connecting…";
    setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
  };
}
connect();
