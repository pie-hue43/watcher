// Sprache der Website: Englisch (Standard) oder Deutsch. Der Schalter im Header merkt die Wahl im Browser.
// Die Seiten bleiben auf Englisch geschrieben; auf Deutsch tauscht dieses Skript die Texte beim Laden
// und bei jeder späteren Änderung (Live Sniper, Stock …) gegen die Übersetzungen aus i18n-de.js.
// Zahlen in Texten werden als Platzhalter behandelt ("{0} open tasks"), Euro-Beträge und Daten
// bekommen das deutsche Format (€1,535.00 -> 1.535,00 €, 2 Oct -> 2. Okt.).
(function () {
  const KEY = "watchr.lang";
  let lang = "en";
  try { lang = localStorage.getItem(KEY) === "de" ? "de" : "en"; } catch {}
  const collect = /[?&]i18n=collect\b/.test(location.search);
  const DE = window.watchrDE || { texts: {}, html: {} };
  const missing = new Set();
  window.watchrLang = lang;
  window.__i18nMissing = missing;

  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const INLINE = new Set(["B", "STRONG", "I", "EM", "CODE", "A", "BR", "SPAN", "SMALL", "ABBR", "KBD", "SUP", "SUB", "U"]);
  const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "OPTION", "SVG", "NOSCRIPT", "CODE", "PRE"]);
  const ATTRS = ["placeholder", "title", "aria-label", "alt"];

  // ---------- Zahlen, Beträge und Daten ----------
  const MONTHS = { Jan: "Jan.", Feb: "Feb.", Mar: "März", Apr: "Apr.", May: "Mai", Jun: "Juni", Jul: "Juli", Aug: "Aug.", Sep: "Sept.", Sept: "Sept.", Oct: "Okt.", Nov: "Nov.", Dec: "Dez." };
  const MONTHS_LONG = { January: "Januar", February: "Februar", March: "März", April: "April", May: "Mai", June: "Juni", July: "Juli", August: "August", September: "September", October: "Oktober", November: "November", December: "Dezember" };
  const DAYS = { Monday: "Montag", Tuesday: "Dienstag", Wednesday: "Mittwoch", Thursday: "Donnerstag", Friday: "Freitag", Saturday: "Samstag", Sunday: "Sonntag" };
  const MONTH_RE = Object.keys(MONTHS_LONG).join("|") + "|" + Object.keys(MONTHS).join("|");
  // ein "Token": Betrag, Zahl, Uhrzeit, Prozent oder Datum
  const TOKEN = new RegExp(
    `(?:(?:${Object.keys(DAYS).join("|")}) )?\\d{1,2} (?:${MONTH_RE})\\b(?: \\d{4})?|[+−-]?[€$£¥]\\s?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?[–-]\\s?[€$£¥]?\\d[\\d,]*(?:\\.\\d+)?)?|[+−-]?\\d[\\d,]*(?:\\.\\d+)?(?::\\d\\d)?\\s?%?`,
    "g",
  );
  const deNumber = (n) => n.replace(/,/g, "\u0001").replace(/\./g, ",").replace(/\u0001/g, ".");
  function deToken(t) {
    let m;
    if ((m = t.match(/^(?:(\w+day) )?(\d{1,2}) (\w+)(?: (\d{4}))?$/)) && (MONTHS[m[3]] || MONTHS_LONG[m[3]])) {
      const month = MONTHS_LONG[m[3]] || MONTHS[m[3]];
      return `${m[1] ? DAYS[m[1]] + ", " : ""}${m[2]}. ${month}${m[4] ? " " + m[4] : ""}`;
    }
    if (/[€$£¥]/.test(t)) {
      // €1,535.00 -> 1.535,00 €, +€88 -> +88 €, €25–€35 -> 25–35 €
      const sign = (t.match(/^[+−-]/) || [""])[0];
      const cur = t.match(/[€$£¥]/)[0];
      const nums = t.replace(/^[+−-]/, "").split(/\s?[–-]\s?/).map((x) => deNumber(x.replace(/[€$£¥\s]/g, "")));
      return `${sign}${nums.join("–")} ${cur}`;
    }
    if (/^\d{1,2}:\d\d$/.test(t)) return t;
    if (/\d\.\d/.test(t) || /\d,\d{3}/.test(t)) return deNumber(t);
    return t;
  }
  // "Net +€88" -> { tpl: "Net {0}", vals: ["+€88"] }
  function template(s) {
    const vals = [];
    const tpl = s.replace(TOKEN, (t) => {
      vals.push(t);
      return `{${vals.length - 1}}`;
    });
    return { tpl, vals };
  }
  const fill = (tpl, vals) => tpl.replace(/\{(\d+)\}/g, (_, i) => (vals[i] != null ? deToken(vals[i]) : ""));

  /** Übersetzung eines Textes (ohne HTML), oder null */
  function tr(s) {
    const key = norm(s);
    if (!key || !/[A-Za-z€$]/.test(key)) return null;
    if (DE.texts[key] != null) return DE.texts[key];
    const { tpl, vals } = template(key);
    if (vals.length) {
      if (DE.texts[tpl] != null) return fill(DE.texts[tpl], vals);
      if (!/[A-Za-z]/.test(tpl.replace(/\{\d+\}/g, ""))) return fill(tpl, vals); // nur Zahlen und Zeichen
    }
    for (const [re, rep] of DE.rules || []) {
      const m = key.match(re);
      if (m) return typeof rep === "function" ? rep(m, tr) : key.replace(re, rep);
    }
    if (collect) missing.add(vals.length ? tpl : key);
    return null;
  }

  // Satz mit Fettdruck/Links: nur Inline-Tags und eigener Text mit Buchstaben
  function inlineOnly(el) {
    for (const d of el.querySelectorAll("*")) if (!INLINE.has(d.tagName) || d.id) return false;
    for (const c of el.childNodes) if (c.nodeType === 3 && /[A-Za-z]/.test(c.data)) return true;
    return false;
  }
  // Zahlen nur im Text zwischen den Tags als Platzhalter, Attribute bleiben unberührt
  function htmlTemplate(s) {
    const vals = [];
    const tpl = s.split(/(<[^>]*>)/).map((part) => part.startsWith("<") ? part : part.replace(TOKEN, (t) => {
      vals.push(t);
      return `{${vals.length - 1}}`;
    })).join("");
    return { tpl, vals };
  }
  function trHtml(key) {
    if (DE.html[key] != null) return DE.html[key];
    const { tpl, vals } = htmlTemplate(key);
    if (vals.length && DE.html[tpl] != null) return fill(DE.html[tpl], vals);
    if (collect) missing.add("HTML::" + (vals.length ? tpl : key));
    return null;
  }

  function translateAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v || el.dataset["i18nDone" + a.replace(/-/g, "")] === v) continue;
      const t = tr(v);
      if (t != null) {
        el.setAttribute(a, t);
        el.dataset["i18nDone" + a.replace(/-/g, "")] = t;
      }
    }
    if (el.tagName === "INPUT" && (el.type === "submit" || el.type === "button") && el.value) {
      const t = tr(el.value);
      if (t != null) el.value = t;
    }
  }

  // was dieses Skript selbst geschrieben hat, nicht noch einmal übersetzen (sonst Endlosschleife)
  const done = new WeakMap();
  function translate(node) {
    if (node.nodeType === 3) {
      if (done.get(node) === node.data) return;
      const p = node.parentElement;
      if (!p || SKIP.has(p.tagName) || p.closest("[data-no-i18n], svg text.no-i18n")) return;
      const t = tr(node.data);
      if (t != null && t !== norm(node.data)) {
        const lead = node.data.match(/^\s*/)[0];
        const trail = node.data.match(/\s*$/)[0];
        node.data = lead + t + trail;
      }
      done.set(node, node.data);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    if (el.hasAttribute("data-no-i18n")) return;
    if (el.tagName === "OPTION") {
      const t = tr(el.textContent);
      if (t != null) el.textContent = t;
      return;
    }
    if (SKIP.has(el.tagName) && el.tagName !== "SELECT") {
      if (el.tagName === "INPUT") translateAttrs(el);
      return;
    }
    translateAttrs(el);
    // Absatz mit Fettdruck/Links: als Ganzes übersetzen, damit die Satzstellung stimmt
    if (el.children.length && el.tagName !== "SELECT" && inlineOnly(el)) {
      const t = trHtml(norm(el.innerHTML));
      if (t != null) {
        el.innerHTML = t;
        for (const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); w.nextNode();) done.set(w.currentNode, w.currentNode.data);
        return;
      }
    }
    for (const c of [...el.childNodes]) translate(c);
  }

  // ---------- Schalter im Header ----------
  function addSwitch() {
    const wrap = document.querySelector(".site-header .wrap");
    if (!wrap || wrap.querySelector(".lang-switch")) return;
    const g = document.createElement("div");
    g.className = "lang-switch";
    g.setAttribute("role", "group");
    g.setAttribute("aria-label", lang === "de" ? "Sprache" : "Language");
    g.setAttribute("data-no-i18n", "");
    for (const [code, flag, label] of [["en", "\u{1F1EC}\u{1F1E7}", "English"], ["de", "\u{1F1E9}\u{1F1EA}", "Deutsch"]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ls-opt";
      b.setAttribute("aria-pressed", String(lang === code));
      b.setAttribute("aria-label", label);
      b.innerHTML = `<span class="ls-flag" aria-hidden="true">${flag}</span>${code.toUpperCase()}`;
      b.addEventListener("click", () => {
        if (code === lang) return;
        try { localStorage.setItem(KEY, code); } catch {}
        location.reload();
      });
      g.appendChild(b);
    }
    const btns = wrap.querySelector(".head-btns");
    if (btns) btns.insertBefore(g, btns.firstChild);
    else wrap.appendChild(g);
  }

  if (lang !== "de" && !collect) {
    document.addEventListener("DOMContentLoaded", addSwitch);
    return;
  }

  // Deutsch: Seite erst zeigen, wenn sie übersetzt ist
  document.documentElement.lang = lang === "de" ? "de" : document.documentElement.lang;
  const hide = document.createElement("style");
  if (lang === "de") {
    hide.textContent = "body{visibility:hidden}";
    document.head.appendChild(hide);
  }
  document.addEventListener("DOMContentLoaded", () => {
    addSwitch();
    if (lang === "de" || collect) {
      const t = tr(document.title);
      if (t != null && lang === "de") document.title = t;
      const meta = document.querySelector('meta[name="description"]');
      if (meta) {
        const d = tr(meta.content);
        if (d != null && lang === "de") meta.content = d;
      }
      if (lang === "de") translate(document.body);
      else collectAll(document.body);
    }
    hide.remove();
    // spätere Änderungen (Live-Treffer, Stock, Tools …) ebenfalls übersetzen
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "characterData") lang === "de" ? translate(r.target) : collectAll(r.target);
        else if (r.type === "attributes") lang === "de" ? translateAttrs(r.target) : collectAll(r.target);
        else for (const n of r.addedNodes) lang === "de" ? translate(n) : collectAll(n);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  });

  // Sammelmodus (?i18n=collect): fehlende Texte ohne Änderung der Seite erfassen
  function collectAll(node) {
    if (node.nodeType === 3) {
      const p = node.parentElement;
      if (p && !SKIP.has(p.tagName) && !p.closest("[data-no-i18n]")) tr(node.data);
      return;
    }
    if (node.nodeType !== 1 || node.hasAttribute("data-no-i18n")) return;
    if (node.tagName === "OPTION") return void tr(node.textContent);
    for (const a of ATTRS) if (node.getAttribute(a)) tr(node.getAttribute(a));
    if (SKIP.has(node.tagName) && node.tagName !== "SELECT") return;
    if (node.children.length && node.tagName !== "SELECT" && inlineOnly(node) && trHtml(norm(node.innerHTML)) != null) return;
    for (const c of node.childNodes) collectAll(c);
  }
  window.__i18nCollect = () => {
    collectAll(document.body);
    tr(document.title);
    const meta = document.querySelector('meta[name="description"]');
    if (meta) tr(meta.content);
    return [...missing];
  };
  window.__i18n = { tr, template, deToken };
})();
