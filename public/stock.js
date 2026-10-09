// Stock: gekaufte Teile vom Snipe bis zum Verkauf. "Next up" sagt, was als Nächstes zu tun ist;
// watchr bereitet vor, der Nutzer erledigt es auf Vinted selbst und bestätigt mit Done.
const BACKEND = (window.WATCHER_BACKEND || location.origin).replace(/\/$/, "");
const A = window.watchrStockApi;
const S = window.watchrStock;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmtPrice = (p, cur) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: cur || "EUR", maximumFractionDigits: p % 1 ? 2 : 0 }).format(p);
const fmtDiff = (d, cur) => (d >= 0 ? "+" : "−") + fmtPrice(Math.abs(Math.round(d)), cur);
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const daysSince = (iso, to = Date.now()) => Math.max(0, Math.floor((to - Date.parse(iso)) / S.DAY));
const ago = (iso) => {
  const d = daysSince(iso);
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};
const today = () => new Date().toISOString().slice(0, 10);
// "Ralph Lauren polo" mit Marke "Ralph Lauren" -> "polo", damit die Marke im Listing nicht doppelt steht
const withoutBrand = (it) => (it.brand && it.title.toLowerCase().startsWith(it.brand.toLowerCase() + " ") ? it.title.slice(it.brand.length + 1) : it.title);

const STATUS = { bought: "Bought", arrived: "Arrived", listed: "Listed", sold: "Sold", kept: "Kept" };
const FILTERS = ["bought", "arrived", "listed", "sold", "all"];
const CATEGORIES = ["Jackets", "Tops", "Pants", "Sneakers", "Accessories", "Other"];
const CONDITIONS = ["New with tags", "New without tags", "Very good", "Good", "Satisfactory"];
const COUNTRIES = ["Germany", "France", "Austria", "Italy", "Belgium", "Netherlands", "Spain", "Poland", "Czechia", "Lithuania", "Luxembourg", "Portugal", "Other"];
const MEASURES = [["pitToPit", "Pit to pit"], ["length", "Length"], ["sleeve", "Sleeve"], ["waist", "Waist"], ["inseam", "Inseam"]];

let items = [];
let filter = "all";
try { filter = localStorage.getItem("watchr.stockFilter") || "all"; } catch {}
if (!FILTERS.includes(filter)) filter = "all";

// ---------- Kleine Bausteine ----------
function button(label, cls, onClick) {
  const b = el("button", cls, label);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}
function field(label, input, cls) {
  const w = el("label", "tf" + (cls ? " " + cls : ""));
  w.append(el("span", null, label), input);
  return w;
}
function input(name, value, attrs = {}) {
  const i = el(attrs.type === "textarea" ? "textarea" : "input");
  i.name = name;
  if (attrs.type !== "textarea") i.type = attrs.type || "text";
  for (const [k, v] of Object.entries(attrs)) if (k !== "type") i.setAttribute(k, v);
  if (value != null) i.value = value;
  return i;
}
function select(name, options, value, blank) {
  const s = el("select");
  s.name = name;
  if (blank) s.append(Object.assign(el("option", null, blank), { value: "" }));
  for (const o of options) {
    const [v, t] = Array.isArray(o) ? o : [o, o];
    s.append(Object.assign(el("option", null, t), { value: v, selected: v === value }));
  }
  return s;
}
function copyBtn(getText, label = "Copy") {
  return button(label, "btn ghost small", async (e) => {
    const b = e.currentTarget;
    try {
      await navigator.clipboard.writeText(getText());
      b.textContent = "Copied";
    } catch {
      b.textContent = "Copy didn't work";
    }
    setTimeout(() => (b.textContent = label), 1500);
  });
}
// Knopf, der eine Aktion ausführt und Fehler im Ziel-Element zeigt
async function run(btn, errBox, fn) {
  if (errBox) errBox.hidden = true;
  btn.disabled = true;
  try {
    await fn();
  } catch (e) {
    if (errBox) {
      errBox.textContent = e.message;
      errBox.hidden = false;
    }
  } finally {
    btn.disabled = false;
  }
}
function readFileAsDataUrl(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => reject(new Error("This file isn't a photo watchr can read."));
    img.src = URL.createObjectURL(file);
  });
}
const placeholder = () => {
  const d = el("div", "pic ph");
  d.innerHTML = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M27 15a5 5 0 1 1 5 5v4"/><path d="M32 24 7 42h50z"/></svg>';
  return d;
};

// AI-Tools-Endpunkte (Listing Writer, Resale Check); in der Vorschau Beispielantworten aus tools-demo.js
async function tool(path, body) {
  try {
    const res = await fetch(BACKEND + "/api/tools" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if ((res.headers.get("content-type") || "").includes("json")) {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    }
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
  }
  if (window.DEMO_API) return window.DEMO_API(path, body);
  throw new Error("This needs watchr running. Start it with npm start.");
}

// ---------- Laden und Übersicht ----------
async function load() {
  try {
    items = await A.list();
    $("load-error").hidden = true;
  } catch (e) {
    $("load-error").textContent = e.message;
    $("load-error").hidden = false;
  }
  $("demo-note").hidden = !A.isDemo;
  render();
  if (current && !current.isNew) {
    const it = items.find((x) => x.id === current.id);
    if (it) renderSheet(it);
    else closeDrawer();
  }
}

function render() {
  const s = S.summary(items);
  $("k-count").textContent = s.inStock;
  $("k-capital").textContent = fmtPrice(Math.round(s.capital));
  $("k-expected").textContent = fmtDiff(s.expected);
  $("k-days").textContent = s.avgDays == null ? "–" : String(s.avgDays);
  renderNext();
  renderSeg();
  renderPipeline();
}

function renderNext() {
  const tasks = S.tasks(items);
  window.watchrSetStockCount?.(tasks.length);
  $("next-sub").textContent = tasks.length ? `${tasks.length} open` : "";
  $("next-empty").hidden = tasks.length > 0;
  $("next").replaceChildren(...tasks.map(taskRow));
}

function taskRow(t) {
  const it = t.item;
  const li = el("li", "listing task k-" + t.kind);
  const info = el("div");
  const meta = el("span", "meta");
  const name = button(it.title, null, () => openDrawer(it.id, t.kind === "write" ? "listing" : null));
  const extra = {
    ship: it.soldPrice != null && `sold for ${fmtPrice(it.soldPrice)} ${ago(it.soldAt)}`,
    write: `arrived ${ago(it.arrivedAt || it.boughtAt)}`,
    arrived: `bought ${ago(it.boughtAt)}`,
    price: `now ${fmtPrice(it.price)} · last change ${ago(S.lastPriceChange(it))}`,
    refresh: `listed ${ago(it.listedAt)}`,
    floor: `at ${fmtPrice(it.price)} since ${ago(S.lastPriceChange(it))}`,
  }[t.kind];
  meta.append(name, extra ? ` · ${extra}` : "");
  info.append(el("span", "what", t.label), el("br"), meta);
  const acts = el("div", "acts");
  const err = el("p", "error");
  err.hidden = true;
  const act = (label, primary, fn) =>
    button(label, primary ? "btn small" : "btn small ghost", (e) => run(e.currentTarget, err, async () => {
      await fn();
      await load();
    }));
  const now = () => new Date().toISOString();
  if (t.kind === "ship") acts.append(act("Shipped", true, () => A.patch(it.id, { shippedAt: now() })));
  if (t.kind === "write") acts.append(button("Write listing", "btn small", () => openDrawer(it.id, "listing")));
  if (t.kind === "arrived") acts.append(act("Arrived", true, () => A.patch(it.id, { status: "arrived" })));
  if (t.kind === "price") {
    acts.append(copyBtn(() => String(t.price), "Copy price"));
    if (it.vintedUrl) acts.append(Object.assign(el("a", "btn small ghost", "Open on Vinted"), { href: it.vintedUrl, target: "_blank", rel: "noopener" }));
    acts.append(act("Done", true, () => A.patch(it.id, { price: t.price })));
  }
  if (t.kind === "refresh") {
    acts.append(Object.assign(el("a", "btn small", "Refresh"), { href: `tools.html?stock=${it.id}#vinted-repost` }), act("Done", false, () => A.patch(it.id, { refreshedAt: now() })));
  }
  if (t.kind === "floor") acts.append(act("Keep listed", true, () => A.patch(it.id, { floorAckAt: now() })), act("Kept for myself", false, () => A.patch(it.id, { status: "kept" })));
  li.append(info, acts);
  if (t.kind === "price") li.title = "Change the price on Vinted yourself, then press Done";
  info.append(err);
  return li;
}

function renderSeg() {
  const count = (f) => (f === "all" ? items.length : items.filter((it) => it.status === f).length);
  $("seg").replaceChildren(
    ...FILTERS.map((f) => {
      const b = button(f === "all" ? "All" : STATUS[f], null, () => {
        filter = f;
        try { localStorage.setItem("watchr.stockFilter", f); } catch {}
        renderSeg();
        renderPipeline();
      });
      b.append(el("small", null, String(count(f))));
      b.setAttribute("aria-pressed", String(filter === f));
      return b;
    }),
  );
}

function renderPipeline() {
  const shown = items.filter((it) => filter === "all" || it.status === filter);
  $("pipe-empty").hidden = shown.length > 0;
  $("pipeline").replaceChildren(
    ...shown.map((it) => {
      const li = el("li", "listing row s-" + it.status);
      li.addEventListener("click", (e) => {
        if (!e.target.closest("button")) openDrawer(it.id);
      });
      const photo = it.photos && it.photos[0];
      li.append(photo ? Object.assign(el("img", "pic"), { src: A.photoUrl(photo), alt: "", loading: "lazy" }) : placeholder());
      const info = el("div");
      const days = it.status === "sold" ? `sold after ${daysSince(it.boughtAt, Date.parse(it.soldAt))} days` : `${daysSince(it.boughtAt)} days in stock`;
      info.append(button(it.title, "title", () => openDrawer(it.id)), el("span", "meta", [STATUS[it.status], it.brand, it.size && `Size ${it.size}`, days].filter(Boolean).join(" · ")));
      const p = el("div", "pricing");
      const cost = S.totalCost(it);
      if (it.status === "sold") {
        const profit = S.realProfit(it);
        p.append(el("span", "price", fmtPrice(it.soldPrice)), el("span", "cost", `Cost ${fmtPrice(Math.round(cost))}`), el("span", "diff " + (profit >= 0 ? "up" : "down"), `Profit ${fmtDiff(profit)}`));
      } else {
        const exp = S.expectedProfit(it);
        p.append(
          el("span", "price", fmtPrice(it.price)),
          el("span", "cost", `Cost ${fmtPrice(Math.round(cost))} · Floor ${fmtPrice(it.pricePlan.floor)}`),
          el("span", "diff " + (exp >= 0 ? "up" : "down"), `Exp. ${fmtDiff(exp)}`),
        );
      }
      li.append(info, p);
      return li;
    }),
  );
}

// ---------- Detail-Panel ----------
let current = null; // { id, isNew }
let lastFocus = null;
const openSections = new Set();

function openDrawer(id, section) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  lastFocus = document.activeElement;
  current = { id };
  openSections.clear();
  openSections.add(section || defaultSection(it));
  renderSheet(it);
  showDrawer();
  history.replaceState(null, "", `#item-${id}`);
  if (section) $("sec-" + section)?.scrollIntoView({ block: "start" });
}
function openNew() {
  lastFocus = document.activeElement;
  current = { isNew: true };
  const sheet = $("sheet");
  const head = sheetHead("Add item", "For things you bought without a snipe.");
  const box = el("div");
  box.append(itemForm(null));
  sheet.replaceChildren(head, box);
  showDrawer();
}
function showDrawer() {
  $("drawer").hidden = false;
  document.body.style.overflow = "hidden";
  $("sheet").querySelector("input, .close")?.focus();
}
function closeDrawer() {
  $("drawer").hidden = true;
  document.body.style.overflow = "";
  current = null;
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  lastFocus?.focus?.();
}
const defaultSection = (it) => ({ bought: "item", arrived: "listing", listed: "price", sold: "price", kept: "price" })[it.status];

function sheetHead(title, sub) {
  const head = el("div", "sheet-head");
  const t = el("div");
  t.append(Object.assign(el("h2", null, title), { id: "d-title" }), el("p", "sub", sub));
  const close = button("Close", "btn ghost small close", closeDrawer);
  head.append(t, close);
  return head;
}

function section(id, title, build) {
  const d = el("details");
  d.id = "sec-" + id;
  d.open = openSections.has(id);
  d.addEventListener("toggle", () => (d.open ? openSections.add(id) : openSections.delete(id)));
  const body = el("div");
  d.append(el("summary", null, title), body);
  build(body);
  return d;
}

function renderSheet(it) {
  const sheet = $("sheet");
  const scroll = sheet.scrollTop;
  const sub = `${STATUS[it.status]} · bought ${fmtDate(it.boughtAt)} for ${fmtPrice(it.buyPrice)}`;
  const danger = el("div", "danger-zone btns");
  const err = el("p", "error");
  err.hidden = true;
  const del = button("Delete item", "btn ghost small", (e) => {
    const b = e.currentTarget;
    if (!b.dataset.armed) {
      b.dataset.armed = "1";
      b.textContent = "Delete? This can't be undone";
      return setTimeout(() => {
        delete b.dataset.armed;
        b.textContent = "Delete item";
      }, 4000);
    }
    run(b, err, async () => {
      await A.remove(it.id);
      closeDrawer();
      await load();
    });
  });
  danger.append(del, el("span", "note", it.saleId ? "The sale stays in My Charts." : ""), err);
  sheet.replaceChildren(
    sheetHead(it.title, sub),
    section("item", "Item", (b) => b.append(itemForm(it))),
    section("photos", "Photos", (b) => photosSection(b, it)),
    section("listing", "Listing", (b) => listingSection(b, it)),
    section("price", "Price & sale", (b) => priceSection(b, it)),
    danger,
  );
  sheet.scrollTop = scroll;
}

// a) Item: alle Felder, Maße, eigene Fotos
function itemForm(it) {
  const isNew = !it;
  const v = it || { measurements: {}, flaws: "", status: "bought", boughtAt: new Date().toISOString(), photos: [] };
  const f = el("form");
  f.noValidate = false;
  const statusOpts = (it && it.status === "sold" ? ["sold"] : ["bought", "arrived", "listed", "kept"]).map((s) => [s, STATUS[s]]);
  const status = select("status", statusOpts, v.status);
  if (it?.status === "sold") status.disabled = true;
  const grid = el("div", "fields");
  grid.append(
    field("Title", input("title", v.title, { required: "", maxlength: 200, placeholder: "Carhartt Detroit Jacket" }), "wide"),
    field("Brand", input("brand", v.brand, { maxlength: 80, placeholder: "Carhartt" })),
    field("Size", input("size", v.size, { maxlength: 40, placeholder: "L" })),
    field("Category", select("category", CATEGORIES, v.category || (isNew ? "" : "Other"), isNew ? "Guess from title" : null)),
    field("Condition", select("condition", CONDITIONS, v.condition, "Not set")),
    field("Bought for (€)", input("buyPrice", v.buyPrice, { type: "number", step: "0.01", min: "0.01", required: "", inputmode: "decimal" })),
    field("Buyer protection + shipping (€)", input("buyFees", v.buyFees, { type: "number", step: "0.01", min: "0", inputmode: "decimal", placeholder: "auto" })),
    field("Bought on", input("boughtAt", v.boughtAt.slice(0, 10), { type: "date", max: today() })),
    field("Status", status),
  );
  const mgrid = el("div", "fields five");
  for (const [k, label] of MEASURES) mgrid.append(field(label + " (cm)", input("m." + k, v.measurements?.[k], { type: "number", step: "0.5", min: "1", max: "400", inputmode: "decimal" })));
  const thumbs = el("div", "thumbs");
  for (const p of v.photos || []) {
    const t = el("div", "thumb");
    t.append(Object.assign(el("img"), { src: A.photoUrl(p), alt: "" }));
    if (p.studio) t.append(el("span", "badge", "Studio"));
    const rm = button("✕", null, (e) => run(e.currentTarget, err, async () => {
      await A.removePhoto(it.id, p.id);
      await load();
    }));
    rm.title = "Remove photo";
    rm.setAttribute("aria-label", "Remove photo");
    t.append(rm);
    thumbs.append(t);
  }
  const files = Object.assign(input("photos", null, { type: "file", accept: "image/*", multiple: "" }));
  const err = el("p", "error");
  err.hidden = true;
  const ok = el("p", "ok", "Saved.");
  ok.hidden = true;
  const save = el("button", "btn", isNew ? "Add to stock" : "Save item");
  save.type = "submit";
  f.append(
    grid,
    el("h4", "note", "Measurements, laid flat"),
    mgrid,
    el("p", "note", "Measured items get fewer 'not as described' claims."),
    field("Flaws", input("flaws", v.flaws, { type: "textarea", rows: 2, maxlength: 1000, placeholder: "Small mark on the left sleeve. Leave empty if there are none." }), "wide"),
    thumbs,
    field("Your own photos", files, "wide"),
    el("p", "note", "Only photos you took yourself. watchr never copies photos from the snipe."),
    Object.assign(el("div", "btns"), {}),
    err,
    ok,
  );
  f.querySelector(".btns").append(save);
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!f.reportValidity()) return;
    ok.hidden = true;
    run(save, err, async () => {
      const fd = new FormData(f);
      const body = {
        title: fd.get("title"), brand: fd.get("brand"), size: fd.get("size"), condition: fd.get("condition") || null,
        buyPrice: fd.get("buyPrice"), boughtAt: fd.get("boughtAt") || undefined, flaws: fd.get("flaws"),
        measurements: Object.fromEntries(MEASURES.map(([k]) => [k, fd.get("m." + k)])),
      };
      if (fd.get("category")) body.category = fd.get("category");
      if (fd.get("buyFees") !== "") body.buyFees = fd.get("buyFees");
      else if (!isNew) body.buyFees = S.buyFees(Number(body.buyPrice));
      if (!status.disabled && (isNew || fd.get("status") !== it.status)) body.status = fd.get("status");
      let saved = isNew ? await A.create(body) : await A.patch(it.id, body);
      for (const file of files.files) saved = await A.addPhoto(saved.id, await readFileAsDataUrl(file), false);
      if (isNew && saved.resaleEstimate == null && !A.isDemo) {
        // Resellpreis für Teile ohne Snipe nachladen (gelingt nur mit Vinted-Verbindung)
        const r = await tool("/price", { title: saved.title, brand: saved.brand || undefined }).catch(() => null);
        if (r?.ref) saved = await A.patch(saved.id, { resaleLow: r.ref.low, resaleHigh: r.ref.high, resaleEstimate: r.ref.median });
      }
      await load();
      if (isNew) openDrawer(saved.id, "item");
      else {
        const box = $("sec-item")?.querySelector(".ok");
        if (box) box.hidden = false;
      }
    });
  });
  return f;
}

// b) Photos: Studio Shot mit einem eigenen Foto
function photosSection(box, it) {
  if (!it.photos.length) return box.append(el("p", "note", "Add your own photos under Item first. Then pick one here for Studio Shot."));
  let chosen = it.photos.find((p) => !p.studio) || it.photos[0];
  const group = el("div", "thumbs");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Choose a photo for Studio Shot");
  const link = Object.assign(el("a", "btn", "Studio Shot"), { href: "#" });
  const setLink = () => (link.href = `tools.html?stock=${it.id}&photo=${chosen.id}#photo-enhancer`);
  it.photos.forEach((p, i) => {
    const t = el("label", "thumb");
    const r = Object.assign(el("input"), { type: "radio", name: "studio-photo", checked: p === chosen });
    r.setAttribute("aria-label", `Photo ${i + 1}${p.studio ? ", studio shot" : ""}`);
    r.addEventListener("change", () => {
      chosen = p;
      setLink();
    });
    t.append(r, Object.assign(el("img"), { src: A.photoUrl(p), alt: "" }));
    if (p.studio) t.append(el("span", "badge", "Studio"));
    group.append(t);
  });
  setLink();
  box.append(group, Object.assign(el("div", "btns"), {}), el("p", "note", "Studio Shot opens with this photo. Press Save to item there and the result appears here, ready to download for Vinted."));
  box.querySelector(".btns").append(link);
}

// c) Listing: Text schreiben lassen, bearbeiten, kopieren; danach selbst einstellen und Link einfügen
function listingSection(box, it) {
  const lang = select("language", [["de", "German"], ["en", "English"]], it.listing?.language || "de");
  const err = el("p", "error");
  err.hidden = true;
  const ok = el("p", "ok");
  ok.hidden = true;
  const out = el("div");
  out.style.display = "contents";
  const fields = {};
  const showFields = (l) => {
    fields.title = input("l-title", l.title, { maxlength: 200 });
    fields.description = input("l-description", l.description, { type: "textarea", rows: 9, maxlength: 5000 });
    fields.hashtags = input("l-hashtags", l.hashtags, { maxlength: 500 });
    const block = (label, inp) => {
      const w = el("div", "copy-block");
      const head = el("div", "copy-head");
      const id = "lf-" + label.toLowerCase();
      inp.id = id;
      head.append(Object.assign(el("label", null, label), { htmlFor: id }), copyBtn(() => inp.value));
      w.append(head, inp);
      return w;
    };
    const saveBtn = button("Save listing", "btn ghost small", (e) => run(e.currentTarget, err, async () => {
      await A.patch(it.id, { listing: current_listing() });
      ok.textContent = "Listing saved.";
      ok.hidden = false;
    }));
    const row = el("div", "btns");
    row.append(saveBtn);
    out.replaceChildren(block("Title", fields.title), block("Description", fields.description), block("Hashtags", fields.hashtags), row);
  };
  const current_listing = () => fields.title && { title: fields.title.value, description: fields.description.value, hashtags: fields.hashtags.value, language: lang.value };
  const write = button(S.hasListing(it) ? "Write again" : "Write listing", "btn", (e) => run(e.currentTarget, err, async () => {
    ok.hidden = true;
    const body = { item: withoutBrand(it), brand: it.brand || "", size: it.size || "", condition: it.condition || "", notes: "", language: lang.value, measurements: it.measurements, flaws: it.flaws || "" };
    // erstes eigenes Foto mitgeben, damit die KI Details sieht
    const p = it.photos[0];
    if (p) body.photo = await fetch(A.photoUrl(p)).then((r) => r.blob()).then((b) => readFileAsDataUrl(b, 1200)).catch(() => undefined);
    const r = await tool("/listing", body);
    const l = { title: r.title, description: r.description, hashtags: r.hashtags.join(" "), language: lang.value };
    await A.patch(it.id, { listing: l });
    showFields(l);
    ok.textContent = r.ai ? "Written by AI from your item details and saved. Check it before posting." : "Template from your item details, saved. Edit it as you like.";
    ok.hidden = false;
  }));
  const top = el("div", "btns");
  top.append(field("Language", lang), write);
  top.firstChild.style.flex = "0 1 180px";
  box.append(el("p", "note", "Uses your item details, measurements and flaws. Measurements and flaws always appear as their own lines."), top, out, ok, err);
  if (S.hasListing(it)) showFields(it.listing);

  // Nach dem Einstellen: Link einfügen
  const url = input("vintedUrl", it.vintedUrl, { type: "url", placeholder: "https://www.vinted.de/items/…", inputmode: "url" });
  const linkErr = el("p", "error");
  linkErr.hidden = true;
  const row = el("div", "btns");
  if (it.status === "bought" || it.status === "arrived" || it.status === "kept") {
    row.append(button("Mark as listed", "btn", (e) => run(e.currentTarget, linkErr, async () => {
      const body = { status: "listed", vintedUrl: url.value.trim() || null };
      if (current_listing()) body.listing = current_listing();
      await A.patch(it.id, body);
      openSections.add("price");
      await load();
    })));
  } else if (it.status === "listed") {
    row.append(button("Save link", "btn ghost", (e) => run(e.currentTarget, linkErr, async () => {
      await A.patch(it.id, { vintedUrl: url.value.trim() || null });
      await load();
    })));
  }
  if (it.vintedUrl) row.append(Object.assign(el("a", "btn ghost", "Open on Vinted"), { href: it.vintedUrl, target: "_blank", rel: "noopener" }));
  box.append(el("p", "note", "Copy each part into Vinted, post the listing yourself, then paste its link here."), field("Vinted link", url), row, linkErr);
}

// d) Preis & Verkauf: Stufenleiste, Plan, Verkauf eintragen
function priceSection(box, it) {
  const plan = it.pricePlan;
  const cost = S.totalCost(it);
  const money = el("div", "money");
  const tile = (v, l) => {
    const t = el("div", "stat");
    t.append(el("b", null, v), el("span", null, l));
    return t;
  };
  if (it.status === "sold") {
    const profit = S.realProfit(it);
    money.append(tile(fmtPrice(cost), "Total cost"), tile(fmtPrice(it.soldPrice), "Sold for"), tile(fmtDiff(profit), "Real profit"), tile(String(daysSince(it.boughtAt, Date.parse(it.soldAt))), "Days to sell"));
    box.append(money);
    const ok = el("p", "ok");
    ok.append(`Logged in My Charts: ${fmtDiff(profit)} profit. `, Object.assign(el("a", null, "Open My Charts"), { href: "charts.html" }));
    box.append(el("p", "note", `Sold ${fmtDate(it.soldAt)}${it.buyerCountry ? " to a buyer in " + it.buyerCountry : ""}.`), ok);
    if (!it.shippedAt) {
      const err = el("p", "error");
      err.hidden = true;
      const row = el("div", "btns");
      row.append(button("Shipped", "btn", (e) => run(e.currentTarget, err, async () => {
        await A.patch(it.id, { shippedAt: new Date().toISOString() });
        await load();
      })));
      box.append(row, err);
    } else box.append(el("p", "note", `Shipped ${fmtDate(it.shippedAt)}.`));
    return;
  }
  money.append(tile(fmtPrice(cost), "Total cost"), tile(fmtPrice(plan.floor), "Floor"), tile(fmtPrice(it.price), it.status === "listed" ? "Current price" : "Start price"), tile(fmtDiff(S.expectedProfit(it)), "Expected profit"));
  box.append(money);

  // Stufenleiste: Start → Stufen → Floor, aktuelle Stufe hervorgehoben
  const steps = S.ladder(it);
  if (it.status === "listed" && !steps.includes(it.price)) steps.push(it.price), steps.sort((a, b) => b - a);
  const lad = el("ol", "ladder");
  lad.setAttribute("aria-label", "Price plan");
  steps.forEach((p, i) => {
    const li = el("li", (p === it.price ? "now" : "") + (i === steps.length - 1 && p === plan.floor ? " floor" : ""));
    li.append(el("span", null, fmtPrice(p)));
    if (i === 0) li.append(el("small", null, "start"));
    if (p === plan.floor && i === steps.length - 1) li.append(el("small", null, "floor"));
    if (p === it.price && it.status === "listed") li.setAttribute("aria-current", "step");
    lad.append(li);
  });
  const next = S.nextStep(it);
  const due = it.status === "listed" && next ? ` Next step is due now: ${fmtPrice(next.price)}.` : "";
  box.append(lad, el("p", "note", `Every ${plan.everyDays} days watchr suggests ${plan.stepPercent}% less, rounded to whole euros and never below the floor. You change the price on Vinted yourself and confirm with Done in Next up.${due}`));
  if (it.resaleEstimate || it.resaleHigh)
    box.append(el("p", "note", `Resale estimate ${it.resaleLow && it.resaleHigh ? `${fmtPrice(it.resaleLow)}–${fmtPrice(it.resaleHigh)}` : "~" + fmtPrice(it.resaleEstimate || it.resaleHigh)}${it.hitId ? ", taken from the snipe" : ""}.`));

  // Plan einstellen
  const pf = el("form");
  const grid = el("div", "fields");
  grid.append(
    field("Start price (€)", input("start", plan.custom ? plan.start : "", { type: "number", min: "1", step: "1", placeholder: `auto: ${S.normalize({ ...it, pricePlan: { ...plan, custom: false } }).pricePlan.start}`, inputmode: "numeric" })),
    field("Minimum profit (€)", input("minProfit", plan.minProfit, { type: "number", min: "0", step: "1", required: "", inputmode: "numeric" })),
    field("Lower by (%)", input("stepPercent", plan.stepPercent, { type: "number", min: "1", max: "50", step: "1", required: "", inputmode: "numeric" })),
    field("Every (days)", input("everyDays", plan.everyDays, { type: "number", min: "1", max: "60", step: "1", required: "", inputmode: "numeric" })),
  );
  if (it.status === "listed") grid.append(field("Price on Vinted now (€)", input("price", it.price, { type: "number", min: "1", step: "1", required: "", inputmode: "numeric" })));
  const perr = el("p", "error");
  perr.hidden = true;
  const psave = el("button", "btn ghost", "Save plan");
  psave.type = "submit";
  const prow = el("div", "btns");
  prow.append(psave, button("Update resale estimate", "btn ghost small", (e) => run(e.currentTarget, perr, async () => {
    const r = await tool("/price", { title: it.title, brand: it.brand || undefined });
    if (!r.ref) throw new Error("Not enough comparable listings for a resale estimate yet.");
    await A.patch(it.id, { resaleLow: r.ref.low, resaleHigh: r.ref.high, resaleEstimate: r.ref.median });
    await load();
  })));
  pf.append(grid, prow, perr);
  pf.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!pf.reportValidity()) return;
    run(psave, perr, async () => {
      const fd = new FormData(pf);
      const body = { pricePlan: { start: fd.get("start") || null, minProfit: fd.get("minProfit"), stepPercent: fd.get("stepPercent"), everyDays: fd.get("everyDays") } };
      if (fd.get("price") != null) body.price = fd.get("price");
      await A.patch(it.id, body);
      await load();
    });
  });
  box.append(pf);

  // Verkauft eintragen: landet automatisch in My Charts
  const sf = el("form");
  const sgrid = el("div", "fields");
  sgrid.append(
    field("Sold for (€)", input("soldPrice", it.status === "listed" ? it.price : "", { type: "number", min: "0.01", step: "0.01", required: "", inputmode: "decimal" })),
    field("Buyer country", select("buyerCountry", COUNTRIES, "", "Unknown")),
    field("Sold on", input("soldAt", today(), { type: "date", max: today() })),
  );
  const serr = el("p", "error");
  serr.hidden = true;
  const ssave = el("button", "btn", "Mark as sold");
  ssave.type = "submit";
  const srow = el("div", "btns");
  srow.append(ssave);
  sf.append(el("h4", null, "Mark as sold"), sgrid, srow, serr);
  sf.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!sf.reportValidity()) return;
    run(ssave, serr, async () => {
      const fd = new FormData(sf);
      await A.sold(it.id, { soldPrice: fd.get("soldPrice"), buyerCountry: fd.get("buyerCountry") || null, soldAt: fd.get("soldAt") || undefined });
      openSections.add("price");
      await load();
    });
  });
  box.append(sf);
}

// ---------- Tastatur und Start ----------
$("drawer").addEventListener("click", (e) => {
  if (e.target.matches("[data-close]")) closeDrawer();
});
document.addEventListener("keydown", (e) => {
  if ($("drawer").hidden) return;
  if (e.key === "Escape") return closeDrawer();
  if (e.key !== "Tab") return;
  // Fokus bleibt im Panel
  const f = [...$("sheet").querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, summary")].filter((x) => x.offsetParent);
  if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) {
    e.preventDefault();
    f[f.length - 1].focus();
  } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
    e.preventDefault();
    f[0].focus();
  }
});
$("add-btn").addEventListener("click", openNew);

load().then(() => {
  const m = location.hash.match(/^#item-(-?\d+)$/);
  if (m) openDrawer(Number(m[1]));
});
