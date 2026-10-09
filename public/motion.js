// Sanftes Einblenden von Abschnitten und Kästen beim Reinscrollen, dazu eine
// Frame-Schleife mit Scroll-Tempo für Seiten-Skripte (window.watchrMotion).
// Bei "Bewegung reduzieren" im System bleibt alles ruhig stehen.
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;

  const subs = [];
  const state = { y: scrollY, v: 0, dir: 1, t: 0, reduce };
  window.watchrMotion = { onFrame: (fn) => subs.push(fn), state, observe: () => {} };
  if (reduce) return;
  root.classList.add("js-motion");

  let last = performance.now(), lastY = scrollY;
  const frame = (now) => {
    const dt = Math.min(64, now - last) / 1000;
    last = now;
    const y = scrollY;
    const raw = dt ? (y - lastY) / dt : 0;
    lastY = y;
    state.v += (raw - state.v) * 0.18;
    if (Math.abs(raw) > 30) state.dir = raw > 0 ? 1 : -1;
    else if (Math.abs(state.v) < 20) state.dir = 1;
    state.y = y;
    state.t += dt;
    for (const fn of subs) fn(dt, state);
    if (subs.length) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Einblenden: Elemente der Hauptspalte bekommen .reveal, Geschwister nacheinander
  const sel = "main .section-head, main .page-head, main .card, main .stat, main .panel, main details, main .lb-row, main .demo, main .faq-more, main .table-wrap";
  const items = [...document.querySelectorAll(sel)].filter((el) => !el.closest(".hero, .no-reveal") && !el.parentElement.closest(".reveal"));
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add("in");
      io.unobserve(e.target);
    }),
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
  );
  for (const el of items) {
    const sibs = [...el.parentElement.children].filter((c) => c.matches(sel));
    el.style.setProperty("--i", String(Math.min(6, sibs.indexOf(el))));
    el.classList.add("reveal");
    io.observe(el);
  }
  window.watchrMotion.observe = (el) => io.observe(el);
})();
