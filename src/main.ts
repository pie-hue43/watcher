// Startet Backend und Watcher zusammen. Der Watcher spricht trotzdem per HTTP mit dem Backend,
// sodass beide auch getrennt laufen können (npm run server / npm run watcher).
import { config } from "./config.ts";
import { startServer } from "./server.ts";
import { startWatcher } from "./watcher.ts";

if (config.watcherToken === "bitte-aendern") {
  console.warn("[hinweis] WATCHER_TOKEN ist noch der Standardwert. Bitte in .env ändern, bevor du das online stellst.");
}
const app = startServer();
app.server.once("listening", () => startWatcher());
