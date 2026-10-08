import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.ts";
import { openDb, type Db } from "./db.ts";
import { CONDITIONS, type Condition, type HitInput, type ServerMessage } from "./types.ts";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw new HttpError(413, "Request body too large");
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

function parseSearchBody(b: any, partial: boolean) {
  const out: {
    query?: string; minPrice?: number | null; maxPrice?: number | null;
    size?: string | null; condition?: Condition | null; active?: boolean;
  } = {};
  if (b.query !== undefined || !partial) {
    if (typeof b.query !== "string" || !b.query.trim()) throw new HttpError(400, "Add at least one keyword");
    out.query = b.query.trim().slice(0, 200);
  }
  const price = (v: any, name: string) => {
    if (v === null || v === "") return null;
    if (Number.isFinite(Number(v)) && Number(v) > 0) return Number(v);
    throw new HttpError(400, `${name} must be a positive number`);
  };
  if (b.minPrice !== undefined) out.minPrice = price(b.minPrice, "minPrice");
  if (b.maxPrice !== undefined) out.maxPrice = price(b.maxPrice, "maxPrice");
  if (out.minPrice != null && out.maxPrice != null && out.minPrice > out.maxPrice)
    throw new HttpError(400, "The minimum price is higher than the maximum price");
  if (b.condition !== undefined) {
    if (b.condition === null || b.condition === "") out.condition = null;
    else if ((CONDITIONS as readonly string[]).includes(b.condition)) out.condition = b.condition;
    else throw new HttpError(400, "Unknown condition");
  }
  if (b.size !== undefined) out.size = typeof b.size === "string" && b.size.trim() ? b.size.trim().slice(0, 40) : null;
  if (b.active !== undefined) out.active = !!b.active;
  return out;
}

function parseHit(b: any): HitInput {
  const str = (v: any) => (typeof v === "string" && v ? v : null);
  if (!b || (typeof b.vintedId !== "string" && typeof b.vintedId !== "number")) throw new HttpError(400, "vintedId fehlt");
  if (typeof b.title !== "string" || typeof b.url !== "string" || !Number.isFinite(Number(b.price)))
    throw new HttpError(400, "title, url und price sind Pflicht");
  return {
    vintedId: String(b.vintedId),
    searchId: Number(b.searchId),
    title: b.title.slice(0, 300),
    price: Number(b.price),
    currency: str(b.currency) ?? "EUR",
    size: str(b.size),
    brand: str(b.brand),
    url: b.url,
    photoUrls: (Array.isArray(b.photoUrls) ? b.photoUrls : [])
      .filter((u: unknown): u is string => typeof u === "string" && /^https?:\/\//.test(u))
      .slice(0, 3),
  };
}

export function createServer(db: Db, opts = { watcherToken: config.watcherToken, allowedOrigins: config.allowedOrigins }) {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });

  const broadcast = (msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(data);
  };
  const broadcastSearches = () => broadcast({ type: "searches", searches: db.listSearches() });

  const originAllowed = (origin: string | undefined, host: string | undefined) =>
    !origin || opts.allowedOrigins.includes("*") || opts.allowedOrigins.includes(origin) || origin === `http://${host}` || origin === `https://${host}`;

  server.on("request", async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const origin = req.headers.origin;
    if (origin && originAllowed(origin, req.headers.host)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    }
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };

    try {
      if (req.method === "OPTIONS") return void res.writeHead(204).end();

      if (url.pathname.startsWith("/api/")) {
        const path = url.pathname.slice(4);
        const idMatch = path.match(/^\/searches\/(\d+)$/);

        if (path === "/health" && req.method === "GET") return send(200, { ok: true });

        if (path === "/searches" && req.method === "GET") return send(200, db.listSearches());
        if (path === "/searches" && req.method === "POST") {
          const b = parseSearchBody(await readJson(req), false);
          const s = db.createSearch({
            query: b.query!, minPrice: b.minPrice ?? null, maxPrice: b.maxPrice ?? null,
            size: b.size ?? null, condition: b.condition ?? null,
          });
          broadcastSearches();
          return send(201, s);
        }
        if (idMatch && req.method === "PATCH") {
          const s = db.updateSearch(Number(idMatch[1]), parseSearchBody(await readJson(req), true));
          if (!s) throw new HttpError(404, "Preference not found");
          broadcastSearches();
          return send(200, s);
        }
        if (idMatch && req.method === "DELETE") {
          if (!db.deleteSearch(Number(idMatch[1]))) throw new HttpError(404, "Preference not found");
          broadcastSearches();
          return send(204);
        }

        if (path === "/hits" && req.method === "GET") {
          const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
          return send(200, db.listHits(limit));
        }
        const openMatch = path.match(/^\/hits\/(\d+)\/open$/);
        if (openMatch && req.method === "POST") {
          const hit = db.markOpened(Number(openMatch[1]));
          if (!hit) throw new HttpError(404, "Listing not found");
          return send(200, hit);
        }
        if (path === "/hits" && req.method === "POST") {
          // Nur der Watcher darf Treffer melden.
          if (req.headers.authorization !== `Bearer ${opts.watcherToken}`) throw new HttpError(401, "Not authorized");
          const hit = db.insertHit(parseHit(await readJson(req)));
          if (!hit) return send(200, { duplicate: true });
          broadcast({ type: "hit", hit });
          return send(201, hit);
        }
        throw new HttpError(404, "Not found");
      }

      // Dashboard (statische Dateien)
      if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
      // Alte Adresse der Landingpage weiterleiten
      if (url.pathname === "/landing.html") {
        res.writeHead(301, { Location: "/" });
        return void res.end();
      }
      const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
      const file = join(PUBLIC_DIR, rel);
      if (!file.startsWith(PUBLIC_DIR)) throw new HttpError(403, "Forbidden");
      // Saubere Adressen: /monitor liefert monitor.html
      const data = (await readFile(file).catch(() => null)) ?? (extname(file) ? null : await readFile(file + ".html").catch(() => null));
      if (!data) throw new HttpError(404, "Not found");
      res.writeHead(200, { "Content-Type": MIME[extname(file) || ".html"] ?? "application/octet-stream" });
      res.end(data);
    } catch (err) {
      if (err instanceof HttpError) return send(err.status, { error: err.message });
      console.error(err);
      send(500, { error: "Internal error" });
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/ws" || !originAllowed(req.headers.origin, req.headers.host)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
      const hello: ServerMessage = { type: "hello", hits: db.listHits(50), searches: db.listSearches() };
      ws.send(JSON.stringify(hello));
    });
  });

  // Tote Verbindungen regelmäßig aufräumen
  const alive = new WeakSet<WebSocket>();
  wss.on("connection", (ws) => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
  });
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) ws.terminate();
      else {
        alive.delete(ws);
        ws.ping();
      }
    }
  }, 30_000);

  return {
    server,
    close: async () => {
      clearInterval(ping);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export function startServer() {
  const db = openDb(config.dbPath);
  const app = createServer(db);
  app.server.listen(config.port, () => console.log(`[backend] Dashboard: http://localhost:${config.port}`));
  return app;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
