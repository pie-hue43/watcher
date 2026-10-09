// Für alle Seiten: Laufband anhalten (Auswahl wird im Browser gemerkt)
(() => {
  const ticker = document.querySelector(".ticker");
  const btn = ticker?.querySelector(".ticker-pause");
  if (!btn) return;
  const set = (paused) => {
    ticker.classList.toggle("paused", paused);
    btn.setAttribute("aria-pressed", String(paused));
    btn.setAttribute("aria-label", paused ? "Play the moving banner" : "Pause the moving banner");
  };
  let paused = false;
  try { paused = localStorage.getItem("watchr.tickerPaused") === "1"; } catch {}
  set(paused);
  btn.addEventListener("click", () => {
    paused = !paused;
    set(paused);
    try { localStorage.setItem("watchr.tickerPaused", paused ? "1" : "0"); } catch {}
  });
})();

// Link auf eine FAQ-Frage (z. B. faq.html#hashtags) klappt sie direkt auf
(() => {
  const open = () => {
    const el = location.hash && document.getElementById(location.hash.slice(1));
    if (el && el.tagName === "DETAILS") el.open = true;
  };
  open();
  addEventListener("hashchange", open);
})();

// Stock im Menü: Anzahl offener "Next up"-Aufgaben (nur wenn watchr läuft; die Stock-Seite setzt sie selbst)
window.watchrSetStockCount = (n) => {
  for (const b of document.querySelectorAll(".site-nav .nav-count")) {
    b.textContent = String(n);
    b.hidden = !n;
    b.title = n ? `${n} open task${n === 1 ? "" : "s"} in Stock` : "";
  }
};
(() => {
  if (!document.querySelector(".site-nav .nav-count") || /stock(\.html)?$/.test(location.pathname)) return;
  const backend = (window.WATCHER_BACKEND || location.origin).replace(/\/$/, "");
  fetch(backend + "/api/stock/next")
    .then((r) => (r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : null))
    .then((list) => Array.isArray(list) && window.watchrSetStockCount(list.length))
    .catch(() => {});
})();
