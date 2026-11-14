export type Admission =
  | { ok: true; release(): void }
  | { ok: false; reason: "rate_limited" | "daily_limit_reached" | "too_many_concurrent_turns" };

export class RequestGate {
  readonly #acceptedAt: number[] = [];
  readonly #perMinute: number;
  readonly #perDay: number;
  readonly #concurrent: number;
  #active = 0;

  constructor(perMinute: number, perDay: number, concurrent: number) {
    this.#perMinute = perMinute;
    this.#perDay = perDay;
    this.#concurrent = concurrent;
  }

  admit(now = Date.now()): Admission {
    const dayCutoff = now - 86_400_000;
    while (this.#acceptedAt[0] !== undefined && this.#acceptedAt[0] <= dayCutoff) this.#acceptedAt.shift();
    if (this.#acceptedAt.length >= this.#perDay) return { ok: false, reason: "daily_limit_reached" };
    const minuteCutoff = now - 60_000;
    const firstRecent = this.#acceptedAt.findIndex((accepted) => accepted > minuteCutoff);
    const acceptedThisMinute = firstRecent === -1 ? 0 : this.#acceptedAt.length - firstRecent;
    if (acceptedThisMinute >= this.#perMinute) return { ok: false, reason: "rate_limited" };
    if (this.#active >= this.#concurrent) return { ok: false, reason: "too_many_concurrent_turns" };
    this.#acceptedAt.push(now);
    this.#active++;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.#active--;
      },
    };
  }
}
