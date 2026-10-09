import { decodeEntities, htmlText } from "../alerts/mime.ts";
import { baseAdapter, type Adapter, type Mail, type SourceHit } from "./catalog.ts";

/**
 * Kleinanzeigen: keine offene Schnittstelle. watchr liest nur die Suchauftrag-Mails, die Kleinanzeigen
 * dem Nutzer selbst schickt (Alert inbox), und baut Such-Links. Es ruft keine Kleinanzeigen-Seiten ab
 * und folgt keinen Links aus der Mail.
 */
const AD = /kleinanzeigen\.de\/s-anzeige\/([^/?#"'\s]+)\/(\d{6,})(?:-\d+-\d+)?/i;

/** Tracking-Links enthalten die eigentliche Adresse oft kodiert als Parameter */
function unwrap(href: string): string | null {
  const h = decodeEntities(href);
  if (AD.test(h)) return h;
  try {
    for (const v of new URL(h).searchParams.values()) if (AD.test(v)) return v;
  } catch {}
  const dec = (() => {
    try {
      return decodeURIComponent(h);
    } catch {
      return h;
    }
  })();
  return AD.test(dec) ? dec : null;
}

// "1.250 €", "45 € VB", "VB", "Zu verschenken"
function parsePrice(text: string): { price: number; negotiable: boolean } | null {
  if (/zu verschenken/i.test(text)) return { price: 0, negotiable: false };
  const m = text.match(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?\s*(?:€|EUR)(\s*VB)?/);
  if (!m) return null;
  return { price: Number(m[1].replace(/\./g, "") + (m[2] ? "." + m[2] : "")), negotiable: !!m[3] };
}

const titleFromSlug = (slug: string) => slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const clean = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const NOT_TITLE = /^(anzeige ansehen|ansehen|zur anzeige|mehr|details|jetzt ansehen|bild)$/i;

export function parseAlertEmail(mail: Mail): SourceHit[] {
  const html = mail.html || "";
  const found = new Map<string, { url: string; slug: string; titles: string[]; start: number; img: string | null }>();
  const order: string[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const target = unwrap(m[1]);
    const ad = target?.match(AD);
    if (!ad) continue;
    const id = ad[2];
    let e = found.get(id);
    if (!e) {
      e = { url: `https://www.kleinanzeigen.de/s-anzeige/${ad[1]}/${id}`, slug: ad[1], titles: [], start: m.index, img: null };
      found.set(id, e);
      order.push(id);
    }
    const t = clean(m[2]);
    if (t && !NOT_TITLE.test(t)) e.titles.push(t);
    const img = m[2].match(/<img\b[^>]*src\s*=\s*["']([^"']+)["']/i)?.[1];
    if (img && !e.img) e.img = decodeEntities(img);
  }
  // Text-Mails ohne HTML: Adressen aus dem Text
  if (!order.length && mail.text) return parseText(mail);

  const out: SourceHit[] = [];
  order.forEach((id, i) => {
    const e = found.get(id)!;
    const block = html.slice(e.start, i + 1 < order.length ? found.get(order[i + 1])!.start : html.length);
    const text = htmlText(block);
    const title = e.titles.sort((a, b) => b.length - a.length)[0] || titleFromSlug(e.slug);
    const price = parsePrice(text.replace(title, ""));
    if (!price) return;
    const img = e.img ?? block.match(/<img\b[^>]*src\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
    out.push(hit(id, e.url, title, price, text.match(/\b\d{5}\s+[A-ZÄÖÜ][\wäöüß.\- ]{1,40}/)?.[0]?.trim() ?? null, img ? [decodeEntities(img)] : [], mail.date));
  });
  return out;
}

function parseText(mail: Mail): SourceHit[] {
  const lines = mail.text.split(/\r?\n/).map((l) => l.trim());
  const out: SourceHit[] = [];
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    const url = line.match(/https?:\/\/\S+/)?.[0];
    const target = url && unwrap(url);
    const ad = target?.match(AD);
    if (!ad || seen.has(ad[2])) return;
    seen.add(ad[2]);
    const around = lines.slice(Math.max(0, i - 4), i).filter(Boolean);
    const price = around.map(parsePrice).find(Boolean) ?? null;
    if (!price) return;
    const title = around.find((l) => !parsePrice(l) && !/^\d{5}\s/.test(l) && !/https?:/.test(l)) ?? titleFromSlug(ad[1]);
    out.push(hit(ad[2], `https://www.kleinanzeigen.de/s-anzeige/${ad[1]}/${ad[2]}`, title, price, around.find((l) => /^\d{5}\s/.test(l)) ?? null, [], mail.date));
  });
  return out;
}

function hit(id: string, url: string, title: string, p: { price: number; negotiable: boolean }, location: string | null, photos: string[], date: string | null): SourceHit {
  return {
    source: "kleinanzeigen", sourceId: id, url, title: p.negotiable ? `${title} (VB)` : title, brand: null, size: null, condition: null,
    price: p.price, currency: "EUR", shipping: null, location, country: "DE",
    photoUrls: photos.filter((u) => /^https?:\/\//.test(u)).slice(0, 3),
    detectedAt: date && !isNaN(Date.parse(date)) ? new Date(date).toISOString() : new Date().toISOString(),
  };
}

export const kleinanzeigenAdapter = (): Adapter => ({ ...baseAdapter("kleinanzeigen", "alert"), parseAlertEmail });
export default kleinanzeigenAdapter;
