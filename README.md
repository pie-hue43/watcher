# watchr

Vinted Watcher mit Backend und Echtzeit-Dashboard.

```
Vinted → Watcher → Backend/API → SQLite + WebSocket → Dashboard (Browser)
```

- **Watcher** (`src/watcher.ts`): holt pro neuem Treffer bis zu drei Bilder (falls vorhanden), fragt pro Suchauftrag die öffentliche Vinted-Katalogsuche ab (neueste zuerst), filtert nach Max-Preis und Größe und meldet neue Listings per `POST /api/hits` ans Backend. Beim ersten Durchlauf einer Suche merkt er sich nur den Bestand, gemeldet wird danach nur, was neu online kommt.
- **Backend** (`src/server.ts`): speichert Treffer in SQLite (doppelte Vinted-IDs werden ignoriert) und pusht jeden neuen Treffer sofort per WebSocket an alle offenen Dashboards.
- **Website** (`public/`, Englisch, Hellgrün):
  - `/` Startseite mit Live-Listings-Monitor-Vorschau, Snipe-Kategorien, Produktübersicht, How it works, FAQ
  - `/monitor` **Live Listings Monitor**: Treffer in Echtzeit, Individual Preferences (Hashtags), Tageszahlen
  - `/missed-flips` Liste aller gefundenen Listings, nicht geöffnete gelten als verpasst
  - `/features`, `/faq` Unterseiten

## Starten

Voraussetzung: Node.js 22.13 oder neuer (nutzt das eingebaute `node:sqlite`).

```bash
npm install
cp .env.example .env      # WATCHER_TOKEN ändern!
npm start                 # Backend + Watcher, Website auf http://localhost:3000, Live Monitor unter /monitor
```

Ohne Vinted testen: `WATCHER_SOURCE=mock npm start` erzeugt Fake-Listings.
Backend und Watcher getrennt (z. B. auf zwei Servern): `npm run server` und `npm run watcher`, beide mit gleichem `WATCHER_TOKEN`, der Watcher mit `BACKEND_URL` auf das Backend.

Tests: `npm test` (spielt Watcher → Backend → DB → WebSocket einmal komplett durch).

## Individual Preferences (Hashtags)

Im Dashboard und im Live Listings Monitor der Landingpage gibt man Wünsche als Hashtags ein, z. B. `#nike #dunk #size43 #min20 #max80 #verygood`:

- normale Wörter werden Suchbegriffe (`#nike #dunk`)
- `#size43`, `#sizeM` setzt die Größe
- `#min20` / `#over20` und `#max80` / `#under80` setzen die Preisspanne
- `#newtags`, `#new`, `#verygood`, `#good` setzen den Mindestzustand

Die Landingpage übergibt die Hashtags per `/?tags=…` an das Dashboard. Die Oberfläche ist auf Englisch.

## API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/searches` | Suchaufträge |
| POST | `/api/searches` | `{ "query": "Nike Dunk", "minPrice": 30, "maxPrice": 80, "size": "43", "condition": "very_good" }` (condition: `new_tags`, `new`, `very_good`, `good` oder leer) |
| PATCH | `/api/searches/:id` | z. B. `{ "active": false }` zum Pausieren |
| DELETE | `/api/searches/:id` | löschen |
| GET | `/api/hits?limit=50` | letzte Treffer (mit `openedAt`) |
| POST | `/api/hits/:id/open` | Treffer als geöffnet markieren (für Missed Flips) |
| POST | `/api/hits` | nur Watcher, Header `Authorization: Bearer <WATCHER_TOKEN>` |
| WS | `/ws` | Push: `hello` (Startzustand), `hit` (neuer Treffer), `searches` (Änderung) |

Ein Treffer sieht so aus:

```json
{ "id": 7, "vintedId": "4823…", "title": "Nike Dunk Low", "price": 65, "currency": "EUR",
  "size": "43", "brand": "Nike", "url": "https://www.vinted.de/items/…",
  "photoUrls": ["https://…", "https://…", "https://…"], "searchQuery": "Nike Dunk", "detectedAt": "2026-10-08T15:35:12.000Z" }
```

## In die eigene Website einbauen

**Variante A, Live Monitor übernehmen:** `public/monitor.html`, `app.js`, `tags.js`, `site.css` in deine Seite kopieren und vor `app.js` die Backend-Adresse setzen:

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
    console.log(h.title, h.price, h.size, h.url, h.photoUrls);
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
