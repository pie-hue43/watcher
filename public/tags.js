// Individual Preferences: hashtags <-> search filters.
// #nike #dunk  -> keywords        #size43 / #sizeM -> size
// #max80 / #under80 -> max price  #min20 / #over20  -> min price
// #newtags, #new, #verygood, #good -> minimum condition
// #archive -> Designer & Archive mode (keywords optional)
(function () {
  const CONDITIONS = { newtags: "new_tags", newwithtags: "new_tags", new: "new", verygood: "very_good", good: "good" };
  const CONDITION_TAGS = { new_tags: "#newtags", new: "#new", very_good: "#verygood", good: "#good" };

  function parse(text) {
    const out = { keywords: [], minPrice: null, maxPrice: null, size: null, condition: null, kind: "standard", tags: [] };
    const tokens = String(text || "").split(/[\s,]+/).map((t) => t.replace(/^#+/, "")).filter(Boolean);
    for (const raw of tokens) {
      const t = raw.toLowerCase();
      let m;
      if ((m = t.match(/^(?:max|under)(\d+(?:[.,]\d+)?)€?$/))) out.maxPrice = Number(m[1].replace(",", "."));
      else if ((m = t.match(/^(?:min|over)(\d+(?:[.,]\d+)?)€?$/))) out.minPrice = Number(m[1].replace(",", "."));
      else if ((m = raw.match(/^size[:=]?(.+)$/i))) out.size = m[1];
      else if (CONDITIONS[t]) out.condition = CONDITIONS[t];
      else if (t === "archive" || t === "designer") out.kind = "archive";
      else out.keywords.push(raw);
    }
    out.tags = toTags(out);
    return out;
  }

  function toTags(f) {
    const words = f.keywords || String(f.query || "").split(/\s+/).filter(Boolean);
    return [
      f.kind === "archive" ? "#archive" : null,
      ...words.map((w) => "#" + w),
      f.size ? "#size" + f.size : null,
      f.minPrice != null ? "#min" + f.minPrice : null,
      f.maxPrice != null ? "#max" + f.maxPrice : null,
      f.condition ? CONDITION_TAGS[f.condition] : null,
    ].filter(Boolean);
  }

  window.watchrTags = { parse, toTags };
})();
