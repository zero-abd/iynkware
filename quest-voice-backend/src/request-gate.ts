export type Admission =
  | { ok: true; release(): void }
  | { ok: false; reason: "rate_limited" | "too_many_concurrent_turns" };

export class RequestGate {
  readonly #acceptedAt: number[] = [];
  readonly #perMinute: number;
  readonly #concurrent: number;
  #active = 0;

  constructor(perMinute: number, concurrent: number) {
    this.#perMinute = perMinute;
    this.#concurrent = concurrent;
  }

  admit(now = Date.now()): Admission {
    const cutoff = now - 60_000;
    while (this.#acceptedAt[0] !== undefined && this.#acceptedAt[0] <= cutoff) this.#acceptedAt.shift();
    if (this.#acceptedAt.length >= this.#perMinute) return { ok: false, reason: "rate_limited" };
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
