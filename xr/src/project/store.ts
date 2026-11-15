/** In-memory project store over iynk's `ProjectSession` (imported unchanged). Contract: contracts/project.ts. */
import { builtinRegistry } from '@/parts/builtin';
import type { PartRegistry } from '@/parts/registry';
import { createSession } from '@/project/session';
import { computeTouched } from '@/project/touched';
import { validateValue } from '@/project/validate';
import { loadTemplate } from '@content/projects';
import type { AuthoredChannel, CoAuthor } from '../contracts/assistant';
import type { Unsubscribe } from '../contracts/common';
import type { DocChange, Descriptor, Op, Project, ProjectStore, Selection, TemplateSource } from '../contracts/project';

const clock = () => Date.now();
/** iynk's session keeps at most this many undo (and redo) entries per actor; the label stacks keep the same. */
const MAX_UNDO = 100;
const rnd = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };

function createSelection(): Selection {
  let ids: readonly string[] = [];
  const fns = new Set<(ids: readonly string[]) => void>();
  const set = (next: readonly string[]) => {
    ids = [...new Set(next)];
    for (const fn of [...fns]) fn(ids);
  };
  return {
    get ids() {
      return ids;
    },
    set,
    toggle: (id) => set(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]),
    clear: () => set([]),
    subscribe(fn): Unsubscribe {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
}

export function createProjectStore(doc: Project, parts: PartRegistry = builtinRegistry()): ProjectStore {
  let session = createSession({ state: doc, clock, rnd });
  const fns = new Set<(c: DocChange) => void>();
  let unhook = session.subscribe((c) => emit(c));
  const emit = (c: DocChange) => {
    for (const fn of [...fns]) fn(c);
  };
  const author = () => ({ actor: session.state.access.owners[0] ?? 'local', kind: 'user' as const });
  const selection = createSelection();
  // The person's undo and redo labels, kept in step with the session's stacks for the local actor: the session only
  // exposes the top of the latest actor's undo stack, and nothing of redo.
  let undoLabels: Array<string | null> = [];
  let redoLabels: Array<string | null> = [];
  const push = (stack: Array<string | null>, label: string | null) => {
    stack.push(label);
    if (stack.length > MAX_UNDO) stack.shift();
  };

  return {
    get doc() {
      return session.state;
    },
    get revision() {
      return session.revision;
    },
    apply(ops: Op | readonly Op[], opts) {
      const result = session.apply(ops, author(), opts?.label ? { label: opts.label } : undefined);
      if (result.ok) {
        push(undoLabels, opts?.label || null);
        redoLabels = [];
      }
      return result;
    },
    // The session takes the entry off its stack whether or not reverting it applies, and moves it over only when it does.
    undo() {
      const result = session.undo(author().actor);
      if (result) {
        const label = undoLabels.pop() ?? null;
        if (result.ok) push(redoLabels, label);
      }
      return result;
    },
    redo() {
      const result = session.redo(author().actor);
      if (result) {
        const label = redoLabels.pop() ?? null;
        if (result.ok) push(undoLabels, label);
      }
      return result;
    },
    canUndo: () => session.canUndo(author().actor),
    canRedo: () => session.canRedo(author().actor),
    undoLabel: () => (session.canUndo(author().actor) ? (undoLabels.at(-1) ?? null) : null),
    redoLabel: () => (session.canRedo(author().actor) ? (redoLabels.at(-1) ?? null) : null),
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    open(next: Project) {
      const prev = session.state;
      unhook();
      session = createSession({ state: next, clock, rnd });
      unhook = session.subscribe((c) => emit(c));
      undoLabels = [];
      redoLabels = [];
      selection.clear();
      emit({ from: prev.revision, to: next.revision, ops: [], touched: computeTouched(prev, next), origin: 'load' });
    },
    describe(ref: string, version?: string): Descriptor | undefined {
      return version ? parts.get(ref, version) : parts.latest(ref);
    },
    selection,
    // Reads `session` at call time: `open` replaces it.
    as: (a: CoAuthor): AuthoredChannel => ({
      author: a,
      apply: (ops, opts) =>
        session.apply(
          ops,
          { actor: a.actor, kind: 'ai', ...(a.model ? { model: a.model } : {}), ...(opts?.proposal ? { proposal: opts.proposal } : {}) },
          opts?.label ? { label: opts.label } : undefined,
        ),
      undo: () => session.undo(a.actor),
      canUndo: () => session.canUndo(a.actor),
    }),
  };
}

/** iynk's committed templates (`content/projects`), checked by iynk's validator before use. */
export function createTemplateSource(): TemplateSource {
  return {
    async load(id: string) {
      const report = validateValue(await loadTemplate(id));
      if (!report.ok || !report.doc) throw new Error(`template ${id} did not pass the project schema`);
      return report.doc;
    },
  };
}
