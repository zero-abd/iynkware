/**
 * The Range picker's pure model and its per-app slots: which converted drone crafts are offered, which course flies,
 * the last craft (the Drones tile opens it), and whether the panel is open. No three.js here, so it is unit tested.
 */
import type { Course } from '@/lib/flight';
import type { XrApp } from '../../../contracts/app';
import type { LocalizedText } from '../../../contracts/common';
import { value, type Value } from '../../../ui/value';

/** The craft the Drones tile opens until the person has picked another. */
export const DEFAULT_CRAFT = 'quad5';
const PREFIX = 'prj_drone-';

export interface CraftRow {
  readonly contentId: string;
  readonly templateId: string;
  readonly title: LocalizedText;
}

interface TemplateLike {
  readonly id: string;
  readonly title: Record<string, string>;
  readonly lab: string;
  readonly kind: string;
}

/** Every drone craft template whose figure is converted (`converted` = ids from the asset index), in template order. */
export function craftRows(converted: readonly string[], templates: readonly TemplateLike[]): CraftRow[] {
  const have = new Set(converted);
  const out: CraftRow[] = [];
  for (const t of templates) {
    if (t.lab !== 'drone' || t.kind !== 'craft' || !t.id.startsWith(PREFIX)) continue;
    const contentId = t.id.slice(PREFIX.length);
    if (have.has(contentId)) out.push({ contentId, templateId: t.id, title: t.title as LocalizedText });
  }
  return out;
}

/** The course that flies: the chosen one, else the first gates course, else the first. */
export function pickCourse<C extends Pick<Course, 'id' | 'kind'>>(courses: readonly C[], chosen: string | null): C | undefined {
  return (chosen ? courses.find((c) => c.id === chosen) : undefined) ?? courses.find((c) => c.kind === 'gates') ?? courses[0];
}

/** The course's title: its text key in the flight namespace when that resolves, else its id. */
export function courseTitle(course: Pick<Course, 'id' | 'title'>, resolve: (key: string) => string): string {
  const t = course.title ? resolve(course.title) : '';
  return t && t !== course.title ? t : course.id;
}

function slot<T>(initial: T): (app: Pick<XrApp, 'world'>) => Value<T> {
  const slots = new WeakMap<object, Value<T>>();
  return (app) => {
    let v = slots.get(app.world);
    if (!v) slots.set(app.world, (v = value<T>(initial)));
    return v;
  };
}

/** The course the person chose (null: the default). The room reads it as it enters and re-enters when it changes. */
export const courseChoiceOf = slot<string | null>(null);
/** The last drone craft open (content id): the Drones tile loads it. */
export const lastCraftOf = slot<string>(DEFAULT_CRAFT);
/** Whether the picker panel is open. */
export const pickerOpenOf = slot<boolean>(false);
/** The Drones tile sets this so the picker opens once the person arrives in the Range; the picker clears it. */
export const pickerPendingOf = slot<boolean>(false);
