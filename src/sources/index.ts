import { catalog, type Adapter } from "./catalog.ts";
import type { Source } from "./vinted.ts";
import { vintedAdapter } from "./vinted.ts";
import ebay from "./ebay.ts";
import etsy from "./etsy.ts";
import kleinanzeigen from "./kleinanzeigen.ts";
import grailed from "./grailed.ts";
import vestiaire from "./vestiaire.ts";
import depop from "./depop.ts";
import willhaben from "./willhaben.ts";
import marktplaats from "./marktplaats.ts";
import leboncoin from "./leboncoin.ts";
import wallapop from "./wallapop.ts";
import subito from "./subito.ts";
import mercariJp from "./mercari-jp.ts";
import yahooAuctionsJp from "./yahoo-auctions-jp.ts";

/** Alle Plattformen in der Reihenfolge der Liste in public/platforms.js. */
export function makeAdapters(vintedSource: Source, env: NodeJS.ProcessEnv = process.env, fetchFn: typeof fetch = fetch): Map<string, Adapter> {
  const list: Adapter[] = [
    vintedAdapter(vintedSource), ebay(env, fetchFn), kleinanzeigen(), grailed(), vestiaire(), depop(), etsy(env, fetchFn),
    willhaben(), marktplaats(), leboncoin(), wallapop(), subito(), mercariJp(), yahooAuctionsJp(),
  ];
  return new Map(catalog.IDS.map((id) => [id, list.find((a) => a.id === id)!]));
}

/** Was die Website über die Plattformen wissen muss (ohne Schlüssel). */
export function describe(adapters: Map<string, Adapter>) {
  return [...adapters.values()].map((a) => ({
    id: a.id, name: a.name, country: a.country, eu: a.eu, currency: a.currency, mode: a.mode,
    live: a.mode === "api" && !!a.search, alert: a.mode === "alert", env: a.mode === "api" ? [] : a.env ?? [], senders: a.senders ?? [],
  }));
}

export { catalog };
