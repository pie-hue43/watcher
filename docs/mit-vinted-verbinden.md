# watchr mit dem echten Vinted verbinden und testen

Der Bot spricht schon mit der echten Vinted-Suche (`WATCHER_SOURCE=vinted` ist die Voreinstellung). Er konnte nur noch nie getestet werden, weil Vinted aus meiner Cloud-Umgebung gesperrt ist. Getestet wird deshalb am besten auf deinem eigenen Computer mit deinem normalen Internetanschluss. Vinted blockt Rechenzentren viel eher als private Anschlüsse.

## 1. Einmalig einrichten (ca. 10 Minuten)

1. **Node.js installieren:** Version 22 oder neuer von https://nodejs.org (die „LTS“-Version).
2. **Projekt herunterladen:** Im Terminal (Mac: „Terminal“, Windows: „PowerShell“):
   ```
   git clone https://github.com/pie-hue43/watcher.git
   cd watcher
   npm install
   ```
   Ohne git: auf GitHub „Code → Download ZIP“, entpacken, im Terminal in den Ordner wechseln und `npm install` ausführen.
3. **Einstellungen anlegen:** Die Datei `.env.example` kopieren und die Kopie `.env` nennen. Darin nur eine Zeile ändern:
   ```
   WATCHER_TOKEN=irgendein-langes-passwort-123
   ```
   Alles andere kann so bleiben (`VINTED_DOMAIN=www.vinted.de`, alle 60 Sekunden prüfen).

## 2. Starten

```
npm start
```

Dann im Browser http://localhost:3000 öffnen. Das ist die watchr-Website mit echten Daten.

## 3. Testen, ob Vinted antwortet

1. Auf **Live Sniper** eine breite Präferenz anlegen, damit schnell etwas kommt, z. B. `#ralph #lauren #polo`.
2. Im Terminal sollte nach spätestens einer Minute stehen:
   `[watcher] "ralph lauren polo": 30 bestehende Listings gemerkt, ab jetzt wird nur Neues gemeldet`
   **Damit ist die Verbindung zu Vinted bestätigt.** Bestehende Angebote werden bewusst nicht gemeldet, nur neue.
3. Nach ein paar Minuten erscheinen neue Polos in Live Sniper, im Terminal als `🔥 Neuer Treffer: … — Resell ~30 (+12)`.
4. Danach `#archive` (optional mit `#max300`) anlegen und schauen, ob Archivteile mit Score und Resellpreis kommen.
5. Einen Treffer anklicken und prüfen, ob er unter **Flips** als „Opened“ steht.

## Wenn etwas nicht klappt

| Meldung im Terminal | Bedeutung | Was tun |
| --- | --- | --- |
| `Kein Session-Cookie von www.vinted.de erhalten` | Vinted hat die Startseite nicht normal ausgeliefert | VPN ausschalten, später nochmal versuchen |
| `Vinted bremst (HTTP 429)` oder `(HTTP 403)` | Zu viele Anfragen oder Blockade | Der Bot pausiert automatisch 2 bis 30 Minuten. Weniger Präferenzen gleichzeitig nutzen |
| `Session abgelaufen (401)` | Cookie abgelaufen | Nichts, der Bot holt beim nächsten Durchlauf ein neues |
| `Vinted antwortet mit HTTP …` | Vinted hat die Schnittstelle geändert | Mir die Terminal-Ausgabe schicken |
| Keine Bilder oder kein Resellpreis | Detail- bzw. Vergleichsabfrage kam nicht durch | Mir die Ausgabe schicken, ich passe es an |

Am meisten hilft mir: die letzten 30 Zeilen aus dem Terminal kopieren und hier in den Chat schicken.

## 4. Danach: online auf deiner Website

Wenn der Test auf deinem Computer klappt, gibt es zwei Wege:

- **Einfach:** watchr läuft auf einem Rechner bei dir zu Hause (z. B. ein alter Laptop oder ein Raspberry Pi), der immer an ist.
- **Server:** ein kleiner Server (z. B. Hetzner, ca. 4 € im Monat). Dort wie oben installieren und mit einer Domain verbinden. Achtung: Vinted blockt Server-Adressen häufiger. Erst testen, dann bezahlen.

Liegt deine Website woanders als der Bot, trägst du ihre Adresse in `.env` bei `ALLOWED_ORIGINS` ein und auf der Website `window.WATCHER_BACKEND = "https://adresse-deines-bots"`.

## Wichtig

- Vinted erlaubt in seinen Nutzungsbedingungen kein automatisiertes Abfragen. Nutze watchr für deine eigenen Käufe, mit wenigen Präferenzen und nicht unter 60 Sekunden Abstand.
- Vinted kann seine Schnittstelle jederzeit ändern. Dann muss der Bot angepasst werden.
