/**
 * The co-builder's authored channel (contracts/assistant.ts `AuthoredChannel`): its ops, its undo. When the project
 * store offers `as(author)` (#106) this hands that out, so the co-builder's ops carry its actor id and model in the
 * history and sit on their own undo stack. Until then it adapts the plain store, which authors every op as the local
 * person: each entry's label names the co-builder, and undo reverts with `store.undo()` when the co-builder's entry is
 * on top, else by applying the inverse it kept. In that fallback the two share one stack, so the person's own Undo can
 * take back a co-builder step; `onTaken` says when it did.
 */
import type { AuthoredChannel, CoAuthor } from '../contracts/assistant';
import type { Unsubscribe } from '../contracts/common';
import type { ApplyResult, Op, ProjectStore } from '../contracts/project';

export interface ActorChannel extends AuthoredChannel {
  /** True when the store authors as the person (no `as` yet): attribution is in the labels only. */
  readonly emulated: boolean;
  /** The co-builder's last entry was undone by someone else (the person's Undo, in the fallback). */
  onTaken(fn: () => void): Unsubscribe;
  dispose(): void;
}

type StoreWithActors = ProjectStore & { as?: (author: CoAuthor) => AuthoredChannel };

export function createActorChannel(store: ProjectStore, author: CoAuthor, name: string): ActorChannel {
  const real = (store as StoreWithActors).as?.(author);
  if (real) {
    return { ...real, author, apply: real.apply.bind(real), undo: real.undo.bind(real), canUndo: real.canUndo.bind(real), emulated: false, onTaken: () => () => undefined, dispose: () => undefined };
  }

  const entries: Array<{ revision: number; inverse: Op[]; label: string }> = [];
  const taken = new Set<() => void>();
  let mine = false;
  const off = store.subscribe((change) => {
    if (mine) return;
    if (change.origin === 'load') entries.length = 0;
    else if (change.origin === 'undo' && entries.at(-1)?.revision === change.from) {
      entries.pop();
      for (const fn of [...taken]) fn();
    }
  });
  const run = (fn: () => ApplyResult | null) => {
    mine = true;
    try {
      return fn();
    } finally {
      mine = false;
    }
  };

  return {
    author,
    emulated: true,
    apply(ops, opts) {
      const label = `${name}: ${opts?.label ?? ''}`.trim();
      const res = run(() => store.apply(ops, { label }))!;
      if (res.ok) entries.push({ revision: res.revision, inverse: res.inverse, label });
      return res;
    },
    undo() {
      const top = entries.at(-1);
      if (!top) return null;
      const res = run(() => (store.revision === top.revision && store.canUndo() ? store.undo() : store.apply(top.inverse, { label: top.label })));
      if (res?.ok) entries.pop();
      return res;
    },
    canUndo: () => entries.length > 0,
    onTaken(fn) {
      taken.add(fn);
      return () => taken.delete(fn);
    },
    dispose: off,
  };
}
