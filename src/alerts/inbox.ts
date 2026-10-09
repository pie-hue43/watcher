import { Imap, type ImapOptions } from "./imap.ts";
import { parseMail } from "./mime.ts";
import type { Adapter, SourceHit } from "../sources/catalog.ts";

/**
 * Alert inbox: liest alle 2 Minuten nur ungelesene Mails von bekannten Absendern der Alert-Plattformen,
 * wertet sie mit parseAlertEmail aus und markiert sie danach als gelesen.
 * Zugangsdaten stehen nur in .env (IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD), nie im Browser.
 */
export const ALERT_INTERVAL_MS = 2 * 60_000;

export interface InboxStatus {
  configured: boolean;
  host: string | null;
  user: string | null;
  lastCheck: string | null;
  lastError: string | null;
  lastMails: number;
  lastHits: number;
}

export function imapOptions(env: NodeJS.ProcessEnv = process.env): ImapOptions | null {
  const host = env.IMAP_HOST?.trim();
  const user = env.IMAP_USER?.trim();
  const password = env.IMAP_PASSWORD;
  if (!host || !user || !password) return null;
  const port = Number(env.IMAP_PORT || 993);
  return { host, port, user, password, secure: env.IMAP_TLS ? env.IMAP_TLS !== "false" : port !== 143 };
}

/** Ein Durchgang: Mails abholen, auswerten, als gelesen markieren. onHit entscheidet, was mit den Treffern passiert. */
export async function checkInbox(opts: ImapOptions, adapters: Adapter[], onHit: (h: SourceHit) => Promise<void>): Promise<{ mails: number; hits: number }> {
  const imap = new Imap(opts);
  await imap.connect();
  let mails = 0;
  let hits = 0;
  try {
    await imap.select("INBOX");
    for (const a of adapters) {
      if (!a.parseAlertEmail) continue;
      for (const sender of a.senders ?? []) {
        for (const uid of await imap.unseenFrom(sender)) {
          const raw = await imap.fetch(uid);
          if (raw) {
            const found = a.parseAlertEmail(parseMail(raw));
            for (const h of found) await onHit(h);
            hits += found.length;
          }
          await imap.markSeen(uid);
          mails++;
        }
      }
    }
  } finally {
    await imap.logout();
  }
  return { mails, hits };
}
