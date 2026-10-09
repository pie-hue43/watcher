import type { Mail } from "../sources/catalog.ts";

/**
 * Minimaler MIME-Leser für Benachrichtigungs-Mails: Kopfzeilen, multipart, base64,
 * quoted-printable und Zeichensätze. Liefert Absender, Betreff, Datum, HTML und Text.
 */
export function parseMail(raw: string | Buffer): Mail {
  const src = typeof raw === "string" ? Buffer.from(raw, "latin1") : raw;
  const part = parsePart(src);
  const out: Mail = { from: decodeWords(part.headers.from ?? ""), subject: decodeWords(part.headers.subject ?? ""), date: part.headers.date ?? null, html: "", text: "" };
  collect(part, out);
  return out;
}

interface Part {
  headers: Record<string, string>;
  body: Buffer;
}

function parsePart(buf: Buffer): Part {
  const s = buf.toString("latin1");
  const m = s.match(/\r?\n\r?\n/);
  const end = m ? m.index! : s.length;
  const head = s.slice(0, end).replace(/\r?\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim().toLowerCase();
      if (!(k in headers)) headers[k] = line.slice(i + 1).trim();
    }
  }
  return { headers, body: buf.subarray(m ? end + m[0].length : buf.length) };
}

const param = (h: string | undefined, name: string) => h?.match(new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, "i"))?.[1] ?? null;

function collect(p: Part, out: Mail) {
  const type = (p.headers["content-type"] ?? "text/plain").toLowerCase();
  if (type.startsWith("multipart/")) {
    const boundary = param(p.headers["content-type"], "boundary");
    if (!boundary) return;
    const body = p.body.toString("latin1");
    const pieces = body.split(new RegExp(`(?:^|\\r?\\n)--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?[ \\t]*(?:\\r?\\n|$)`));
    for (const piece of pieces.slice(1)) if (piece.trim()) collect(parsePart(Buffer.from(piece, "latin1")), out);
    return;
  }
  if (type.startsWith("message/rfc822")) return collect(parsePart(p.body), out);
  if (!type.startsWith("text/")) return;
  const text = decodeBody(p.body, p.headers["content-transfer-encoding"], param(p.headers["content-type"], "charset"));
  if (type.startsWith("text/html")) out.html += text;
  else out.text += text;
}

function decodeBody(body: Buffer, enc: string | undefined, charset: string | null): string {
  const e = (enc ?? "").toLowerCase().trim();
  let bytes: Buffer = body;
  if (e === "base64") bytes = Buffer.from(body.toString("latin1").replace(/\s+/g, ""), "base64");
  else if (e === "quoted-printable") bytes = qp(body.toString("latin1"));
  return decodeCharset(bytes, charset);
}

function qp(s: string): Buffer {
  const out: number[] = [];
  const t = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) {
      out.push(parseInt(t.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(t.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

function decodeCharset(bytes: Buffer, charset: string | null): string {
  try {
    return new TextDecoder((charset ?? "utf-8").toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** =?UTF-8?Q?...?= und =?UTF-8?B?...?= in Kopfzeilen */
export function decodeWords(s: string): string {
  return s
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_, cs, enc, txt) =>
      decodeCharset(enc.toUpperCase() === "B" ? Buffer.from(txt, "base64") : qp(txt.replace(/_/g, " ")), cs),
    );
}

/** HTML -> lesbarer Text (für Preise und Orte in den Mails) */
export function htmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|tr|td|li|h\d|table)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é", egrave: "è" };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : named[e] ?? m,
  );
}
