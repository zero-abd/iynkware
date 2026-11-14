/**
 * Opening a template as the learner's own copy, the way the Studio does (`src/studio/templates.ts` `openTemplate`):
 * iynk's `forkTemplate` and `withStartCheckpoint`, imported unchanged. `templates.ts` itself is not imported: it pulls
 * the Studio's view and tool code.
 */
import { newProjectId } from '@/core/ids';
import { chainStart, stateHash } from '@/project/hash';
import { validateValue } from '@/project/validate';
import { forkTemplate, withStartCheckpoint, type ForkDeps } from '@/studio/fork';
import { LAB_TEMPLATES, TEMPLATES } from '@content/projects';
import type { Project } from '../../contracts/project';

/**
 * The owner of the learner's forks: the same id as iynk's `LOCAL_ACTOR` (`src/studio/templates.ts`), so a fork made
 * here is the device's own project in the Studio too. Kept here rather than imported, for the reason above.
 */
export const LEARN_ACTOR = 'usr_local';

const entryOf = (id: string) => TEMPLATES.find((t) => t.id === id) ?? LAB_TEMPLATES.find((t) => t.id === id);

/** A template from iynk's index, checked by iynk's validator; undefined for an id the index does not have. */
export async function loadTemplate(templateId: string): Promise<Project | undefined> {
  const entry = entryOf(templateId);
  if (!entry) return undefined;
  const report = validateValue(await entry.load());
  if (!report.ok || !report.doc) throw new Error(`template ${templateId} did not pass the project schema`);
  return report.doc;
}

function forkDeps(): ForkDeps {
  const now = Date.now();
  return {
    newId: () => newProjectId(now),
    now: () => new Date(now).toISOString(),
    actor: LEARN_ACTOR,
    genesis: chainStart,
    stateHash,
  };
}

/** The template as the learner's project: new id and owner, fresh history, no hidden solution, a Start checkpoint. */
export function forkLesson(template: Project): Project {
  const deps = forkDeps();
  return withStartCheckpoint(forkTemplate(template, 'lesson', deps), deps);
}

/** The template a document was made from (a fork's origin), the document's own id when it is a template, else null. */
export function templateIdOf(doc: Project): string | null {
  const { origin } = doc.provenance;
  if (origin.kind === 'fork') return origin.project;
  if (origin.kind === 'template') return origin.template;
  return entryOf(doc.id) ? doc.id : null;
}
