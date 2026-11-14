// Whether a figure's reported state satisfies a `state` check's conditions. Kept apart from checks.ts so the lesson
// page can read it without the board profiles the rest of the evaluator needs.

import type { StateCond } from '@/content/schema';

function lookup(state: Record<string, unknown>, path: string): unknown {
  if (path in state) return state[path];
  let node: unknown = state;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

export function stateMatches(state: Record<string, unknown>, cond: StateCond): boolean {
  return Object.entries(cond).every(([path, want]) => want === undefined || lookup(state, path) === want);
}
