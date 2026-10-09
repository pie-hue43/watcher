import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { catalog, type Fx } from "./sources/catalog.ts";

/**
 * Tageskurse der Europäischen Zentralbank (Euro-Referenzkurse), 24 h zwischengespeichert.
 * Ohne Internet gelten die letzten gespeicherten Kurse oder die Ersatzkurse aus platforms.js.
 */
const ECB = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const MAX_AGE = 24 * 3600_000;

export class FxRates {
  private current: Fx & { fetchedAt?: string };
  private loading: Promise<void> | null = null;

  constructor(private cacheFile: string | null, private fetchFn: typeof fetch = fetch) {
    this.current = { ...catalog.FALLBACK_FX };
    if (cacheFile) {
      try {
        const saved = JSON.parse(readFileSync(cacheFile, "utf8"));
        if (saved?.rates?.USD) this.current = saved;
      } catch {}
    }
  }

  /** Aktuelle Kurse sofort (ggf. veraltet); stößt im Hintergrund eine Aktualisierung an. */
  get(): Fx {
    const age = this.current.fetchedAt ? Date.now() - Date.parse(this.current.fetchedAt) : Infinity;
    if (age > MAX_AGE && !this.loading) this.loading = this.refresh().finally(() => (this.loading = null));
    return this.current;
  }

  async ready(): Promise<Fx> {
    this.get();
    await this.loading?.catch(() => {});
    return this.current;
  }

  private async refresh() {
    try {
      const res = await this.fetchFn(ECB, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const rates: Record<string, number> = { EUR: 1 };
      for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[m[1]] = Number(m[2]);
      if (!rates.USD) throw new Error("no rates in the ECB file");
      this.current = { base: "EUR", date: xml.match(/time=['"]([\d-]+)['"]/)?.[1] ?? new Date().toISOString().slice(0, 10), rates, fetchedAt: new Date().toISOString() };
      if (this.cacheFile) {
        mkdirSync(dirname(this.cacheFile), { recursive: true });
        writeFileSync(this.cacheFile, JSON.stringify(this.current));
      }
    } catch (err) {
      // nächster Versuch frühestens in einer Stunde
      this.current = { ...this.current, fetchedAt: new Date(Date.now() - MAX_AGE + 3600_000).toISOString() };
      console.warn(`[fx] Exchange rates not updated (${(err as Error).message}), using ${this.current.fallback ? "fallback" : "saved"} rates from ${this.current.date}`);
    }
  }
}
