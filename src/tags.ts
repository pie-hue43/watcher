import { DESIGNERS } from "./designers.ts";

/**
 * Hashtag-Abgleich: Jeder Suchbegriff aus den Individual Preferences muss zum Artikel passen.
 * Vinted liefert bei einer Suche auch lose verwandte Treffer; der Snipebot prüft deshalb
 * selbst, ob jedes Stichwort im Titel, in der Marke oder in der Größe vorkommt.
 * Deutsche und englische Begriffe (#jacket = Jacke) und Designer-Kürzel (#cdg) zählen gleich.
 */
const SYNONYMS: string[][] = [
  ["jacket", "jacke", "blouson", "bomber", "parka"],
  ["coat", "mantel", "trench"],
  ["pants", "trousers", "hose", "cargo"],
  ["jeans", "denim"],
  ["sweater", "pullover", "jumper", "strick", "knit", "sweatshirt", "crewneck"],
  ["hoodie", "kapuzen", "hooded"],
  ["tshirt", "t-shirt", "tee"],
  ["shirt", "hemd", "button"],
  ["shoes", "schuhe", "sneaker", "sneakers", "trainers"],
  ["boots", "boot", "stiefel"],
  ["bag", "tasche", "handbag", "backpack", "rucksack"],
  ["belt", "gurtel", "guertel"],
  ["cap", "mutze", "beanie", "hat"],
  ["dress", "kleid"],
  ["skirt", "rock"],
  ["scarf", "schal"],
  ["wallet", "geldborse", "portemonnaie"],
  ["leather", "leder"],
  ["wool", "wolle"],
  ["black", "schwarz"],
  ["white", "weiss"],
  ["blue", "blau", "navy"],
  ["red", "rot"],
  ["green", "grun", "gruen"],
  ["grey", "gray", "grau"],
  ["brown", "braun"],
  ["vintage", "retro"],
];

/** Kleinbuchstaben, ohne Akzente/Umlaute-Punkte, nur Buchstaben und Ziffern. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Alle Schreibweisen, die für ein Stichwort gelten. */
function variants(word: string): string[] {
  const w = norm(word);
  const out = new Set([w]);
  for (const group of SYNONYMS) if (group.map(norm).includes(w)) group.forEach((g) => out.add(norm(g)));
  for (const d of DESIGNERS) {
    const names = [d.name, ...d.aliases].map(norm);
    if (names.includes(w) || names.some((n) => n.replace(/ /g, "") === w)) names.forEach((n) => out.add(n));
  }
  return [...out].filter(Boolean);
}

/** Passt ein einzelnes Stichwort zum Text? Kurze Wörter müssen am Wortanfang stehen. */
export function keywordMatches(word: string, text: string): boolean {
  const t = ` ${norm(text)} `;
  const compact = t.replace(/ /g, "");
  return variants(word).some((v) => {
    if (v.includes(" ")) return t.includes(` ${v} `) || compact.includes(v.replace(/ /g, ""));
    if (v.length >= 4) return t.includes(v) || compact.includes(v); // auch in Komposita: "Poloshirt", "#ralphlauren"
    return new RegExp(`\\s${v}`).test(t); // "tee" nicht in "Steel" finden
  });
}

/** Prüft alle Stichwörter einer Präferenz und gibt die zurück, die nicht passen. */
export function missingKeywords(query: string, l: { title: string; brand: string | null; size: string | null }): string[] {
  const text = [l.title, l.brand, l.size].filter(Boolean).join(" ");
  return query
    .split(/[\s,]+/)
    .map((w) => w.replace(/^#+/, ""))
    .filter(Boolean)
    .filter((w) => !keywordMatches(w, text));
}
