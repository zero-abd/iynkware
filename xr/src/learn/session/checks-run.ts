/**
 * iynk's real lesson checks, as the Studio runs them (GuideMount.tsx `runChecks`): `runLessonTests` over
 * `lessonJobFor`, each job started with `startChecks` (a Web Worker in the browser; inline after a yield where there is
 * no Worker, as in the Node tests), the tier from iynk's static fidelity. Loaded with a dynamic import on the first run
 * so the interpreter and the fidelity registry stay out of the main chunk. `src/components/studio/lessonChecks.ts`,
 * `lessonJob.ts` and `checkJob.ts` are pure TypeScript despite their folder (no React or Next is imported).
 */
import { runLessonTests } from '@/components/studio/lessonChecks';
import { startChecks } from '@/lib/interp';
import type { LessonRun, Tier } from '@/project/guided/record';
import { loadRegistry } from '@/sim/registry/entries';
import type { Registry } from '@/sim/registry/types';
import { staticTier } from '@/studio/fidelity/static-tier';
import type { Project } from '../../contracts/project';

let fidelity: Registry | undefined;

/** The Studio's `tierOf`: the project's lowest static fidelity tier, T0 when none applies. */
export function tierOf(project: Project): Tier {
  const { summary } = staticTier(project, (fidelity ??= loadRegistry()));
  return summary === 'none' ? 'T0' : summary;
}

export function startLessonChecks(doc: Project, onProgress: (fraction: number) => void): { result: Promise<LessonRun>; cancel(): void } {
  return runLessonTests(doc, { run: startChecks, now: () => new Date().toISOString(), tierOf }, { onProgress });
}
