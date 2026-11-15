/**
 * Coach observations: compact English lines about what the person is doing, for a model to speak up unasked. Pushed
 * from the lab tutor, the project, the simulation and findings (coach/index.ts); coalesced so at most one goes out
 * per `gapMs` (several in that window merge into one), kept in a ring of `size`. A hazard goes out at once, alone. Pose
 * and dwell lines (coach/pose.ts) come through the same push, already rate limited at their source.
 */
import type { Unsubscribe } from '../../contracts/common';
import type { L6 } from '../../lab/text';

export type ObservationKind =
  | 'lab-step'
  | 'lab-mistake'
  | 'lab-action'
  | 'hazard'
  | 'project'
  | 'sim'
  | 'finding'
  | 'lesson'
  /** What the person looks at and has in or near each hand (coach/pose.ts). */
  | 'pose'
  /** On one thing with no action for a while: stuck or hesitating (coach/pose.ts). */
  | 'dwell'
  | 'mixed';

export interface Observation {
  /** Milliseconds (the coach's clock). */
  readonly at: number;
  readonly kind: ObservationKind;
  /** English, compact, for the model. */
  readonly text: string;
  /** What it is about: `lab:<item id>`, `part:<entity id>`, `pin:<entity>.<pin>`. */
  readonly refs: readonly string[];
  /** The same in the person's language when the app has it (the tutor's words), for local display. */
  readonly say?: L6;
}

export interface Coach {
  push(o: Omit<Observation, 'at'>): void;
  /** Sends what is pending once its window has passed (called every frame or on a timer). */
  tick(): void;
  /** The last `n` sent, oldest first. */
  recent(n?: number): readonly Observation[];
  subscribe(fn: (o: Observation) => void): Unsubscribe;
}

export const GAP_MS = 1500;
export const RING = 20;
const MAX_TEXT = 320;

export function createCoach(now: () => number, opts: { gapMs?: number; size?: number } = {}): Coach {
  const gap = opts.gapMs ?? GAP_MS;
  const size = opts.size ?? RING;
  const ring: Observation[] = [];
  const fns = new Set<(o: Observation) => void>();
  let pending: Omit<Observation, 'at'>[] = [];
  let last = -Infinity;

  const send = (o: Observation) => {
    ring.push(o);
    if (ring.length > size) ring.shift();
    for (const fn of [...fns]) fn(o);
  };
  const flush = () => {
    if (pending.length === 0) return;
    const items = pending;
    pending = [];
    last = now();
    if (items.length === 1) return send({ ...items[0]!, at: last });
    const texts = [...new Set(items.map((i) => i.text))];
    const kinds = new Set(items.map((i) => i.kind));
    send({
      at: last,
      kind: kinds.size === 1 ? items[0]!.kind : 'mixed',
      text: texts.join('; ').slice(0, MAX_TEXT),
      refs: [...new Set(items.flatMap((i) => i.refs))],
      say: items[items.length - 1]!.say,
    });
  };

  return {
    push(o) {
      if (o.kind === 'hazard') return send({ ...o, at: now() });
      if (pending.some((p) => p.text === o.text)) return;
      pending.push(o);
      if (now() - last >= gap) flush();
    },
    tick() {
      if (pending.length && now() - last >= gap) flush();
    },
    recent: (n = size) => ring.slice(-n),
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
}
