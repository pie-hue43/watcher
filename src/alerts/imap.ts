import net from "node:net";
import tls from "node:tls";

/**
 * Sehr kleiner IMAP-Client (nur was die Alert inbox braucht): anmelden, Posteingang öffnen,
 * ungelesene Mails eines Absenders suchen, eine Mail lesen (ohne sie als gelesen zu markieren)
 * und sie danach als gelesen markieren. Keine weitere Bibliothek nötig.
 */
export interface ImapOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  timeoutMs?: number;
}

type Response = { lines: string[]; literals: Buffer[] };

export class Imap {
  private socket!: net.Socket;
  private buf = Buffer.alloc(0);
  private seq = 0;
  private pending: { tag: string; resolve: (r: Response) => void; reject: (e: Error) => void; res: Response } | null = null;
  private greeting: ((ok: boolean) => void) | null = null;
  private literalLeft = 0;
  private literalParts: Buffer[] = [];

  constructor(private o: ImapOptions) {}

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (e: Error) => reject(new Error(`Can't reach ${this.o.host}:${this.o.port} (${e.message})`));
      this.socket = this.o.secure
        ? tls.connect({ host: this.o.host, port: this.o.port, servername: this.o.host })
        : net.connect({ host: this.o.host, port: this.o.port });
      this.socket.setTimeout(this.o.timeoutMs ?? 20_000, () => this.socket.destroy(new Error("timeout")));
      this.socket.once("error", onError);
      this.greeting = (ok) => {
        this.socket.off("error", onError);
        this.socket.on("error", (e) => this.pending?.reject(e));
        ok ? resolve() : reject(new Error("The mail server refused the connection"));
      };
      this.socket.on("data", (d) => this.onData(d));
      this.socket.on("close", () => this.pending?.reject(new Error("Connection closed")));
    });
    const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    await this.command(`LOGIN ${quote(this.o.user)} ${quote(this.o.password)}`).catch(() => {
      throw new Error("Login failed. Check IMAP_USER and IMAP_PASSWORD (Gmail and GMX need an app password).");
    });
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.literalLeft > 0) {
        if (!this.buf.length) return;
        const take = this.buf.subarray(0, this.literalLeft);
        this.literalParts.push(take);
        this.literalLeft -= take.length;
        this.buf = this.buf.subarray(take.length);
        if (this.literalLeft === 0) this.pending?.res.literals.push(Buffer.concat(this.literalParts));
        continue;
      }
      const i = this.buf.indexOf("\r\n");
      if (i < 0) return;
      const line = this.buf.subarray(0, i).toString("utf8");
      this.buf = this.buf.subarray(i + 2);
      this.onLine(line);
      const lit = line.match(/\{(\d+)\}$/);
      if (lit) {
        this.literalLeft = Number(lit[1]);
        this.literalParts = [];
        if (this.literalLeft === 0) this.pending?.res.literals.push(Buffer.alloc(0));
      }
    }
  }

  private onLine(line: string) {
    if (this.greeting) {
      const g = this.greeting;
      this.greeting = null;
      return g(/^\* (OK|PREAUTH)/i.test(line));
    }
    const p = this.pending;
    if (!p) return;
    if (line.startsWith(p.tag + " ")) {
      this.pending = null;
      if (/^\S+ OK/i.test(line)) p.resolve(p.res);
      else p.reject(new Error(line.slice(p.tag.length + 1)));
    } else p.res.lines.push(line);
  }

  command(cmd: string): Promise<Response> {
    return new Promise((resolve, reject) => {
      const tag = `W${++this.seq}`;
      this.pending = { tag, resolve, reject, res: { lines: [], literals: [] } };
      this.socket.write(`${tag} ${cmd}\r\n`);
    });
  }

  async select(box = "INBOX") {
    await this.command(`SELECT "${box}"`);
  }

  /** UIDs ungelesener Mails, deren Absender den Text enthält (z. B. "kleinanzeigen.de") */
  async unseenFrom(sender: string): Promise<number[]> {
    const r = await this.command(`UID SEARCH UNSEEN FROM "${sender.replace(/"/g, "")}"`);
    return r.lines.filter((l) => /^\* SEARCH/i.test(l)).flatMap((l) => l.replace(/^\* SEARCH/i, "").trim().split(/\s+/).filter(Boolean).map(Number));
  }

  /** Ganze Mail lesen, ohne sie als gelesen zu markieren */
  async fetch(uid: number): Promise<Buffer | null> {
    const r = await this.command(`UID FETCH ${uid} (BODY.PEEK[])`);
    return r.literals[0] ?? null;
  }

  async markSeen(uid: number) {
    await this.command(`UID STORE ${uid} +FLAGS (\\Seen)`);
  }

  async logout() {
    await this.command("LOGOUT").catch(() => {});
    this.socket.end();
  }
}
