import Anthropic from "@anthropic-ai/sdk";

/**
 * KI-Anbindung für die AI Tools (Claude über die offizielle Anthropic-SDK).
 * Aktiv, sobald ANTHROPIC_API_KEY gesetzt ist. Ohne Schlüssel laufen die Tools
 * mit einfachen Regeln weiter und sagen das auf der Seite dazu.
 */
export class Ai {
  private client = new Anthropic();
  readonly model = "claude-opus-5-5";

  /** Eine Anfrage mit fest vorgegebenem JSON-Format. Gibt null zurück, wenn Claude ablehnt. */
  async json<T>(system: string, content: Anthropic.Beta.Messages.BetaContentBlockParam[] | string, schema: Record<string, unknown>): Promise<T | null> {
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content }],
    });
    if (res.stop_reason === "refusal") return null;
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
}

export const makeAi = () => (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new Ai() : null);
