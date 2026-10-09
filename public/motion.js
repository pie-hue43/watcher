// Bewegung für alle Seiten: Einblenden, Textmarker, Laufband nach Scroll-Tempo,
// Fortschrittslinie, Hintergrund-Wolken und Buttons, die leicht zur Maus ziehen.
// Bei "Bewegung reduzieren" im System bleibt alles ruhig stehen.
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const root = document.documentElement;

  // Hintergrund (auch ohne Bewegung, dann eben still)
  const fx = document.createElement("div");
  fx.className = "bg-fx";
  fx.setAttribute("aria-hidden", "true");
  fx.innerHTML =
    '<div class="blob-wrap" style="left:-14vmax;top:-10vmax"><div class="blob"></div></div>' +
    '<div class="blob-wrap" style="right:-18vmax;top:30vh"><div class="blob"></div></div>' +
    '<div class="blob-wrap" style="left:20vw;top:85vh"><div class="blob"></div></div>' +
    '<div class="grid"></div><div class="grain"></div>';
  document.body.prepend(fx);

  // Fortschrittslinie unter dem Header
  const header = document.querySelector(".site-header");
  const bar = document.createElement("div");
  bar.className = "scroll-progress";
  header?.append(bar);

  // Gemeinsame Frame-Schleife mit Scroll-Tempo, auch für Seiten-Skripte (window.watchrMotion)
  const subs = [];
  const state = { y: scrollY, v: 0, dir: 1, t: 0, reduce, fine };
  window.watchrMotion = { onFrame: (fn) => subs.push(fn), state };
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
    const max = root.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
    for (const fn of subs) fn(dt, state);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (reduce) return;
  root.classList.add("js-motion");

  // Wolken wandern beim Scrollen mit
  const blobs = [...fx.querySelectorAll(".blob-wrap")];
  subs.push((dt, s) => blobs.forEach((b, i) => (b.style.transform = `translate3d(0, ${-s.y * (0.08 + i * 0.05)}px, 0)`)));

  // Laufband: schneller beim Scrollen, rückwärts beim Hochscrollen
  const ticker = document.querySelector(".ticker");
  const track = ticker?.querySelector(".ticker-track");
  if (track) {
    let x = 0;
    subs.push((dt, s) => {
      if (ticker.classList.contains("paused")) return;
      const half = track.scrollWidth / 2;
      const speed = 45 + Math.min(900, Math.abs(s.v) * 0.9);
      x -= speed * dt * s.dir;
      if (x <= -half) x += half;
      if (x > 0) x -= half;
      track.style.transform = `translate3d(${x}px,0,0)`;
    });
  }

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
  // Textmarker
  document.querySelectorAll(".mark").forEach((m) => io.observe(m));
  window.watchrMotion.observe = (el) => io.observe(el);

  // Buttons ziehen minimal zur Maus (nur mit Maus)
  if (fine)
    document.querySelectorAll(".btn").forEach((b) => {
      b.addEventListener("mousemove", (e) => {
        const r = b.getBoundingClientRect();
        const dx = (e.clientX - r.left - r.width / 2) / r.width, dy = (e.clientY - r.top - r.height / 2) / r.height;
        b.style.transform = `translate(${dx * 8}px, ${dy * 6}px)`;
      });
      b.addEventListener("mouseleave", () => (b.style.transform = ""));
    });
})();
