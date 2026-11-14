import type { ConversationTurn } from "./types.ts";

type Session = { updatedAt: number; turns: ConversationTurn[] };

export class MemorySessionStore {
  readonly #sessions = new Map<string, Session>();
  readonly #ttlMs: number;
  readonly #maxTurns: number;

  constructor(ttlMs: number, maxTurns: number) {
    this.#ttlMs = ttlMs;
    this.#maxTurns = maxTurns;
  }

  get(sessionId: string): ConversationTurn[] {
    this.prune();
    return [...(this.#sessions.get(sessionId)?.turns ?? [])];
  }

  append(sessionId: string, turn: ConversationTurn): void {
    const turns = [...(this.#sessions.get(sessionId)?.turns ?? []), turn].slice(-this.#maxTurns);
    this.#sessions.set(sessionId, { updatedAt: Date.now(), turns });
  }

  clear(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  private prune(): void {
    const cutoff = Date.now() - this.#ttlMs;
    for (const [id, session] of this.#sessions) if (session.updatedAt < cutoff) this.#sessions.delete(id);
  }
}
