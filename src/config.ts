// Lädt .env (falls vorhanden) und stellt die Konfiguration bereit.
try {
  process.loadEnvFile();
} catch {
  // keine .env-Datei, dann gelten Umgebungsvariablen und Defaults
}

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  watcherToken: env.WATCHER_TOKEN ?? "bitte-aendern",
  backendUrl: (env.BACKEND_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/$/, ""),
  vintedDomain: env.VINTED_DOMAIN ?? "www.vinted.de",
  pollIntervalSec: Math.max(30, Number(env.POLL_INTERVAL_SEC ?? 60)),
  source: (env.WATCHER_SOURCE ?? "vinted") as "vinted" | "mock",
  allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  dbPath: env.DB_PATH ?? "./data/watcher.db",
};
