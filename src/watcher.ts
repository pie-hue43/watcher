import { pathToFileURL } from "node:url";
import { config } from "./config.ts";
import { join, dirname } from "node:path";
import { DESIGNERS, archiveScore } from "./designers.ts";
import { splitCategory } from "./tags.ts";
import { PriceEstimator, type PriceRef } from "./pricing.ts";
import { MockSource, RateLimitError, VintedSource, matches, type Listing, type Source } from "./vinted.ts";
import type { HitInput, Search } from "./types.ts";

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

  constructor(
    private source: Source,
    private backendUrl: string,
    private token: string,
    private intervalMs: number,
    private log = (msg: string) => console.log(`[watcher] ${msg}`),
    priceCacheFile: string | null = null,
  ) {
    this.estimator = source.comparables ? new PriceEstimator((q) => source.comparables!(q), priceCacheFile) : null;
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
    let found = 0;
    for (const [i, s] of searches.entries()) {
      if (this.stopped) break;
      if (i > 0) await sleep(jitter(this.gapMs)); // höflich: Anfragen nicht bündeln
      const key = `${s.id}|${s.kind}|${s.query}|${s.minPrice}|${s.maxPrice}|${s.size}|${s.condition}`;
      const listings = await this.source.search(s);
      const firstRun = !this.seen.has(key);
      const seen = this.seen.get(key) ?? new Set<string>();
      this.seen.set(key, seen);

      for (const l of listings) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        // Beim ersten Durchlauf nur merken, was schon online ist. Gemeldet werden neue Listings.
        if (firstRun || !matches(s, l, s.keywords)) continue;
        // Archive-Modus: Teile ohne Chance auf den Mindest-Score gar nicht erst bewerten (spart Anfragen)
        if (s.kind === "archive" && archiveScore(l).score + 15 < ARCHIVE_MIN_SCORE) continue;
        const ref = await this.resale(l);
        const arch = archiveScore(l, ref?.median ?? null);
        if (s.kind === "archive" && arch.score < ARCHIVE_MIN_SCORE) continue;
        let photoUrls = l.photoUrls;
        if (photoUrls.length < 3 && this.source.photos) {
          await sleep(jitter(this.gapMs / 2)); // höflich bleiben
          photoUrls = await this.source.photos(l).catch((err) => {
            if (err instanceof RateLimitError) throw err;
            return l.photoUrls;
          });
        }
        const isNew = await this.report({
          vintedId: l.id,
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
        });
        if (isNew) {
          found++;
          const diff = ref ? ` — Resell ~${ref.median} (${l.price <= ref.median ? "+" : ""}${Math.round(ref.median - l.price)})` : "";
          this.log(`🔥 Neuer Treffer: ${l.title} — ${l.price} ${l.currency}${l.size ? ` — Größe ${l.size}` : ""}${diff}`);
        }
      }
      if (firstRun) this.log(`"${s.query}": ${listings.length} bestehende Listings gemerkt, ab jetzt wird nur Neues gemeldet`);
      if (seen.size > 2000) this.seen.set(key, new Set([...seen].slice(-1000)));
    }
    return found;
  }

  async start() {
    this.log(`läuft (Quelle: ${this.source.constructor.name}, Intervall ${this.intervalMs / 1000}s)`);
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
