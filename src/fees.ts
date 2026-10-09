import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { catalog, setFees, type Fees } from "./sources/catalog.ts";

/**
 * Gebühren je Plattform in data/fees.json (wird beim ersten Start mit den Standardwerten angelegt).
 * Die Datei kann man direkt bearbeiten; die Website liest sie über /api/fees.
 * Platzhalter (set: false) meldet watchr beim Start als "fees not set".
 */
export class FeeStore {
  fees: Fees;

  constructor(private file: string | null) {
    let saved: unknown = null;
    if (file) {
      try {
        saved = JSON.parse(readFileSync(file, "utf8"));
      } catch {}
    }
    this.fees = catalog.mergeFees(saved);
    if (file && !saved) this.save();
    setFees(this.fees);
  }

  notSet(): string[] {
    return catalog.IDS.filter((id) => !catalog.feesSet(this.fees, id));
  }

  /** Teil-Änderung für eine Plattform oder die Einfuhr-Werte (id = "import") */
  update(id: string, b: any): Fees {
    const num = (v: unknown, name: string, max: number) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > max) throw new FeeError(`${name} must be a number between 0 and ${max}`);
      return n;
    };
    if (id === "import") {
      if (b.importVatRate !== undefined) this.fees.importVatRate = num(b.importVatRate, "importVatRate", 1);
      if (b.dutyRate !== undefined) this.fees.dutyRate = num(b.dutyRate, "dutyRate", 1);
      if (b.dutyFreeUpToEur !== undefined) this.fees.dutyFreeUpToEur = num(b.dutyFreeUpToEur, "dutyFreeUpToEur", 100_000);
    } else {
      const f = this.fees.platforms[id];
      if (!f) throw new FeeError("Unknown platform", 404);
      for (const side of ["buy", "sell"] as const) {
        const s = b?.[side];
        if (!s) continue;
        const t: any = f[side];
        for (const k of ["fixed", "rate", "shipping", "paymentRate", "paymentFixed"]) {
          if (s[k] === undefined || !(k in t)) continue;
          t[k] = num(s[k], `${side}.${k}`, k.endsWith("ate") ? 1 : 100_000);
        }
        for (const k of ["currency", "fixedCurrency"]) if (typeof s[k] === "string" && k in t && /^[A-Z]{3}$/.test(s[k])) t[k] = s[k];
        t.set = s.set === undefined ? true : !!s.set;
      }
      if (b.priceFactor !== undefined) f.priceFactor = b.priceFactor === null || b.priceFactor === "" ? null : num(b.priceFactor, "priceFactor", 10);
    }
    this.fees.updatedAt = new Date().toISOString();
    this.save();
    return this.fees;
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.fees, null, 2));
  }
}

export class FeeError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
