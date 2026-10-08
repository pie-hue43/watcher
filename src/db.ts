import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Hit, HitInput, Search } from "./types.ts";

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
  `);

  const toSearch = (r: any): Search => ({
    id: r.id,
    query: r.query,
    maxPrice: r.max_price,
    size: r.size,
    active: !!r.active,
    createdAt: r.created_at,
  });

  const toHit = (r: any): Hit => ({
    id: r.id,
    vintedId: r.vinted_id,
    searchId: r.search_id,
    searchQuery: r.search_query ?? null,
    title: r.title,
    price: r.price,
    currency: r.currency,
    size: r.size,
    brand: r.brand,
    url: r.url,
    photoUrl: r.photo_url,
    detectedAt: r.detected_at,
  });

  const hitSelect = `SELECT h.*, s.query AS search_query FROM hits h LEFT JOIN searches s ON s.id = h.search_id`;

  return {
    listSearches(): Search[] {
      return db.prepare("SELECT * FROM searches ORDER BY id").all().map(toSearch);
    },
    getSearch(id: number): Search | null {
      const r = db.prepare("SELECT * FROM searches WHERE id = ?").get(id);
      return r ? toSearch(r) : null;
    },
    createSearch(query: string, maxPrice: number | null, size: string | null): Search {
      const res = db
        .prepare("INSERT INTO searches (query, max_price, size, created_at) VALUES (?, ?, ?, ?)")
        .run(query, maxPrice, size, new Date().toISOString());
      return this.getSearch(Number(res.lastInsertRowid))!;
    },
    updateSearch(id: number, patch: Partial<Pick<Search, "query" | "maxPrice" | "size" | "active">>): Search | null {
      const cur = this.getSearch(id);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      db.prepare("UPDATE searches SET query = ?, max_price = ?, size = ?, active = ? WHERE id = ?").run(
        next.query,
        next.maxPrice,
        next.size,
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
             (vinted_id, search_id, title, price, currency, size, brand, url, photo_url, detected_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(h.vintedId, h.searchId, h.title, h.price, h.currency, h.size, h.brand, h.url, h.photoUrl, new Date().toISOString());
      if (res.changes === 0) return null;
      return toHit(db.prepare(`${hitSelect} WHERE h.id = ?`).get(Number(res.lastInsertRowid)));
    },
    listHits(limit = 50): Hit[] {
      return db.prepare(`${hitSelect} ORDER BY h.id DESC LIMIT ?`).all(limit).map(toHit);
    },
    close() {
      db.close();
    },
  };
}

export type Db = ReturnType<typeof openDb>;
