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
