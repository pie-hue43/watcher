import { baseAdapter, type Adapter } from "./catalog.ts";

/** Plattform ohne offizielle Schnittstelle: watchr baut nur den Such-Link, den der Nutzer selbst öffnet. */
export const linkAdapter = (id: string): Adapter => baseAdapter(id, "link");
