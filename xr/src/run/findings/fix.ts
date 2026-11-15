/**
 * Fixes: a finding's plans turned into project ops by iynk's `src/studio/fixes.ts` (imported unchanged), applied as one
 * batch with a label so the bench's undo takes it back. The ops are the headset project's own `Op` type, so nothing
 * needs adapting beyond giving that module the part registry the store already has.
 */
import { resolveFixes, type FixDeps, type ResolvedFix } from '@/studio/fixes';
import type { Finding } from '../../contracts/sim';
import type { Op, Project, ProjectStore } from '../../contracts/project';

export type { ResolvedFix };

/** The part lookup iynk's fixes read, from the project store. */
export function fixDepsOf(project: Pick<ProjectStore, 'describe'>): FixDeps {
  return { reg: { get: (ref: string, version: string) => project.describe(ref, version), latest: (ref: string) => project.describe(ref) } };
}

/** A finding's fixes with their ops, previews and arguments (a part id reads as its refdes). */
export function fixesOf(doc: Project, finding: Finding, deps: FixDeps): ResolvedFix[] {
  return resolveFixes(doc, finding.fixes, deps);
}

/** The first fix that can be applied (it has ops), or -1: the one the card's Fix it plate applies. */
export function appliable(fixes: readonly ResolvedFix[]): number {
  return fixes.findIndex((f) => f.ops.length > 0);
}

export type FixOutcome = { ok: true; revision: number } | { ok: false; message: string };

/**
 * Works the ops out again against the document as it is now (it may have changed since the card opened), and applies
 * them as one undo entry. The label is what the undo shows.
 */
export function applyFix(
  project: Pick<ProjectStore, 'doc' | 'describe' | 'apply'>,
  finding: Finding,
  index: number,
  label: string,
): FixOutcome {
  const fresh = fixesOf(project.doc, finding, fixDepsOf(project))[index];
  if (!fresh || fresh.ops.length === 0) return { ok: false, message: 'stale' };
  const result = project.apply(fresh.ops as Op[], { label });
  return result.ok ? { ok: true, revision: result.revision } : { ok: false, message: result.message };
}
