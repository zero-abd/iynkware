/**
 * What the bubbles draw, as plain state (no three.js, tested headless): the conversation in the speech bubble and the
 * callouts on items. The bridge and the tools write here; `bubbles/index.ts` draws it.
 */
import type { Unsubscribe } from '../../contracts/common';
import type { BoardTarget } from '../../contracts/space';

export type AgentState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'idle';
export const AGENT_STATES: readonly AgentState[] = ['connecting', 'listening', 'thinking', 'speaking', 'idle'];

export interface Turn {
  readonly who: 'user' | 'agent';
  readonly text: string;
  readonly final: boolean;
}

export interface Conversation {
  readonly turns: readonly Turn[];
  readonly state: AgentState;
  /** Reply chips under the last agent turn; cleared by the next user turn. */
  readonly suggestions: readonly string[];
  /** Increases on every change (the bubble redraws on it). */
  readonly version: number;
  /** Agent words: `text` is a delta appended to the open agent turn; `final` closes it. `replace` sets the whole turn. */
  say(text: string, opts?: { final?: boolean; replace?: boolean; suggestions?: readonly string[] }): void;
  /** The person's words (a transcript): deltas, as `say`. */
  user(text: string, opts?: { final?: boolean }): void;
  setState(s: AgentState): void;
  subscribe(fn: () => void): Unsubscribe;
}

/** Turns kept; the bubble shows the last two and the one being spoken. */
const KEEP = 6;

export function createConversation(): Conversation {
  const turns: Turn[] = [];
  let state: AgentState = 'idle';
  let suggestions: readonly string[] = [];
  let version = 0;
  const fns = new Set<() => void>();
  const changed = () => {
    version++;
    for (const fn of [...fns]) fn();
  };
  const write = (who: Turn['who'], text: string, final: boolean, replace: boolean) => {
    const last = turns[turns.length - 1];
    if (last && last.who === who && !last.final) turns[turns.length - 1] = { who, text: replace ? text : last.text + text, final };
    else if (text || !final) turns.push({ who, text, final });
    if (turns.length > KEEP) turns.splice(0, turns.length - KEEP);
  };
  return {
    get turns() {
      return turns;
    },
    get state() {
      return state;
    },
    get suggestions() {
      return suggestions;
    },
    get version() {
      return version;
    },
    say(text, opts = {}) {
      write('agent', text, opts.final ?? false, opts.replace ?? false);
      if (opts.suggestions) suggestions = opts.suggestions.slice(0, 3);
      changed();
    },
    user(text, opts = {}) {
      // A user turn closes any agent turn left open (the model was interrupted).
      const last = turns[turns.length - 1];
      if (last && last.who === 'agent' && !last.final) turns[turns.length - 1] = { ...last, final: true };
      write('user', text, opts.final ?? false, false);
      suggestions = [];
      changed();
    },
    setState(s) {
      if (s === state) return;
      state = s;
      changed();
    },
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
}

/** What a callout points from: a lab item, or a part, pin or anchor on the circuit bench. */
export type PointTarget =
  | { readonly kind: 'lab'; readonly id: string; readonly itemKind: string; readonly name: string }
  | { readonly kind: 'bench'; readonly target: BoardTarget; readonly name: string };

export type CalloutTone = 'info' | 'do' | 'warn';

export interface CalloutSpec {
  readonly id: string;
  readonly target: PointTarget;
  readonly text: string;
  readonly tone: CalloutTone;
  /** Removed at this time (the list's clock), or kept until replaced or cleared. */
  readonly until: number | null;
}

export interface CalloutList {
  readonly list: readonly CalloutSpec[];
  /** Adds a callout (one per target: a second on the same target replaces it); the oldest goes past `max`. */
  add(target: PointTarget, text: string, tone?: CalloutTone, ttlMs?: number): string;
  remove(id: string): void;
  clear(): void;
  /** Drops expired callouts (called every frame; allocates nothing when none expired). */
  prune(): void;
  subscribe(fn: () => void): Unsubscribe;
}

export const MAX_CALLOUTS = 3;
export const targetKey = (t: PointTarget): string =>
  t.kind === 'lab' ? `lab:${t.id}` : `bench:${t.target.kind}:${'part' in t.target ? t.target.part : ''}:${'pin' in t.target ? t.target.pin : ''}`;

export function createCalloutList(now: () => number, max = MAX_CALLOUTS): CalloutList {
  const list: CalloutSpec[] = [];
  const fns = new Set<() => void>();
  let serial = 0;
  const emit = () => {
    for (const fn of [...fns]) fn();
  };
  return {
    list,
    add(target, text, tone = 'info', ttlMs) {
      const key = targetKey(target);
      const same = list.findIndex((c) => targetKey(c.target) === key);
      if (same >= 0) list.splice(same, 1);
      const id = `callout_${++serial}`;
      list.push({ id, target, text, tone, until: ttlMs && ttlMs > 0 ? now() + ttlMs : null });
      while (list.length > max) list.shift();
      emit();
      return id;
    },
    remove(id) {
      const i = list.findIndex((c) => c.id === id);
      if (i < 0) return;
      list.splice(i, 1);
      emit();
    },
    clear() {
      if (list.length === 0) return;
      list.length = 0;
      emit();
    },
    prune() {
      const t = now();
      let gone = false;
      for (let i = list.length - 1; i >= 0; i--) {
        const u = list[i]!.until;
        if (u !== null && t >= u) {
          list.splice(i, 1);
          gone = true;
        }
      }
      if (gone) emit();
    },
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
}
