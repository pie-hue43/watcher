import { pathToFileURL } from "node:url";
import { config } from "./config.ts";
import { join, dirname } from "node:path";
import { DESIGNERS, archiveScore } from "./designers.ts";
import { splitCategory } from "./tags.ts";
import { PriceEstimator, brandFromTitle, type PriceRef } from "./pricing.ts";
import { MockSource, RateLimitError, VintedSource, matches, type Listing, type Source } from "./sources/vinted.ts";
import type { HitInput, Search } from "./types.ts";
import { createHash } from "node:crypto";
import { catalog, type Adapter, type SourceHit } from "./sources/catalog.ts";
import { makeAdapters } from "./sources/index.ts";
import { ALERT_INTERVAL_MS, checkInbox, imapOptions, type InboxStatus } from "./alerts/inbox.ts";
import type { ImapOptions } from "./alerts/imap.ts";

/** Listing einer beliebigen Plattform (Vinted-Listings bekommen source "vinted") */
type AnyListing = Listing & { source: string; shipping?: number | null; location?: string | null; country?: string | null };
const fromSourceHit = (h: SourceHit): AnyListing => ({
  id: h.sourceId, title: h.title, price: h.price, currency: h.currency, size: h.size, brand: h.brand ?? brandFromTitle(h.title), url: h.url, photoUrls: h.photoUrls,
  condition: h.condition, source: h.source, shipping: h.shipping, location: h.location, country: h.country ?? null,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number, pct = 0.15) => ms * (1 - pct + Math.random() * 2 * pct);

/** Ab diesem Archive-Score meldet eine #archive-Suche ein Teil. */
export const ARCHIVE_MIN_SCORE = 50;
/** So viele Designer fragt eine #archive-Suche pro Durchlauf ab (reihum, damit Vinted nicht überlastet wird). */
const DESIGNERS_PER_RUN = 3;

/**
 * Der Watcher holt die Suchaufträge vom Backend, fragt die Datenquelle ab
 * und meldet neue, passende Listings per REST an das Backend.
 */
export class Watcher {
  /** Bereits gesehene Listing-IDs je Suchauftrag (inkl. Filter, damit Änderungen neu starten). */
  private seen = new Map<string, Set<string>>();
  private backoffMs = 0;
  private stopped = false;
  /** Pause zwischen zwei Anfragen an Vinted (in Tests 0) */
  gapMs = 3000;
  /** Position in der Designer- bzw. Kategorieliste je Suche */
  private rotation = new Map<string, number>();
  private estimator: PriceEstimator | null;
  /** Vergleichspreise anderer Plattformen mit offizieller Schnittstelle (eBay) */
  private extraEstimators = new Map<string, PriceEstimator>();
  /** Plattformen außer Vinted; Standard: aus .env (eBay/Etsy nur mit Schlüssel live) */
  adapters: Map<string, Adapter>;
  /** Alert inbox (null = nicht eingerichtet) */
  imap: ImapOptions | null = imapOptions();
  /** Fotos für den Dubletten-Vergleich laden (in Tests aus) */
  hashPhotos = true;

  constructor(
    private source: Source,
    private backendUrl: string,
    private token: string,
    private intervalMs: number,
    private log = (msg: string) => console.log(`[watcher] ${msg}`),
    priceCacheFile: string | null = null,
    adapters?: Map<string, Adapter>,
  ) {
    this.estimator = source.comparables ? new PriceEstimator((q) => source.comparables!(q), priceCacheFile) : null;
    this.adapters = adapters ?? makeAdapters(source);
    for (const a of this.adapters.values())
      if (a.id !== "vinted" && a.mode === "api" && a.comparables)
        this.extraEstimators.set(a.id, new PriceEstimator((q) => a.comparables!(q), priceCacheFile ? priceCacheFile.replace(/\.json$/, `-${a.id}.json`) : null));
  }

  /** Normale Suchen laufen einmal, #archive-Suchen reihum über mehrere Designer. */
  /**
   * Kategorie-Hashtags (#accessories, #tops) gehen nicht als Text an Vinted, sondern werden beim Abgleich geprüft.
   * Bleibt sonst kein Suchwort übrig, fragt der Watcher die Begriffe der Kategorie reihum ab.
   */
  private queriesFor(s: Search): (Search & { keywords: string })[] {
    const { rest, category } = splitCategory(s.query);
    const rotate = <T,>(key: string, list: T[], n: number) => {
      const start = this.rotation.get(key) ?? 0;
      this.rotation.set(key, (start + n) % list.length);
      return Array.from({ length: Math.min(n, list.length) }, (_, i) => list[(start + i) % list.length]);
    };
    if (s.kind === "archive")
      return rotate(`a${s.id}`, DESIGNERS, DESIGNERS_PER_RUN).map((d) => ({ ...s, query: `${d.name} ${rest}`.trim(), keywords: s.query }));
    if (category && !rest)
      return rotate(`c${s.id}`, category.search, DESIGNERS_PER_RUN).map((term) => ({ ...s, query: term, keywords: s.query }));
    return [{ ...s, query: category ? rest : s.query, keywords: s.query }];
  }

  private async resale(l: Listing): Promise<PriceRef | null> {
    if (!this.estimator) return null;
    return this.estimator.estimate(l).catch((err) => {
      if (err instanceof RateLimitError) throw err;
      return null;
    });
  }

  private async getSearches(): Promise<Search[]> {
    const res = await fetch(`${this.backendUrl}/api/searches`);
    if (!res.ok) throw new Error(`Backend /api/searches: HTTP ${res.status}`);
    return (await res.json()) as Search[];
  }

  /** Wiederverkaufswerte auf anderen Plattformen (nur mit echten Vergleichspreisen) */
  private async resaleBy(l: Listing): Promise<HitInput["resaleBy"]> {
    const out: NonNullable<HitInput["resaleBy"]> = {};
    for (const [id, est] of this.extraEstimators) {
      const ref = await est.estimate(l).catch(() => null);
      if (ref) out[id] = { median: ref.median, low: ref.low, high: ref.high, samples: ref.samples };
    }
    return Object.keys(out).length ? out : null;
  }

  /** SHA-1 des ersten Fotos: gleiche Bilddatei auf zwei Plattformen = dasselbe Teil */
  private async photoHash(urls: string[]): Promise<string | null> {
    if (!this.hashPhotos || !urls[0]) return null;
    try {
      const res = await fetch(urls[0], { signal: AbortSignal.timeout(5000) });
      if (!res.ok || Number(res.headers.get("content-length") ?? 0) > 3_000_000) return null;
      return createHash("sha1").update(Buffer.from(await res.arrayBuffer())).digest("hex");
    } catch {
      return null;
    }
  }

  /** Prüft und meldet ein neues Listing. Gibt true zurück, wenn es neu ans Backend ging. */
  private async consider(s: Search & { keywords: string }, l: AnyListing): Promise<boolean> {
    if (!matches(s, l, s.keywords)) return false;
    // Archive-Modus: Teile ohne Chance auf den Mindest-Score gar nicht erst bewerten (spart Anfragen)
    if (s.kind === "archive" && archiveScore(l).score + 15 < ARCHIVE_MIN_SCORE) return false;
    const ref = await this.resale(l);
    const arch = archiveScore(l, ref?.median ?? null);
    if (s.kind === "archive" && arch.score < ARCHIVE_MIN_SCORE) return false;
    let photoUrls = l.photoUrls;
    if (l.source === "vinted" && photoUrls.length < 3 && this.source.photos) {
      await sleep(jitter(this.gapMs / 2)); // höflich bleiben
      photoUrls = await this.source.photos(l).catch((err) => {
        if (err instanceof RateLimitError) throw err;
        return l.photoUrls;
      });
    }
    const isNew = await this.report({
      vintedId: l.source === "vinted" ? l.id : `${l.source}:${l.id}`,
      searchId: s.id,
      title: l.title,
      price: l.price,
      currency: l.currency,
      size: l.size,
      brand: l.brand,
      url: l.url,
      photoUrls,
      resaleEstimate: ref?.median ?? null,
      resaleLow: ref?.low ?? null,
      resaleHigh: ref?.high ?? null,
      resaleSamples: ref?.samples ?? null,
      archiveScore: arch.score,
      designer: arch.designer,
      source: l.source,
      sourceId: l.id,
      condition: l.condition ?? null,
      shipping: l.shipping ?? null,
      location: l.location ?? null,
      country: l.country ?? null,
      photoHash: await this.photoHash(photoUrls),
      resaleBy: await this.resaleBy(l),
    });
    if (isNew) {
      const diff = ref ? ` — Resell ~${ref.median} (${l.price <= ref.median ? "+" : ""}${Math.round(ref.median - l.price)})` : "";
      const where = l.source === "vinted" ? "" : ` [${catalog.byId(l.source)?.name ?? l.source}]`;
      this.log(`🔥 Neuer Treffer${where}: ${l.title} — ${l.price} ${l.currency}${l.size ? ` — Größe ${l.size}` : ""}${diff}`);
    }
    return isNew;
  }

  private async report(hit: HitInput): Promise<boolean> {
    const res = await fetch(`${this.backendUrl}/api/hits`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(hit),
    });
    if (res.status === 401) throw new Error("Backend lehnt den Watcher ab: WATCHER_TOKEN stimmt nicht überein");
    if (!res.ok) throw new Error(`Backend /api/hits: HTTP ${res.status}`);
    return res.status === 201;
  }

  /** Ein Durchlauf über alle aktiven Suchaufträge. Gibt die Zahl neuer Treffer zurück. */
  async runOnce(): Promise<number> {
    const searches = (await this.getSearches()).filter((s) => s.active).flatMap((s) => this.queriesFor(s));
    // Je Suchauftrag: Vinted wie bisher, dazu jede Plattform mit offizieller Schnittstelle (eBay, Etsy mit Schlüssel)
    const jobs = searches.flatMap((s) =>
      catalog.expand(s.sources).flatMap((id) => {
        if (id === "vinted") return [{ s, id }];
        const a = this.adapters.get(id);
        return a && a.mode === "api" && a.search ? [{ s, id }] : [];
      }),
    );
    let found = 0;
    for (const [i, { s, id }] of jobs.entries()) {
      if (this.stopped) break;
      if (i > 0) await sleep(jitter(this.gapMs)); // höflich: Anfragen nicht bündeln
      const key = `${id}|${s.id}|${s.kind}|${s.query}|${s.minPrice}|${s.maxPrice}|${s.size}|${s.condition}`;
      const listings: AnyListing[] =
        id === "vinted"
          ? (await this.source.search(s)).map((l) => ({ ...l, source: "vinted" }))
          : (await this.adapters.get(id)!.search!(s)).map(fromSourceHit);
      const firstRun = !this.seen.has(key);
      const seen = this.seen.get(key) ?? new Set<string>();
      this.seen.set(key, seen);

      for (const l of listings) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        // Beim ersten Durchlauf nur merken, was schon online ist. Gemeldet werden neue Listings.
        if (firstRun) continue;
        if (await this.consider(s, l)) found++;
      }
      if (firstRun) this.log(`"${s.query}"${id === "vinted" ? "" : ` (${catalog.byId(id)?.name})`}: ${listings.length} bestehende Listings gemerkt, ab jetzt wird nur Neues gemeldet`);
      if (seen.size > 2000) this.seen.set(key, new Set([...seen].slice(-1000)));
    }
    return found;
  }

  /** Alert inbox: Treffer aus Benachrichtigungs-Mails gegen die Präferenzen mit dieser Plattform prüfen */
  async checkAlerts(): Promise<{ mails: number; hits: number; reported: number }> {
    if (!this.imap) return { mails: 0, hits: 0, reported: 0 };
    const alertAdapters = [...this.adapters.values()].filter((a) => a.mode === "alert" && a.parseAlertEmail);
    const searches = (await this.getSearches()).filter((s) => s.active);
    let reported = 0;
    const r = await checkInbox(this.imap, alertAdapters, async (h) => {
      const l = fromSourceHit(h);
      for (const s of searches.filter((x) => catalog.expand(x.sources).includes(h.source))) {
        // Kategorie-/Archive-Suchen: Stichwörter wie bei Vinted prüfen, ohne rotierenden Designer
        if (await this.consider({ ...s, keywords: s.query }, l)) {
          reported++;
          break;
        }
      }
    });
    return { ...r, reported };
  }

  private async alertLoop() {
    while (!this.stopped && this.imap) {
      const status: Partial<InboxStatus> = { configured: true, host: this.imap.host, user: this.imap.user, lastCheck: new Date().toISOString() };
      try {
        const r = await this.checkAlerts();
        Object.assign(status, { lastError: null, lastMails: r.mails, lastHits: r.reported });
        if (r.mails) this.log(`Alert inbox: ${r.mails} Mail(s), ${r.hits} Angebot(e), ${r.reported} passend gemeldet`);
      } catch (err) {
        status.lastError = (err as Error).message;
        this.log(`Alert inbox: ${(err as Error).message}`);
      }
      await fetch(`${this.backendUrl}/api/alerts/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(status),
      }).catch(() => {});
      await sleep(ALERT_INTERVAL_MS);
    }
  }

  async start() {
    this.log(`läuft (Quelle: ${this.source.constructor.name}, Intervall ${this.intervalMs / 1000}s)`);
    if (this.imap) void this.alertLoop();
    while (!this.stopped) {
      try {
        await this.runOnce();
        this.backoffMs = 0;
      } catch (err) {
        if (err instanceof RateLimitError) {
          this.backoffMs = Math.min(30 * 60_000, this.backoffMs ? this.backoffMs * 2 : 2 * 60_000);
          this.log(`${err.message}, pausiere ${Math.round(this.backoffMs / 60_000)} min`);
        } else {
          this.log(`Fehler: ${(err as Error).message}`);
        }
      }
      await sleep(this.backoffMs || jitter(this.intervalMs));
    }
  }

  stop() {
    this.stopped = true;
  }
}

export function startWatcher() {
  const source = config.source === "mock" ? new MockSource() : new VintedSource(config.vintedDomain);
  const priceCache = join(dirname(config.dbPath), "price-cache.json");
  const w = new Watcher(source, config.backendUrl, config.watcherToken, config.pollIntervalSec * 1000, undefined, priceCache);
  void w.start();
  return w;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) startWatcher();
