/**
 * The project store: the one `iynk.project` document the headset edits, and the selection. Every edit in the headset
 * is a `ProjectSession` op (iynk's `src/project/session.ts`, imported unchanged), so a headset project opens in iynk's
 * Studio and the reverse. Contract file: changes only in its own PR (label `contract-change`).
 *
 * Implementation: `xr/src/project/store.ts` (`createProjectStore`), in memory. Persistence is `ProjectRepository`.
 */
import type { Op, Project } from '@/project/generated/types';
import type { ApplyResult } from '@/project/session';
import type { DocChange } from '@/project/touched';
import type { Descriptor } from '@/parts/descriptor';
import type { AuthoredChannel, CoAuthor } from './assistant';
import type { Unsubscribe } from './common';

export type { ApplyResult, DocChange, Op, Project, Descriptor };

export interface ProjectStore {
  readonly doc: Project;
  readonly revision: number;
  /** One call is one undo entry. Authored as the local person. Never mutate `doc` directly. */
  apply(ops: Op | readonly Op[], opts?: { label?: string }): ApplyResult;
  undo(): ApplyResult | null;
  redo(): ApplyResult | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** The `label` given to `apply` for the entry `undo()` would revert next; null when there is none or it had no label. */
  undoLabel(): string | null;
  /** The label of the entry `redo()` would apply next; null when there is none or it had no label. */
  redoLabel(): string | null;
  /** Called after every applied change, undo, redo and `open` (an `open` arrives with `origin: 'load'`). */
  subscribe(fn: (change: DocChange) => void): Unsubscribe;
  /** Swaps in another document (opening a project or a lesson); forgets undo history. */
  open(doc: Project): void;
  /** Part descriptor lookup (`ref@version`), from the app's shared registry: the core parts and the person's imported ones. */
  describe(ref: string, version?: string): Descriptor | undefined;
  readonly selection: Selection;
  /**
   * Ops authored as another actor (the co-builder), on that actor's own undo stack, so undoing it never undoes the
   * person and the reverse. Its changes arrive with `DocChange.origin` `ai`. `open` forgets every actor's stacks.
   */
  as(author: CoAuthor): AuthoredChannel;
}

/** Entity ids (`cmp_*`, `brd_*`, `wir_*`, `net_*`) the person has selected. */
export interface Selection {
  readonly ids: readonly string[];
  set(ids: readonly string[]): void;
  toggle(id: string): void;
  clear(): void;
  subscribe(fn: (ids: readonly string[]) => void): Unsubscribe;
}

/** Where projects are kept between sessions, shared with the 2D Studio on the same origin. */
export interface ProjectRepository {
  list(): Promise<ReadonlyArray<{ id: string; title: string; updatedAt: string }>>;
  load(id: string): Promise<Project | null>;
  save(doc: Project): Promise<void>;
}

/** Bundled starting points: iynk's committed templates (`content/projects`), loaded by id. */
export interface TemplateSource {
  load(id: string): Promise<Project>;
}
