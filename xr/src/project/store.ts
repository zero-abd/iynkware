/** In-memory project store over iynk's `ProjectSession` (imported unchanged). Contract: contracts/project.ts. */
import { builtinRegistry } from '@/parts/builtin';
import type { PartRegistry } from '@/parts/registry';
import { createSession } from '@/project/session';
import { computeTouched } from '@/project/touched';
import { validateValue } from '@/project/validate';
import { loadTemplate } from '@content/projects';
import type { Unsubscribe } from '../contracts/common';
import type { DocChange, Descriptor, Op, Project, ProjectStore, Selection, TemplateSource } from '../contracts/project';

const clock = () => Date.now();
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

  return {
    get doc() {
      return session.state;
    },
    get revision() {
      return session.revision;
    },
    apply: (ops: Op | readonly Op[], opts) => session.apply(ops, author(), opts?.label ? { label: opts.label } : undefined),
    undo: () => session.undo(author().actor),
    redo: () => session.redo(author().actor),
    canUndo: () => session.canUndo(author().actor),
    canRedo: () => session.canRedo(author().actor),
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    open(next: Project) {
      const prev = session.state;
      unhook();
      session = createSession({ state: next, clock, rnd });
      unhook = session.subscribe((c) => emit(c));
      selection.clear();
      emit({ from: prev.revision, to: next.revision, ops: [], touched: computeTouched(prev, next), origin: 'load' });
    },
    describe(ref: string, version?: string): Descriptor | undefined {
      return version ? parts.get(ref, version) : parts.latest(ref);
    },
    selection,
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
