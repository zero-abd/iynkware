/** The onboarding step machine: pure, no scene. The detectors feed it events; the panel draws it. */

export type StepId = 'grab' | 'wire' | 'run' | 'menu' | 'move' | 'recentre' | 'ready';
export type StepEvent = Exclude<StepId, 'ready'>;
export type InputKind = 'hands' | 'controllers';

export const STEPS: readonly StepId[] = ['grab', 'wire', 'run', 'menu', 'move', 'recentre', 'ready'];
/** Steps that count in "n of 6"; the last card is the farewell. */
export const COUNTED = STEPS.length - 1;

export const STORAGE_KEY = 'iynkware:xr:onboarding:v1';

export interface Machine {
  readonly index: number;
  readonly step: StepId;
  /** The event of this step happened; the panel shows a tick and then calls `next`. */
  readonly ticked: boolean;
  readonly ended: 'done' | 'skipped' | null;
  /** True when `event` completed the current step. */
  feed(event: StepEvent): boolean;
  next(): void;
  back(): void;
  skip(): void;
  done(): void;
  subscribe(fn: () => void): () => void;
}

export function createMachine(onEnd?: (how: 'done' | 'skipped') => void): Machine {
  let index = 0;
  let ticked = false;
  let ended: 'done' | 'skipped' | null = null;
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((f) => f());
  const finish = (how: 'done' | 'skipped') => {
    if (ended) return;
    ended = how;
    emit();
    onEnd?.(how);
  };
  return {
    get index() {
      return index;
    },
    get step() {
      return STEPS[index]!;
    },
    get ticked() {
      return ticked;
    },
    get ended() {
      return ended;
    },
    feed(event) {
      if (ended || ticked || STEPS[index] !== event) return false;
      ticked = true;
      emit();
      return true;
    },
    next() {
      if (ended || index >= STEPS.length - 1) return;
      index++;
      ticked = false;
      emit();
    },
    back() {
      if (ended || index === 0) return;
      index--;
      ticked = false;
      emit();
    },
    skip: () => finish('skipped'),
    done: () => finish('done'),
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** Which wording to show: controllers when any controller is tracked, hands otherwise. */
export function inputKind(sources: Readonly<Record<'left' | 'right', 'controller' | 'hand' | 'mouse' | 'gaze' | null>>): InputKind {
  return sources.left === 'controller' || sources.right === 'controller' ? 'controllers' : 'hands';
}

/** Storage: whether onboarding was finished or skipped before. Never throws. */
export function wasSeen(store?: Pick<Storage, 'getItem'>): boolean {
  try {
    return (store ?? localStorage).getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function markSeen(how: 'done' | 'skipped', store?: Pick<Storage, 'setItem'>): void {
  try {
    (store ?? localStorage).setItem(STORAGE_KEY, how);
  } catch {
    /* private mode: it will show again next time */
  }
}
