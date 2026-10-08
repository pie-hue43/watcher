# watchr

Vinted Watcher mit Backend und Echtzeit-Dashboard.

```
Vinted → Watcher → Backend/API → SQLite + WebSocket → Dashboard (Browser)
```

- **Watcher** (`src/watcher.ts`): fragt pro Suchauftrag die öffentliche Vinted-Katalogsuche ab (neueste zuerst), filtert nach Max-Preis und Größe und meldet neue Listings per `POST /api/hits` ans Backend. Beim ersten Durchlauf einer Suche merkt er sich nur den Bestand, gemeldet wird danach nur, was neu online kommt.
- **Backend** (`src/server.ts`): speichert Treffer in SQLite (doppelte Vinted-IDs werden ignoriert) und pusht jeden neuen Treffer sofort per WebSocket an alle offenen Dashboards.
- **Dashboard** (`public/`): zeigt Treffer live, verwaltet Suchaufträge, optional Browser-Benachrichtigungen.
- **Landingpage** (`public/landing.html`): stellt watchr als Produkt vor, erreichbar unter `/landing.html`. Funktioniert auch eigenständig auf deiner Website (die Buttons verlinken auf das Dashboard `./`).

## Starten

Voraussetzung: Node.js 22.13 oder neuer (nutzt das eingebaute `node:sqlite`).

```bash
npm install
cp .env.example .env      # WATCHER_TOKEN ändern!
npm start                 # Backend + Watcher, Dashboard auf http://localhost:3000
```

Ohne Vinted testen: `WATCHER_SOURCE=mock npm start` erzeugt Fake-Listings.
Backend und Watcher getrennt (z. B. auf zwei Servern): `npm run server` und `npm run watcher`, beide mit gleichem `WATCHER_TOKEN`, der Watcher mit `BACKEND_URL` auf das Backend.

Tests: `npm test` (spielt Watcher → Backend → DB → WebSocket einmal komplett durch).

## API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/searches` | Suchaufträge |
| POST | `/api/searches` | `{ "query": "Nike Dunk", "maxPrice": 80, "size": "43" }` |
| PATCH | `/api/searches/:id` | z. B. `{ "active": false }` zum Pausieren |
| DELETE | `/api/searches/:id` | löschen |
| GET | `/api/hits?limit=50` | letzte Treffer |
| POST | `/api/hits` | nur Watcher, Header `Authorization: Bearer <WATCHER_TOKEN>` |
| WS | `/ws` | Push: `hello` (Startzustand), `hit` (neuer Treffer), `searches` (Änderung) |

Ein Treffer sieht so aus:

```json
{ "id": 7, "vintedId": "4823…", "title": "Nike Dunk Low", "price": 65, "currency": "EUR",
  "size": "43", "brand": "Nike", "url": "https://www.vinted.de/items/…",
  "photoUrl": "https://…", "searchQuery": "Nike Dunk", "detectedAt": "2026-10-08T15:35:12.000Z" }
```

## In die eigene Website einbauen

**Variante A, Dashboard übernehmen:** `public/index.html`, `app.js`, `style.css` in deine Seite kopieren und vor `app.js` die Backend-Adresse setzen:

```html
<script>window.WATCHER_BACKEND = "https://watcher.deine-seite.de";</script>
```

**Variante B, nur den Live-Feed nutzen:**

```js
const ws = new WebSocket("wss://watcher.deine-seite.de/ws");
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "hit") {
    const h = msg.hit;
    console.log(`🔥 Neuer Treffer ${h.title} — ${h.price} € — Größe ${h.size}`, h.url);
  }
};
```

Läuft deine Website auf einer anderen Domain als das Backend, trag sie in `.env` ein: `ALLOWED_ORIGINS=https://deine-seite.de`.

**Wichtig:** Die Verwaltung der Suchaufträge hat noch keinen Login. Online also nur hinter Passwortschutz (z. B. Basic Auth im Reverse Proxy) betreiben.

## Hinweise zu Vinted

- Es gibt keine offizielle Vinted-API. Der Watcher nutzt dieselbe Suche wie die Website. Automatisiertes Abfragen ist laut Vinted-AGB nicht vorgesehen, also nur für den Eigengebrauch und sparsam nutzen.
- Höflich eingestellt: Intervall mindestens 30 s (Standard 60 s) mit Zufallsstreuung, Suchaufträge nacheinander mit Pause, bei HTTP 429/403 automatische Pause von 2 bis 30 Minuten.
- Ändert Vinted das Antwortformat, ist die Anpassung auf `toListing()` in `src/vinted.ts` beschränkt.
- Andere Länder: `VINTED_DOMAIN=www.vinted.at`, `www.vinted.fr` usw.
