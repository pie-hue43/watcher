import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Hit, HitInput, Search, Tracked } from "./types.ts";

export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS searches (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      query      TEXT NOT NULL,
      max_price  REAL,
      size       TEXT,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hits (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vinted_id   TEXT NOT NULL UNIQUE,
      search_id   INTEGER REFERENCES searches(id) ON DELETE SET NULL,
      title       TEXT NOT NULL,
      price       REAL NOT NULL,
      currency    TEXT NOT NULL,
      size        TEXT,
      brand       TEXT,
      url         TEXT NOT NULL,
      photo_url   TEXT,
      detected_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS hits_detected_at ON hits(detected_at DESC);
    CREATE TABLE IF NOT EXISTS tracked (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      vinted_id  TEXT NOT NULL UNIQUE,
      url        TEXT NOT NULL,
      title      TEXT NOT NULL,
      price      REAL,
      currency   TEXT NOT NULL DEFAULT 'EUR',
      photo_url  TEXT,
      seller     TEXT,
      status     TEXT NOT NULL DEFAULT 'active',
      added_at   TEXT NOT NULL,
      checked_at TEXT,
      sold_at    TEXT
    );
  `);
  const searchCols = (db.prepare("PRAGMA table_info(searches)").all() as { name: string }[]).map((c) => c.name);
  if (!searchCols.includes("min_price")) db.exec("ALTER TABLE searches ADD COLUMN min_price REAL");
  if (!searchCols.includes("condition")) db.exec("ALTER TABLE searches ADD COLUMN condition TEXT");
  if (!searchCols.includes("kind")) db.exec("ALTER TABLE searches ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard'");
  // Ältere Datenbanken: Spalte für mehrere Bilder nachrüsten
  const cols = db.prepare("PRAGMA table_info(hits)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "photo_urls")) db.exec("ALTER TABLE hits ADD COLUMN photo_urls TEXT");
  if (!cols.some((c) => c.name === "opened_at")) db.exec("ALTER TABLE hits ADD COLUMN opened_at TEXT");
  for (const [col, type] of [["resale_estimate", "REAL"], ["resale_low", "REAL"], ["resale_high", "REAL"], ["resale_samples", "INTEGER"], ["archive_score", "INTEGER"], ["designer", "TEXT"]])
    if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE hits ADD COLUMN ${col} ${type}`);

  const toSearch = (r: any): Search => ({
    id: r.id,
    query: r.query,
    minPrice: r.min_price ?? null,
    maxPrice: r.max_price,
    condition: r.condition ?? null,
    size: r.size,
    kind: r.kind === "archive" ? "archive" : "standard",
    active: !!r.active,
    createdAt: r.created_at,
  });

  const toHit = (r: any): Hit => ({
    id: r.id,
    vintedId: r.vinted_id,
    searchId: r.search_id,
    searchQuery: r.search_query ?? null,
    searchKind: r.search_kind ?? null,
    title: r.title,
    price: r.price,
    currency: r.currency,
    size: r.size,
    brand: r.brand,
    url: r.url,
    photoUrls: r.photo_urls ? JSON.parse(r.photo_urls) : r.photo_url ? [r.photo_url] : [],
    detectedAt: r.detected_at,
    openedAt: r.opened_at ?? null,
    resaleEstimate: r.resale_estimate ?? null,
    resaleLow: r.resale_low ?? null,
    resaleHigh: r.resale_high ?? null,
    resaleSamples: r.resale_samples ?? null,
    archiveScore: r.archive_score ?? null,
    designer: r.designer ?? null,
  });

  const toTracked = (r: any): Tracked => ({
    id: r.id, vintedId: r.vinted_id, url: r.url, title: r.title, price: r.price, currency: r.currency,
    photoUrl: r.photo_url, seller: r.seller, status: r.status, addedAt: r.added_at, checkedAt: r.checked_at, soldAt: r.sold_at,
  });

  const hitSelect = `SELECT h.*, s.query AS search_query, s.kind AS search_kind FROM hits h LEFT JOIN searches s ON s.id = h.search_id`;

  return {
    listSearches(): Search[] {
      return db.prepare("SELECT * FROM searches ORDER BY id").all().map(toSearch);
    },
    getSearch(id: number): Search | null {
      const r = db.prepare("SELECT * FROM searches WHERE id = ?").get(id);
      return r ? toSearch(r) : null;
    },
    createSearch(f: Pick<Search, "query" | "minPrice" | "maxPrice" | "size" | "condition"> & { kind?: Search["kind"] }): Search {
      const res = db
        .prepare("INSERT INTO searches (query, min_price, max_price, size, condition, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(f.query, f.minPrice, f.maxPrice, f.size, f.condition, f.kind ?? "standard", new Date().toISOString());
      return this.getSearch(Number(res.lastInsertRowid))!;
    },
    updateSearch(id: number, patch: Partial<Pick<Search, "query" | "minPrice" | "maxPrice" | "size" | "condition" | "kind" | "active">>): Search | null {
      const cur = this.getSearch(id);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      db.prepare("UPDATE searches SET query = ?, min_price = ?, max_price = ?, size = ?, condition = ?, kind = ?, active = ? WHERE id = ?").run(
        next.query,
        next.minPrice,
        next.maxPrice,
        next.size,
        next.condition,
        next.kind,
        next.active ? 1 : 0,
        id,
      );
      return this.getSearch(id);
    },
    deleteSearch(id: number): boolean {
      return db.prepare("DELETE FROM searches WHERE id = ?").run(id).changes > 0;
    },
    /** Speichert einen Treffer. Gibt null zurück, wenn das Listing schon bekannt ist. */
    insertHit(h: HitInput): Hit | null {
      const res = db
        .prepare(
          `INSERT OR IGNORE INTO hits
             (vinted_id, search_id, title, price, currency, size, brand, url, photo_url, photo_urls, detected_at,
              resale_estimate, resale_low, resale_high, resale_samples, archive_score, designer)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          h.vintedId, h.searchId, h.title, h.price, h.currency, h.size, h.brand, h.url, h.photoUrls[0] ?? null,
          JSON.stringify(h.photoUrls.slice(0, 3)), new Date().toISOString(),
          h.resaleEstimate, h.resaleLow, h.resaleHigh, h.resaleSamples, h.archiveScore, h.designer,
        );
      if (res.changes === 0) return null;
      return toHit(db.prepare(`${hitSelect} WHERE h.id = ?`).get(Number(res.lastInsertRowid)));
    },
    /** Markiert einen Treffer als geöffnet (nur beim ersten Mal). */
    markOpened(id: number): Hit | null {
      db.prepare("UPDATE hits SET opened_at = COALESCE(opened_at, ?) WHERE id = ?").run(new Date().toISOString(), id);
      const r = db.prepare(`${hitSelect} WHERE h.id = ?`).get(id);
      return r ? toHit(r) : null;
    },
    listHits(limit = 50): Hit[] {
      return db.prepare(`${hitSelect} ORDER BY h.id DESC LIMIT ?`).all(limit).map(toHit);
    },
    /** Wardrobe Tracker: Artikel merken (doppelte werden ignoriert). */
    track(t: { vintedId: string; url: string; title: string; price: number | null; currency: string; photoUrl: string | null; seller: string | null }): Tracked | null {
      const res = db
        .prepare("INSERT OR IGNORE INTO tracked (vinted_id, url, title, price, currency, photo_url, seller, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(t.vintedId, t.url, t.title, t.price, t.currency, t.photoUrl, t.seller, new Date().toISOString());
      return res.changes ? toTracked(db.prepare("SELECT * FROM tracked WHERE id = ?").get(Number(res.lastInsertRowid))) : null;
    },
    listTracked(): Tracked[] {
      return db.prepare("SELECT * FROM tracked ORDER BY (status = 'active') ASC, COALESCE(sold_at, added_at) DESC").all().map(toTracked);
    },
    /** Die am längsten nicht geprüften aktiven Artikel */
    dueTracked(limit: number): Tracked[] {
      return db.prepare("SELECT * FROM tracked WHERE status = 'active' ORDER BY COALESCE(checked_at, '') ASC LIMIT ?").all(limit).map(toTracked);
    },
    setTrackedStatus(id: number, status: Tracked["status"]): Tracked | null {
      const now = new Date().toISOString();
      db.prepare("UPDATE tracked SET status = ?, checked_at = ?, sold_at = CASE WHEN ? = 'active' THEN sold_at ELSE COALESCE(sold_at, ?) END WHERE id = ?").run(status, now, status, now, id);
      const r = db.prepare("SELECT * FROM tracked WHERE id = ?").get(id);
      return r ? toTracked(r) : null;
    },
    untrack(id: number): boolean {
      return db.prepare("DELETE FROM tracked WHERE id = ?").run(id).changes > 0;
    },
    close() {
      db.close();
    },
  };
}

export type Db = ReturnType<typeof openDb>;
