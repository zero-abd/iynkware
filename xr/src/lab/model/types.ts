/**
 * The lab item model: one pure TypeScript object per kind of equipment, no three.js and no DOM. An item's whole state
 * is `ItemState`: `p`, the params a person or a host may set (the lab figures' params, same keys), and `s`, the item's
 * own clocks and continuous values (temperature, seconds of unlit gas, the swing's time).
 *
 *   const burner = MODELS['bunsen-burner'];
 *   let st = burner.init();
 *   const next = burner.apply(st, { type: 'gas' }, env);      // a new state, or { refused: true, reason }
 *   if (!isRefusal(next)) st = next;
 *   burner.step(st, 16, env);                                 // advances `s` in place; true when the report changed
 *   burner.mistake(st, env);                                  // 'gas-unlit' | null
 *   burner.report(st, env);                                   // the discrete state a tutor reads
 *
 * `apply` never mutates its input; `step` mutates `s` in place and allocates nothing, so the store can run it every
 * frame. `env` lets an item see the rest of the bench (the loop needs the burner's flame, the pH probe the beaker).
 */

export type LabId = 'chemistry' | 'physics' | 'electrical' | 'signals';
export const LAB_IDS: readonly LabId[] = ['chemistry', 'physics', 'electrical', 'signals'];

export type Prim = number | boolean | string;
export type Report = Readonly<Record<string, Prim | null>>;

export interface ItemState {
  /** Params: what a person sets. */
  p: Record<string, Prim>;
  /** The item's own continuous state. Mutated in place by `step`. */
  s: Record<string, Prim>;
}

export interface ParamSpec {
  /** The steps a knob or a picker goes through; the first is the default unless `defaults` says. */
  readonly values: readonly Prim[];
  /** Any number between is accepted from a host. */
  readonly range?: readonly [number, number];
  readonly unit?: string;
}

/** `type` is one of the model's `actions`, or `set` with `key` and `value` (a host patch of one param). */
export interface LabAction {
  readonly type: string;
  readonly key?: string;
  readonly value?: Prim;
}

export interface Refusal {
  readonly refused: true;
  /** An id in the catalogue's `REFUSALS` (`no-gas`, `bad-value`). */
  readonly reason: string;
}

export const isRefusal = (v: ItemState | Refusal): v is Refusal => (v as Refusal).refused === true;
export const refuse = (reason: string): Refusal => ({ refused: true, reason });

/** What an item may read of the rest of the bench: the first placed item of a kind. Allocates nothing. */
export interface LabEnv {
  stateOf(kind: string): ItemState | undefined;
}
export const NO_ENV: LabEnv = { stateOf: () => undefined };

export interface ItemModel {
  /** `bunsen-burner`: the lab figure's id, the asset's `lab/<kind>`. */
  readonly kind: string;
  readonly lab: LabId;
  /** `[w, d, h]` mm: the item's box at rest, centred on its origin on the bench. */
  readonly foot: readonly [number, number, number];
  readonly params: Readonly<Record<string, ParamSpec>>;
  readonly defaults: Readonly<Record<string, Prim>>;
  /** Named actions (`gas`, `light`); `set` is always accepted as well. */
  readonly actions: readonly string[];
  /** Every mistake id `mistake` can return, most specific first. */
  readonly mistakes: readonly string[];
  /** A fresh state. `seed` picks whatever the item hides (the unknown salt, the mystery signal). */
  init(params?: Readonly<Record<string, Prim>>, seed?: number): ItemState;
  apply(state: ItemState, action: LabAction, env: LabEnv): ItemState | Refusal;
  /** Advances the item's clock by `dtMs`, in place. Returns true when something a report carries changed. */
  step(state: ItemState, dtMs: number, env: LabEnv): boolean;
  /** Whether `step` has anything to do. */
  live(state: ItemState): boolean;
  /** The id of the mistake that holds now, or null. Pure. */
  mistake(state: ItemState, env: LabEnv): string | null;
  /** Discrete state for the tutor: every param, the item's derived readings. Rounded so it does not change every frame. */
  report(state: ItemState, env: LabEnv): Report;
}

/** What `defineItem` takes: the figure's definition, in the model's terms. */
export interface ItemDef {
  readonly kind: string;
  readonly lab: LabId;
  readonly foot: readonly [number, number, number];
  readonly params: Readonly<Record<string, ParamSpec>>;
  readonly defaults?: Readonly<Record<string, Prim>>;
  /** The item's own state at the start. */
  init?(p: Record<string, Prim>, seed: number): Record<string, Prim>;
  /** Named actions on a draft: change it through `set`, or return a refusal reason. */
  readonly actions: Readonly<Record<string, (draft: Draft, action: LabAction, env: LabEnv) => string | void>>;
  /** Runs after a param changed (through an action or a `set`). */
  onParam?(st: ItemState, key: string, value: Prim, old: Prim): void;
  /** A reason when a `set` would leave an impossible combination. */
  refuse?(next: Readonly<Record<string, Prim>>, key: string, value: Prim): string | null;
  /** Advances `s` in place; may change params through `set` (a swirl that ends). */
  step?(st: ItemState, dt: number, env: LabEnv, set: (key: string, value: Prim) => void): void;
  live?(st: ItemState): boolean;
  readonly mistakes: readonly string[];
  mistake?(st: ItemState, env: LabEnv): string | null;
  /** Derived readings added to the params in a report. */
  report?(st: ItemState, env: LabEnv): Record<string, Prim | null>;
  /**
   * A number that changes exactly when the derived report changes (the rounded readings folded together). `step`
   * compares it before and after, so the store hears about a change without building a report every frame.
   */
  stamp?(st: ItemState, env: LabEnv): number;
}

export interface Draft extends ItemState {
  set(key: string, value: Prim): void;
}

const valid = (spec: ParamSpec, v: Prim): boolean =>
  spec.values.includes(v) || (typeof v === 'number' && Number.isFinite(v) && spec.range !== undefined && v >= spec.range[0] && v <= spec.range[1]);

/** The next of a param's `values` after the current one, wrapping. */
export function cycle(spec: ParamSpec, current: Prim, by = 1): Prim {
  const n = spec.values.length;
  let i = spec.values.indexOf(current);
  if (i < 0 && typeof current === 'number') {
    // Between two steps (a host set it): start from the nearest step below.
    i = -1;
    spec.values.forEach((v, k) => {
      if (typeof v === 'number' && v <= current) i = k;
    });
  }
  return spec.values[(((i + by) % n) + n) % n]!;
}

/** The next of `values`, stopping at the ends (a knob with end stops). */
export function nudge(spec: ParamSpec, current: Prim, by: number): Prim {
  let i = spec.values.indexOf(current);
  if (i < 0 && typeof current === 'number') {
    i = 0;
    spec.values.forEach((v, k) => {
      if (typeof v === 'number' && v <= current) i = k;
    });
  }
  return spec.values[Math.max(0, Math.min(spec.values.length - 1, i + by))]!;
}

export function defineItem(def: ItemDef): ItemModel {
  const defaults: Record<string, Prim> = {};
  for (const [k, spec] of Object.entries(def.params)) defaults[k] = def.defaults?.[k] ?? spec.values[0]!;
  const stamp = (st: ItemState, env: LabEnv) => (def.stamp ? def.stamp(st, env) : 0);
  let stepping: ItemState | null = null;
  let stepChanged = false;
  const stepSet = (key: string, value: Prim) => {
    const st = stepping;
    if (!st || st.p[key] === value) return;
    const old = st.p[key]!;
    st.p[key] = value;
    def.onParam?.(st, key, value, old);
    stepChanged = true;
  };
  const model: ItemModel = {
    kind: def.kind,
    lab: def.lab,
    foot: def.foot,
    params: def.params,
    defaults,
    actions: Object.keys(def.actions),
    mistakes: def.mistakes,
    init(params, seed = 1) {
      const p = { ...defaults };
      for (const [k, v] of Object.entries(params ?? {})) if (def.params[k] && valid(def.params[k], v)) p[k] = v;
      return { p, s: def.init?.(p, seed) ?? {} };
    },
    apply(state, action, env) {
      const draft: Draft = {
        p: { ...state.p },
        s: { ...state.s },
        set(key, value) {
          const old = draft.p[key];
          if (old === value || old === undefined) return;
          draft.p[key] = value;
          def.onParam?.(draft, key, value, old);
        },
      };
      if (action.type === 'set') {
        const key = action.key ?? '';
        const spec = def.params[key];
        if (!spec || action.value === undefined) return refuse('unknown-param');
        if (!valid(spec, action.value)) return refuse('bad-value');
        const reason = def.refuse?.({ ...draft.p, [key]: action.value }, key, action.value);
        if (reason) return refuse(reason);
        draft.set(key, action.value);
      } else {
        const run = def.actions[action.type];
        if (!run) return refuse('unknown-action');
        const reason = run(draft, action, env);
        if (typeof reason === 'string') return refuse(reason);
      }
      return { p: draft.p, s: draft.s };
    },
    step(state, dtMs, env) {
      if (!def.step) return false;
      const before = stamp(state, env);
      stepping = state;
      stepChanged = false;
      def.step(state, dtMs / 1000, env, stepSet);
      stepping = null;
      return stepChanged || stamp(state, env) !== before;
    },
    live: (state) => def.live?.(state) ?? false,
    mistake: (state, env) => def.mistake?.(state, env) ?? null,
    report: (state, env) => ({ ...state.p, ...(def.report?.(state, env) ?? {}) }),
  };
  return model;
}

/** A small deterministic generator for what an item hides (mulberry32). */
export function seeded(seed: number): () => number {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One of `list`, picked by `seed`. */
export const pickSeeded = <T>(list: readonly T[], seed: number, salt = 0): T => list[Math.floor(seeded(seed * 7919 + salt)() * list.length) % list.length]!;
