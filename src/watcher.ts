import { pathToFileURL } from "node:url";
import { config } from "./config.ts";
import { MockSource, RateLimitError, VintedSource, matches, type Source } from "./vinted.ts";
import type { HitInput, Search } from "./types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number, pct = 0.15) => ms * (1 - pct + Math.random() * 2 * pct);

/**
 * Der Watcher holt die Suchaufträge vom Backend, fragt die Datenquelle ab
 * und meldet neue, passende Listings per REST an das Backend.
 */
export class Watcher {
  /** Bereits gesehene Listing-IDs je Suchauftrag (inkl. Filter, damit Änderungen neu starten). */
  private seen = new Map<string, Set<string>>();
  private backoffMs = 0;
  private stopped = false;

  constructor(
    private source: Source,
    private backendUrl: string,
    private token: string,
    private intervalMs: number,
    private log = (msg: string) => console.log(`[watcher] ${msg}`),
  ) {}

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
    const searches = (await this.getSearches()).filter((s) => s.active);
    let found = 0;
    for (const [i, s] of searches.entries()) {
      if (this.stopped) break;
      if (i > 0) await sleep(jitter(3000)); // höflich: Anfragen nicht bündeln
      const key = `${s.id}|${s.query}|${s.maxPrice}|${s.size}`;
      const listings = await this.source.search(s);
      const firstRun = !this.seen.has(key);
      const seen = this.seen.get(key) ?? new Set<string>();
      this.seen.set(key, seen);

      for (const l of listings) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        // Beim ersten Durchlauf nur merken, was schon online ist. Gemeldet werden neue Listings.
        if (firstRun || !matches(s, l)) continue;
        let photoUrls = l.photoUrls;
        if (photoUrls.length < 3 && this.source.photos) {
          await sleep(jitter(1500)); // höflich bleiben
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
        });
        if (isNew) {
          found++;
          this.log(`🔥 Neuer Treffer: ${l.title} — ${l.price} ${l.currency}${l.size ? ` — Größe ${l.size}` : ""}`);
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
  const w = new Watcher(source, config.backendUrl, config.watcherToken, config.pollIntervalSec * 1000);
  void w.start();
  return w;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) startWatcher();
