/**
 * Wissensbasis für die Kategorie „Designer & Archive“.
 * Kein maschinelles Lernen: eine kuratierte Liste von Designern und Archiv-Signalen,
 * die du in dieser Datei jederzeit erweitern kannst.
 *
 * tier 1 = gesuchte Archiv-Designer, tier 2 = Luxus-/Runway-Häuser, tier 3 = gefragte Premium-Labels
 */
export interface Designer {
  name: string;
  aliases: string[];
  tier: 1 | 2 | 3;
}

export const DESIGNERS: Designer[] = [
  { name: "Raf Simons", aliases: ["raf simons", "raf by raf"], tier: 1 },
  { name: "Helmut Lang", aliases: ["helmut lang"], tier: 1 },
  { name: "Rick Owens", aliases: ["rick owens", "drkshdw"], tier: 1 },
  { name: "Maison Margiela", aliases: ["margiela", "maison martin margiela", "mm6"], tier: 1 },
  { name: "Comme des Garçons", aliases: ["comme des garcons", "comme des garçons", "cdg"], tier: 1 },
  { name: "Yohji Yamamoto", aliases: ["yohji yamamoto", "y's", "yohji"], tier: 1 },
  { name: "Issey Miyake", aliases: ["issey miyake", "homme plisse", "pleats please"], tier: 1 },
  { name: "Jean Paul Gaultier", aliases: ["jean paul gaultier", "gaultier", "jpg"], tier: 1 },
  { name: "Vivienne Westwood", aliases: ["vivienne westwood"], tier: 1 },
  { name: "Undercover", aliases: ["undercover", "jun takahashi"], tier: 1 },
  { name: "Number (N)ine", aliases: ["number nine", "number (n)ine", "takahiro miyashita"], tier: 1 },
  { name: "Carol Christian Poell", aliases: ["carol christian poell", "ccp"], tier: 1 },
  { name: "Dior Homme", aliases: ["dior homme"], tier: 1 },
  { name: "Junya Watanabe", aliases: ["junya watanabe"], tier: 1 },
  { name: "Hysteric Glamour", aliases: ["hysteric glamour"], tier: 1 },
  { name: "Chrome Hearts", aliases: ["chrome hearts"], tier: 1 },
  { name: "Kapital", aliases: ["kapital"], tier: 1 },
  { name: "Ann Demeulemeester", aliases: ["ann demeulemeester"], tier: 1 },
  { name: "Boris Bidjan Saberi", aliases: ["boris bidjan saberi", "bbs"], tier: 1 },
  { name: "Julius", aliases: ["julius_7", "julius 7"], tier: 1 },
  { name: "Guidi", aliases: ["guidi"], tier: 1 },
  { name: "Thierry Mugler", aliases: ["thierry mugler", "mugler"], tier: 1 },
  { name: "Alexander McQueen", aliases: ["alexander mcqueen", "mcqueen"], tier: 1 },
  { name: "Walter Van Beirendonck", aliases: ["walter van beirendonck"], tier: 1 },
  { name: "Hedi Slimane", aliases: ["hedi slimane", "hedi era"], tier: 1 },
  { name: "Takahiro Miyashita The Soloist", aliases: ["the soloist", "soloist"], tier: 1 },
  { name: "Maurizio Amadei", aliases: ["maurizio amadei", "m.a+", "ma+"], tier: 1 },
  { name: "Craig Green", aliases: ["craig green"], tier: 2 },
  { name: "Kiko Kostadinov", aliases: ["kiko kostadinov"], tier: 2 },
  { name: "Sacai", aliases: ["sacai"], tier: 2 },
  { name: "Vetements", aliases: ["vetements"], tier: 2 },
  { name: "Martine Rose", aliases: ["martine rose"], tier: 2 },
  { name: "Wtaps", aliases: ["wtaps"], tier: 3 },
  { name: "Prada", aliases: ["prada", "prada sport", "linea rossa"], tier: 2 },
  { name: "Miu Miu", aliases: ["miu miu"], tier: 2 },
  { name: "Gucci", aliases: ["gucci"], tier: 2 },
  { name: "Saint Laurent", aliases: ["saint laurent", "yves saint laurent", "ysl"], tier: 2 },
  { name: "Balenciaga", aliases: ["balenciaga"], tier: 2 },
  { name: "Dries Van Noten", aliases: ["dries van noten"], tier: 2 },
  { name: "Jil Sander", aliases: ["jil sander"], tier: 2 },
  { name: "Moschino", aliases: ["moschino"], tier: 2 },
  { name: "Versace", aliases: ["versace", "gianni versace"], tier: 2 },
  { name: "Bottega Veneta", aliases: ["bottega veneta"], tier: 2 },
  { name: "Celine", aliases: ["celine", "céline"], tier: 2 },
  { name: "Loewe", aliases: ["loewe"], tier: 2 },
  { name: "Visvim", aliases: ["visvim"], tier: 2 },
  { name: "Stone Island", aliases: ["stone island"], tier: 3 },
  { name: "C.P. Company", aliases: ["c.p. company", "cp company"], tier: 3 },
  { name: "Acne Studios", aliases: ["acne studios"], tier: 3 },
  { name: "Our Legacy", aliases: ["our legacy"], tier: 3 },
  { name: "Moncler", aliases: ["moncler"], tier: 3 },
];

/** Hinweise im Titel, die auf ein Archiv- oder Sammlerstück deuten. */
const ARCHIVE_SIGNALS: [RegExp, string][] = [
  [/\barchive\b|\barchiv\b/i, "archive"],
  [/\bvintage\b/i, "vintage"],
  [/\brare\b|\bselten\b/i, "rare"],
  [/\bgrail\b/i, "grail"],
  [/\brunway\b|\blaufsteg\b/i, "runway"],
  [/\bsample\b|\bmuster\b/i, "sample"],
  [/\b(?:fw|aw|ss|f\/w|s\/s)\s?'?(?:\d{2}|\d{4})\b/i, "season"],
  [/\b(?:19[89]\d|200\d)s?\b|\b(?:80|90|00)s\b|\by2k\b/i, "era"],
  [/made in (?:italy|japan|italien|japan)/i, "made in"],
  [/\bdeadstock\b|\bdead stock\b/i, "deadstock"],
  [/\blimited\b|\blimitiert\b|\bnumbered\b|\bnummeriert\b/i, "limited"],
  [/\bmainline\b|\bhauptlinie\b|\bline 0\b|\bartisanal\b/i, "mainline"],
  [/\bcollab\b|\bcollaboration\b/i, "collab"],
  [/\bprototype\b|\bprototyp\b|\bone of one\b|\b1\/1\b/i, "one-off"],
];

const TIER_POINTS = { 1: 55, 2: 40, 3: 25 } as const;

export function findDesigner(text: string): Designer | null {
  const t = ` ${text.toLowerCase()} `;
  let best: Designer | null = null;
  for (const d of DESIGNERS) {
    if (d.aliases.some((a) => t.includes(` ${a} `) || t.includes(` ${a},`) || t.includes(` ${a}-`))) {
      if (!best || d.tier < best.tier) best = d;
    }
  }
  return best;
}

/**
 * Archive-Score von 0 bis 100: Designer-Rang + Archiv-Signale im Titel
 * + Bonus, wenn das Teil deutlich unter dem geschätzten Resellpreis liegt.
 */
export function archiveScore(
  l: { title: string; brand: string | null; price: number },
  resaleEstimate: number | null = null,
): { score: number; designer: string | null; signals: string[] } {
  const designer = findDesigner(`${l.brand ?? ""} ${l.title}`);
  const signals = ARCHIVE_SIGNALS.filter(([re]) => re.test(l.title)).map(([, name]) => name);
  let score = designer ? TIER_POINTS[designer.tier] : 0;
  score += Math.min(30, signals.length * 10);
  if (resaleEstimate && l.price <= resaleEstimate * 0.6) score += 15;
  return { score: Math.min(100, score), designer: designer?.name ?? null, signals };
}
