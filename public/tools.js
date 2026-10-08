// AI Tools: zehn Werkzeuge, jedes als eigenes Panel. Daten kommen vom watchr-Backend (/api/tools/…).
const BACKEND = (window.WATCHER_BACKEND || location.origin).replace(/\/$/, "");
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const eur = (p, cur = "EUR") =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: cur || "EUR", maximumFractionDigits: p % 1 ? 2 : 0 }).format(p);
const signed = (d, cur) => (d >= 0 ? "+" : "−") + eur(Math.abs(Math.round(d)), cur);

let status = { ai: false, vinted: false, cutout: false, online: false };

async function api(path, body) {
  let res;
  try {
    res = await fetch(BACKEND + "/api/tools" + path, body === undefined ? {} : { method: body === null ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: body === null ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error("watchr isn't reachable right now. Start it with npm start and open this page from there.");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Something went wrong (HTTP ${res.status}).`);
  return data;
}

// Kleine Bausteine
function field(label, input) {
  const w = el("label", "tf");
  w.append(el("span", null, label), input);
  return w;
}
function inp(name, placeholder, type = "text") {
  return Object.assign(el(type === "textarea" ? "textarea" : "input"), { name, placeholder, ...(type === "textarea" ? { rows: 3 } : { type }) });
}
function form(fields, button, onSubmit) {
  const f = el("form", "tool-form");
  const btn = el("button", "btn", button);
  btn.type = "submit";
  const err = el("p", "error");
  err.hidden = true;
  f.append(...fields, btn, err);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Working…";
    try {
      await onSubmit(new FormData(f), f);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
  return f;
}
function note(text) {
  return el("p", "tool-note", text);
}
function copyBtn(getText) {
  const b = el("button", "btn ghost small", "Copy");
  b.type = "button";
  b.onclick = async () => {
    await navigator.clipboard?.writeText(getText()).catch(() => {});
    b.textContent = "Copied";
    setTimeout(() => (b.textContent = "Copy"), 1500);
  };
  return b;
}
function listingRow(h, right) {
  const li = el("li", "listing");
  const pic = h.photoUrls?.[0] || h.photoUrl;
  li.append(pic ? Object.assign(el("img", "pic"), { src: pic, alt: "", loading: "lazy", referrerPolicy: "no-referrer" }) : el("div", "pic"));
  const info = el("div");
  const a = Object.assign(el("a", "title", h.title), { href: h.url, target: "_blank", rel: "noopener" });
  info.append(a, el("span", "meta", [h.size && `Size ${h.size}`, h.brand, h.detectedAt && new Date(h.detectedAt).toLocaleDateString("en-GB")].filter(Boolean).join(" · ")));
  li.append(info, right);
  return li;
}
function empty(text) {
  return el("p", "empty", text);
}
function loadInto(box, loader) {
  box.replaceChildren(el("p", "empty", "Loading…"));
  loader().then(
    (nodes) => box.replaceChildren(...nodes),
    (err) => box.replaceChildren(el("p", "error", err.message)),
  );
}
function readFileAsDataUrl(file, maxSide = 1600) {
  // Fotos vor dem Hochladen verkleinern (schneller, günstiger)
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => reject(new Error("This file isn't a photo watchr can read."));
    img.src = URL.createObjectURL(file);
  });
}
const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Photo couldn't be loaded."));
    img.src = src;
  });

// ---------- Die zehn Tools ----------
const TOOLS = [
  {
    id: "photo-enhancer", name: "AI Photo Enhancer", desc: "Studio backgrounds for your listing photos", ai: true,
    render(box) {
      const file = Object.assign(el("input"), { type: "file", accept: "image/*", name: "photo", required: true });
      const bg = el("select");
      bg.name = "bg";
      for (const [v, t] of [["white", "Clean white"], ["studio", "Studio grey"], ["green", "Soft green"]]) bg.append(Object.assign(el("option", null, t), { value: v }));
      const out = el("div", "photo-out");
      box.append(
        form([field("Photo", file), field("Background", bg)], "Enhance photo", async (fd) => {
          const dataUrl = await readFileAsDataUrl(fd.get("photo"), 2000);
          let cut = null;
          if (status.cutout) {
            const res = await fetch(BACKEND + "/api/tools/cutout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photo: dataUrl }) });
            if (res.ok) cut = await loadImage(URL.createObjectURL(await res.blob()));
          }
          const src = await loadImage(dataUrl);
          const canvas = studio(cut || src, !!cut, fd.get("bg"));
          const link = Object.assign(el("a", "btn", "Download photo"), { href: canvas.toDataURL("image/jpeg", 0.92), download: "watchr-photo.jpg" });
          const side = el("div", "photo-side");
          side.append(link, note(cut ? "Background removed and placed on a studio backdrop." : "Light, contrast and framing improved. Background removal needs a remove.bg key on the server."));
          out.replaceChildren(canvas, side);
        }),
        out,
      );
    },
  },
  {
    id: "price-estimator", name: "Price Estimator", desc: "Resale price from comparable live Vinted listings",
    render(box) {
      const out = el("div");
      box.append(
        form([field("Listing link or item", inp("q", "https://www.vinted.de/items/… or “Ralph Lauren polo”"))], "Estimate price", async (fd) => {
          const q = String(fd.get("q")).trim();
          const r = await api("/price", /vinted\.|\/items\//.test(q) ? { url: q } : { title: q });
          if (!r.ref) return out.replaceChildren(empty(`Not enough comparable listings for “${r.product}” yet.`));
          const tiles = el("div", "stats");
          const tile = (v, l) => {
            const t = el("div", "stat");
            t.append(el("b", null, v), el("span", null, l));
            return t;
          };
          tiles.append(tile(eur(r.ref.median), "Resale estimate"), tile(`${eur(r.ref.low)}–${eur(r.ref.high)}`, "Typical range"), tile(String(r.ref.samples), "Listings compared"));
          if (r.difference != null) tiles.append(tile(signed(r.difference), `vs. asking price ${eur(r.item.price)}`));
          out.replaceChildren(el("h3", null, r.item.title || r.product), tiles, note(`Median asking price of comparable “${r.product}” listings on Vinted, outliers removed. Asking prices, not sold prices.`));
        }),
        out,
      );
    },
  },
  {
    id: "niche-finder", name: "Niche Finder", desc: "Product groups where your finds sell for 2× or more",
    render(box) {
      const out = el("div");
      box.append(out);
      loadInto(out, async () => {
        const list = await api("/niches");
        if (!list.length) return [empty("No niches yet. They appear once watchr has found a few listings of the same kind with a resale estimate.")];
        const t = el("table");
        t.innerHTML = "<thead><tr><th>Niche</th><th>Finds</th><th>Typical buy</th><th>Resale</th><th>Margin</th></tr></thead>";
        const body = el("tbody");
        for (const n of list) {
          const tr = el("tr");
          const m = el("td");
          m.append(el("span", "diff " + (n.multiple >= 2 ? "up" : ""), `${n.multiple}×`));
          tr.append(el("td", "strong", n.product), el("td", null, String(n.finds)), el("td", null, eur(n.typicalBuy)), el("td", null, eur(n.resale)), m);
          body.append(tr);
        }
        t.append(body);
        const wrap = el("div", "table-wrap");
        wrap.append(t);
        return [wrap, note("Based on the listings watchr found for you and their resale estimates.")];
      });
    },
  },
  {
    id: "deal-finder", name: "Deal Finder", desc: "Underpriced listings ranked by return",
    render(box) {
      const out = el("ul", "listings");
      box.append(out);
      loadInto(out, async () => {
        const list = await api("/deals?days=7");
        if (!list.length) return [empty("No deals in the last 7 days yet. Add preferences in Live Listings and check back.")];
        return list.map((h) => {
          const r = el("div", "pricing");
          r.append(el("span", "price", eur(h.price, h.currency)), el("span", "resale", `Resale ~${eur(h.resaleEstimate, h.currency)}`), el("span", "diff up", `${h.roi}% · ${signed(h.profit, h.currency)}`));
          return listingRow(h, r);
        });
      });
    },
  },
  {
    id: "offer-finder", name: "Offer Finder", desc: "Listings worth sending an offer on",
    render(box) {
      const out = el("ul", "listings");
      box.append(out);
      loadInto(out, async () => {
        const list = await api("/offers");
        if (!list.length) return [empty("No offer targets right now. watchr suggests listings where an offer of up to 30% below the price still leaves a margin.")];
        return [
          ...list.map((h) => {
            const r = el("div", "pricing");
            r.append(el("span", "price", `Offer ${eur(h.offer, h.currency)}`), el("span", "resale", `listed ${eur(h.price, h.currency)} · −${h.discount}%`), el("span", "diff up", `${signed(h.profit, h.currency)} margin`));
            return listingRow(h, r);
          }),
          note("Suggested offer: about 70% of the resale estimate, so roughly 30% margin stays with you."),
        ];
      });
    },
  },
  {
    id: "seller-intel", name: "Seller Intel", desc: "Analyse any Vinted wardrobe", ai: true,
    render(box) {
      const out = el("div");
      box.append(
        form([field("Profile link", inp("url", "https://www.vinted.de/member/123456-name"))], "Analyse wardrobe", async (fd) => {
          const s = await api("/seller", { url: String(fd.get("url")) });
          const tiles = el("div", "stats");
          for (const [v, l] of [[String(s.listed), "Listings loaded"], [String(s.soldOrReserved), "Sold or reserved"], [eur(s.medianPrice), "Median price"], [s.user.rating != null ? `${s.user.rating} ★ (${s.user.reviews})` : "–", "Rating"]]) {
            const t = el("div", "stat");
            t.append(el("b", null, v), el("span", null, l));
            tiles.append(t);
          }
          const chips = (title, list) => {
            const w = el("div");
            w.append(el("h4", null, title));
            const c = el("div", "chips");
            for (const b of list) c.append(el("span", "chip static", `${b.name} · ${b.n}`));
            if (!list.length) c.append(el("span", "muted", "–"));
            w.append(c);
            return w;
          };
          out.replaceChildren(
            el("h3", null, `${s.user.login}${s.user.city ? " · " + s.user.city : ""}`),
            tiles,
            chips("Top brands", s.topBrands),
            chips("Designers", s.designers),
            s.summary ? Object.assign(el("div", "ai-box"), { textContent: s.summary }) : note(status.ai ? "No AI summary this time." : "Add an ANTHROPIC_API_KEY on the server for a written AI analysis."),
          );
        }),
        out,
      );
    },
  },
  {
    id: "ai-listings", name: "AI Listings", desc: "Title, description and hashtags in seconds", ai: true,
    render(box) {
      const cond = el("select");
      cond.name = "condition";
      for (const c of ["New with tags", "New without tags", "Very good", "Good", "Satisfactory"]) cond.append(Object.assign(el("option", null, c), { value: c }));
      const lang = el("select");
      lang.name = "language";
      lang.append(Object.assign(el("option", null, "German"), { value: "de" }), Object.assign(el("option", null, "English"), { value: "en" }));
      const photo = Object.assign(el("input"), { type: "file", accept: "image/*", name: "photo" });
      const out = el("div");
      box.append(
        form(
          [
            el("div", "grid-2", null),
            field("Item", inp("item", "Bomber jacket")),
            field("Brand", inp("brand", "Raf Simons")),
            field("Size", inp("size", "M")),
            field("Condition", cond),
            field("Details and flaws", inp("notes", "AW02, small mark on left sleeve, pit to pit 58 cm", "textarea")),
            field("Language", lang),
            field("Photo (optional)", photo),
          ].filter((n) => n.className !== "grid-2"),
          "Write listing",
          async (fd) => {
            const file = fd.get("photo");
            const body = Object.fromEntries([...fd.entries()].filter(([k]) => k !== "photo"));
            if (file && file.size) body.photo = await readFileAsDataUrl(file, 1200);
            const r = await api("/listing", body);
            const block = (label, text) => {
              const w = el("div", "copy-block");
              const head = el("div", "copy-head");
              head.append(el("h4", null, label), copyBtn(() => text));
              w.append(head, el("pre", null, text));
              return w;
            };
            out.replaceChildren(
              block("Title", r.title),
              block("Description", r.description),
              block("Hashtags", r.hashtags.join(" ")),
              note(r.ai ? "Written by AI from your details. Check it before posting." : "Template from your details. Add an ANTHROPIC_API_KEY on the server for AI-written listings."),
            );
          },
        ),
        out,
      );
    },
  },
  {
    id: "vinted-repost", name: "Vinted Repost", desc: "Copy, crop and re-upload your own listing",
    render(box) {
      const out = el("div");
      box.append(
        note("For your own listings only. Reposting other people's photos or texts isn't allowed."),
        form([field("Your listing link", inp("url", "https://www.vinted.de/items/…"))], "Load listing", async (fd) => {
          const r = await api("/repost", { url: String(fd.get("url")) });
          const text = `${r.title}\n\n${r.description}`;
          const pics = el("div", "repost-pics");
          for (const p of r.photos) {
            const fig = el("figure");
            const img = Object.assign(el("img"), { src: BACKEND + p.proxied, alt: "", loading: "lazy" });
            const b = el("button", "btn ghost small", "Crop & download");
            b.type = "button";
            b.onclick = async () => {
              const src = await loadImage(BACKEND + p.proxied);
              const c = cropCanvas(src, 0.03);
              Object.assign(document.createElement("a"), { href: c.toDataURL("image/jpeg", 0.93), download: `repost-${r.photos.indexOf(p) + 1}.jpg` }).click();
            };
            fig.append(img, b);
            pics.append(fig);
          }
          const head = el("div", "copy-head");
          head.append(el("h3", null, `${r.title} · ${eur(r.price, r.currency)}`), copyBtn(() => text));
          out.replaceChildren(head, el("pre", null, r.description || "(no description)"), pics, note("Each photo is cropped by 3% and saved as a new file, ready to upload as a fresh listing."));
        }),
        out,
      );
    },
  },
  {
    id: "wardrobe-tracker", name: "Wardrobe Tracker", desc: "Alerts when tracked items sell",
    render(box) {
      const out = el("ul", "listings");
      const refresh = () =>
        loadInto(out, async () => {
          const list = await api("/tracked");
          if (!list.length) return [empty("Nothing tracked yet. Add a listing or a whole profile.")];
          return list.map((t) => {
            const r = el("div", "pricing");
            const label = { active: "Online", sold: "Sold", gone: "Gone" }[t.status];
            r.append(el("span", "price", t.price != null ? eur(t.price, t.currency) : "–"), el("span", "diff " + (t.status === "active" ? "" : "down"), label));
            const del = el("button", "btn ghost small", "✕");
            del.type = "button";
            del.setAttribute("aria-label", "Stop tracking");
            del.onclick = async () => {
              await api(`/tracked/${t.id}`, null).catch(() => {});
              refresh();
            };
            r.append(del);
            return listingRow({ ...t, brand: t.seller && `@${t.seller}` }, r);
          });
        });
      box.append(
        form([field("Listing or profile link", inp("url", "https://www.vinted.de/items/… or /member/…"))], "Track", async (fd, f) => {
          const r = await api("/tracked", { url: String(fd.get("url")) });
          f.reset();
          if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
          refresh();
          return r;
        }),
        out,
        note("watchr checks tracked items every 10 minutes and alerts you here when one sells or disappears."),
      );
      refresh();
      liveSold(refresh);
    },
  },
  {
    id: "ai-filters", name: "AI Filters", desc: "Describe what you want, get Vinted links", ai: true,
    render(box) {
      const out = el("div");
      box.append(
        form([field("What are you looking for?", inp("text", "Black Raf Simons jacket under 300 €, size M, very good condition", "textarea"))], "Build filters", async (fd) => {
          const r = await api("/filters", { text: String(fd.get("text")) });
          const chips = el("div", "chips");
          for (const t of r.tags) chips.append(el("span", "chip static", t));
          const actions = el("div", "ctas");
          actions.append(
            Object.assign(el("a", "btn", "Open on Vinted"), { href: r.vintedUrl, target: "_blank", rel: "noopener" }),
            Object.assign(el("a", "btn ghost", "Watch in Live Listings"), { href: "monitor.html?tags=" + encodeURIComponent(r.tags.join(" ")) }),
          );
          out.replaceChildren(chips, actions, note(r.ai ? "Filters built by AI from your description." : "Filters built with simple rules. Add an ANTHROPIC_API_KEY on the server for AI understanding."));
        }),
        out,
      );
    },
  },
];

// Studio-Hintergrund für den Photo Enhancer
function studio(img, isCutout, bg) {
  const S = 1200;
  const c = Object.assign(document.createElement("canvas"), { width: S, height: S });
  const g = c.getContext("2d");
  const colors = { white: ["#ffffff", "#f1f3f2"], studio: ["#f4f4f4", "#d9dcdb"], green: ["#f3fcf6", "#cdeed8"] }[bg] || ["#ffffff", "#f1f3f2"];
  const grad = g.createRadialGradient(S / 2, S * 0.4, S * 0.1, S / 2, S / 2, S * 0.75);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(1, colors[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const fit = isCutout ? 0.82 : 0.9;
  const k = Math.min((S * fit) / img.width, (S * fit) / img.height);
  const w = img.width * k;
  const h = img.height * k;
  const x = (S - w) / 2;
  const y = (S - h) / 2;
  if (isCutout) {
    // weicher Schatten unter dem Artikel
    g.save();
    g.fillStyle = "rgba(0,0,0,.18)";
    g.filter = "blur(18px)";
    g.beginPath();
    g.ellipse(S / 2, y + h - 6, w * 0.38, 22, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  } else {
    g.save();
    g.shadowColor = "rgba(0,0,0,.18)";
    g.shadowBlur = 30;
    g.shadowOffsetY = 12;
    g.fillStyle = "#fff";
    g.fillRect(x, y, w, h);
    g.restore();
  }
  g.filter = "brightness(1.05) contrast(1.08) saturate(1.06)";
  g.drawImage(img, x, y, w, h);
  g.filter = "none";
  return c;
}

function cropCanvas(img, pct) {
  const cx = Math.round(img.width * pct);
  const cy = Math.round(img.height * pct);
  const c = Object.assign(document.createElement("canvas"), { width: img.width - 2 * cx, height: img.height - 2 * cy });
  c.getContext("2d").drawImage(img, cx, cy, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

// Verkaufsmeldungen live über die bestehende WebSocket-Verbindung
let soldSocket = null;
function liveSold(onSold) {
  if (soldSocket) return;
  try {
    soldSocket = new WebSocket(BACKEND.replace(/^http/, "ws") + "/ws");
  } catch {
    return;
  }
  soldSocket.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type !== "sold") return;
    onSold();
    if ("Notification" in window && Notification.permission === "granted")
      new Notification(`watchr · ${msg.item.status === "sold" ? "Sold" : "No longer online"}: ${msg.item.title}`, { icon: msg.item.photoUrl || "logo.svg" });
  };
}

// ---------- Seite aufbauen ----------
function open(id) {
  const tool = TOOLS.find((t) => t.id === id);
  for (const b of document.querySelectorAll(".tool-card")) b.setAttribute("aria-pressed", String(b.dataset.id === id));
  const panel = $("tool-panel");
  if (!tool) {
    panel.hidden = true;
    return;
  }
  const head = el("div", "panel-head");
  const h = el("h2", null, tool.name);
  if (tool.ai) h.append(el("span", "ai-badge", "AI"));
  head.append(h, el("p", null, tool.desc));
  const body = el("div", "panel-body");
  panel.replaceChildren(head, body);
  panel.hidden = false;
  tool.render(body);
}

const grid = $("tool-grid");
for (const t of TOOLS) {
  const b = el("a", "tool-card");
  b.href = "#" + t.id;
  b.dataset.id = t.id;
  b.innerHTML = (window.ICONS || {})[t.id] || "";
  const name = el("h3", null, t.name);
  if (t.ai) name.append(el("span", "ai-badge", "AI"));
  b.append(name, el("p", null, t.desc));
  grid.append(b);
}
window.addEventListener("hashchange", () => {
  open(location.hash.slice(1));
  if (location.hash) $("tool-panel").scrollIntoView({ behavior: "smooth", block: "start" });
});

api("/status").then(
  (s) => {
    status = { ...s, online: true };
    const parts = [];
    if (!s.ai) parts.push("AI features use simple rules until an ANTHROPIC_API_KEY is set on the server.");
    if (!s.vinted) parts.push("Tools that read Vinted need WATCHER_SOURCE=vinted.");
    $("tools-status").textContent = parts.join(" ");
    $("tools-status").hidden = !parts.length;
  },
  () => {
    $("tools-status").textContent = "Preview mode: start watchr with npm start to use the tools with your own data. The Photo Enhancer also works here.";
    $("tools-status").hidden = false;
  },
);
open(location.hash.slice(1));
