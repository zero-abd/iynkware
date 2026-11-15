/**
 * The lab store: the equipment on the bench and its state, observable. It is the lab's own document, kept apart from
 * the project (no part descriptor exists for lab items and none may be added there, so they cannot be project
 * components yet): opening a lab never touches the circuit, and leaving one restores the bench as it was.
 *
 *   const store = createLabStore();
 *   const id = store.place('bunsen-burner', { x: 0, z: 0, yaw: 0 });
 *   store.apply(id, { type: 'gas' });            // { ok: true } or { ok: false, reason: 'no-gas' }
 *   store.step(16);                              // every frame: advances live items, allocates nothing
 *   store.subscribe((c) => ...);                 // place, remove, clear, apply, refuse, move, tick, answer, lab
 *
 * Poses are millimetres in the bench table's frame (`BenchSpace.table`: origin at the bench top centre, +x to the
 * person's right, +z towards them), the item standing on the top, turned `yaw` degrees about up.
 */
import type { Unsubscribe } from '../../contracts/common';
import { MODELS, modelOf } from './registry';
import { isRefusal, type ItemState, type LabAction, type LabEnv, type LabId, type Prim, type Report } from './types';

export interface Pose {
  /** Millimetres, table frame. */
  x: number;
  z: number;
  /** Degrees about up. */
  yaw: number;
  /**
   * Millimetres, table frame: the height of the surface it stands on. Absent or 0 is the bench top; below it is the
   * floor or anything else in the room it was set down on.
   */
  y?: number;
}

export interface PlacedItem {
  readonly id: string;
  readonly kind: string;
  readonly pose: Readonly<Pose>;
  readonly state: Readonly<ItemState>;
  /** A stand-in for a kind with no model (the inventory's `generic`): its label is what was asked for. */
  readonly placeholder?: boolean;
  readonly label?: string;
}

export type LabChange =
  | { readonly type: 'place' | 'remove' | 'move'; readonly id: string; readonly at: number }
  | { readonly type: 'apply'; readonly id: string; readonly action: LabAction; readonly at: number }
  | { readonly type: 'refuse'; readonly id: string; readonly action: LabAction; readonly reason: string; readonly at: number }
  | { readonly type: 'tick'; readonly at: number }
  | { readonly type: 'answer'; readonly key: string; readonly value: Prim; readonly at: number }
  | { readonly type: 'clear' | 'lab'; readonly at: number };

export type ApplyOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface LabStore extends LabEnv {
  /** The lab laid out now, or null (the circuit bench). */
  readonly lab: LabId | null;
  setLab(lab: LabId | null): void;
  /** Milliseconds of lab clock (advanced by `step`). */
  readonly now: number;
  items(): readonly PlacedItem[];
  get(id: string): PlacedItem | undefined;
  /** The first placed item of a kind. */
  byKind(kind: string): PlacedItem | undefined;
  place(kind: string, pose: Pose, opts?: { params?: Readonly<Record<string, Prim>>; seed?: number; id?: string; label?: string; placeholder?: boolean }): string;
  remove(id: string): void;
  /** Removes every item and every answer. */
  clear(): void;
  move(id: string, pose: Pose): void;
  apply(id: string, action: LabAction): ApplyOutcome;
  /** Advances live items by `dtMs`; one `tick` change when a report changed. */
  step(dtMs: number): void;
  report(id: string): Report | null;
  mistake(id: string): string | null;
  /** A person's answer to an experiment's question (`salt`, `ohms`). */
  answer(key: string, value: Prim): void;
  readonly answers: Readonly<Record<string, Prim>>;
  /** Undoes the last `apply` (not clock steps). False when there is nothing to undo. */
  undo(): boolean;
  subscribe(fn: (change: LabChange) => void): Unsubscribe;
}

interface Slot {
  id: string;
  kind: string;
  pose: Pose;
  state: ItemState;
  placeholder?: boolean;
  label?: string;
}

const UNDO_DEPTH = 50;

export function createLabStore(): LabStore {
  const slots: Slot[] = [];
  let lab: LabId | null = null;
  let now = 0;
  let serial = 0;
  let answers: Record<string, Prim> = {};
  const undo: Array<{ id: string; state: ItemState }> = [];
  const fns = new Set<(c: LabChange) => void>();
  const emit = (c: LabChange) => {
    for (const fn of [...fns]) fn(c);
  };
  // The tick change is one object, reused, so stepping allocates nothing.
  const tick: { type: 'tick'; at: number } = { type: 'tick', at: 0 };
  // Plain loops, no closures: the items' frame loop reads `get` every frame.
  const find = (id: string): Slot | undefined => {
    for (let i = 0; i < slots.length; i++) if (slots[i]!.id === id) return slots[i];
    return undefined;
  };

  const store: LabStore = {
    get lab() {
      return lab;
    },
    setLab(next) {
      if (next === lab) return;
      lab = next;
      emit({ type: 'lab', at: now });
    },
    get now() {
      return now;
    },
    stateOf(kind) {
      for (let i = 0; i < slots.length; i++) if (slots[i]!.kind === kind) return slots[i]!.state;
      return undefined;
    },
    items: () => slots,
    get: (id) => find(id),
    byKind(kind) {
      for (let i = 0; i < slots.length; i++) if (slots[i]!.kind === kind) return slots[i];
      return undefined;
    },
    place(kind, pose, opts = {}) {
      const model = modelOf(kind);
      const id = opts.id ?? `lab_${kind}_${++serial}`;
      if (find(id)) throw new Error(`[lab] ${id} is already placed`);
      slots.push({ id, kind: model.kind, pose: { ...pose }, state: model.init(opts.params, opts.seed ?? 1), placeholder: opts.placeholder, label: opts.label });
      emit({ type: 'place', id, at: now });
      return id;
    },
    remove(id) {
      const i = slots.findIndex((s) => s.id === id);
      if (i < 0) return;
      slots.splice(i, 1);
      emit({ type: 'remove', id, at: now });
    },
    clear() {
      slots.length = 0;
      undo.length = 0;
      answers = {};
      emit({ type: 'clear', at: now });
    },
    move(id, pose) {
      const s = find(id);
      if (!s) return;
      s.pose = { ...pose };
      emit({ type: 'move', id, at: now });
    },
    apply(id, action) {
      const s = find(id);
      if (!s) return { ok: false, reason: 'no-item' };
      const next = MODELS[s.kind]!.apply(s.state, action, store);
      if (isRefusal(next)) {
        emit({ type: 'refuse', id, action, reason: next.reason, at: now });
        return { ok: false, reason: next.reason };
      }
      undo.push({ id, state: s.state });
      if (undo.length > UNDO_DEPTH) undo.shift();
      s.state = next;
      emit({ type: 'apply', id, action, at: now });
      return { ok: true };
    },
    step(dtMs) {
      now += dtMs;
      let changed = false;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i]!;
        const model = MODELS[s.kind]!;
        if (model.live(s.state) && model.step(s.state, dtMs, store)) changed = true;
      }
      if (changed) {
        tick.at = now;
        emit(tick);
      }
    },
    report(id) {
      const s = find(id);
      return s ? MODELS[s.kind]!.report(s.state, store) : null;
    },
    mistake(id) {
      const s = find(id);
      return s ? MODELS[s.kind]!.mistake(s.state, store) : null;
    },
    answer(key, value) {
      answers = { ...answers, [key]: value };
      emit({ type: 'answer', key, value, at: now });
    },
    get answers() {
      return answers;
    },
    undo() {
      const last = undo.pop();
      if (!last) return false;
      const s = find(last.id);
      if (!s) return false;
      s.state = last.state;
      emit({ type: 'apply', id: last.id, action: { type: 'undo' }, at: now });
      return true;
    },
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
  return store;
}
