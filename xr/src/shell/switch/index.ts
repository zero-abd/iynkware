/**
 * Switching what is on the bench and where the person is, without leaving the session. Home and the menu both call
 * these, so a tile and a menu row do exactly the same thing. Not a sub-module.
 *
 *   continueLast(app)            the library project on the bench, else the last one, else the last lesson, else Blink
 *   openLesson(app, templateId)  a template as a lesson (forked, with the guide)
 *   openProject(app, id)         a library project
 *   newProject(app, template?)   a new library project, blank or forked from a template, opened
 *   openDrone(app, at?)          the Range's drone (the `range` home entry), then the Range place (or `at: 'bench'`:
 *                                stay on the bench, where the Range draws the drone bench to build and test it)
 *   openCraft(app, id, at?)      any drone craft or robot template, then the Range place (or the bench, as above)
 *   goPlace(app, place)          the mode switch; `range` opens the drone first when no Range project is open
 *
 * Each closes Home and the lesson guide as needed, leaves any open lab (its items go with it), runs one switch at a time (`switching`), and says what failed as a
 * notice instead of throwing. `providePanel`/`openPanel` let Home and the menu open each other and the projects and
 * settings panels without importing them.
 */
import { LAB_TEMPLATES, TEMPLATES } from '@content/projects';
import type { XrApp } from '../../contracts/app';
import type { Lang, LocalizedText, ReadonlyValue } from '../../contracts/common';
import { LANGS, pickText } from '../../contracts/common';
import type { Place } from '../../contracts/shell';
import { labOf } from '../../lab/context';
import { value } from '../../ui/value';
import { say } from '../copy';
import { libraryOf } from '../library/types';
import { SWITCH } from './copy';

/** The first lesson: Blink on the Uno. */
export const BLINK = 'prj_uno-r3-blink';

/** Templates Home offers as new projects, in order (ids from `content/projects`). */
export const FEATURED: readonly string[] = ['prj_uno-r3-button', 'prj_uno-r3-servo', 'prj_uno-r3-piano', 'prj_robotics-l298n'];

/** A template's title in `lang`, without loading the file; the id when it is unknown. */
export function templateTitle(id: string, lang: Lang): string {
  const t = TEMPLATES.find((e) => e.id === id) ?? LAB_TEMPLATES.find((e) => e.id === id);
  return t ? pickText(t.title as LocalizedText, lang) || id : id;
}

const busy = new WeakMap<object, ReturnType<typeof value<boolean>>>();
/** True while a switch is loading; tiles and rows show it and ignore a second press. */
export function switching(app: XrApp): ReadonlyValue<boolean> {
  let v = busy.get(app.world);
  if (!v) {
    v = value(false);
    busy.set(app.world, v);
  }
  return v;
}

const failed = (): LocalizedText => Object.fromEntries(LANGS.map((l) => [l, say(SWITCH, l, 'failed')])) as LocalizedText;

/**
 * The longest a switch may take. A switch that never finishes (a lesson waiting on a stuck simulation, storage that
 * does not answer) would otherwise hold `switching` for good, and every later switch (Home's tiles, the menu, the
 * companion's go_to) would be refused. Past this, the lock is let go and the switch counts as failed.
 */
const SWITCH_LIMIT_MS = 15_000;

/**
 * Leaves the open lab, if any: its items go and the circuit bench comes back. Every switch does this first, so a lab's
 * things never stay on the table under a drone, a project or a lesson, whoever asked (Home, the menu, the companion).
 */
export function leaveLab(app: XrApp): void {
  const lab = labOf(app.world);
  if (lab?.store.lab) lab.leave();
}

async function run(app: XrApp, what: () => Promise<unknown>): Promise<boolean> {
  const b = switching(app) as ReturnType<typeof value<boolean>>;
  if (b.value) return false;
  b.set(true);
  app.shell.closeHome();
  leaveLab(app);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      what(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`switch took longer than ${SWITCH_LIMIT_MS} ms`)), SWITCH_LIMIT_MS);
      }),
    ]);
    return true;
  } catch (err) {
    console.error('[shell/switch]', err);
    app.shell.notify({ id: 'shell/switch-failed', tone: 'fail', text: failed(), ms: 6000 });
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    b.set(false);
  }
}

/** Waits until `place` is offered (a Range project's watcher offers `range` after the doc opens). */
function offeredSoon(app: XrApp, place: Place, ms = 8000): Promise<boolean> {
  if (app.shell.offered.value.includes(place)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, ms);
    const off = app.shell.offered.subscribe((list) => {
      if (!list.includes(place)) return;
      clearTimeout(timer);
      off();
      resolve(true);
    });
  });
}

/** Leaves a non-bench place before the bench changes under it. */
const toBench = (app: XrApp) => {
  if (app.shell.place.value !== 'bench') app.shell.go('bench');
};

export const openLesson = (app: XrApp, templateId: string) =>
  run(app, async () => {
    toBench(app);
    await app.lessons.open(templateId);
  });

export const openProject = (app: XrApp, id: string) =>
  run(app, async () => {
    const lib = libraryOf(app);
    if (!lib) throw new Error('library not ready');
    toBench(app);
    app.lessons.close();
    await lib.open(id);
  });

export const newProject = (app: XrApp, template?: string) =>
  run(app, async () => {
    const lib = libraryOf(app);
    if (!lib) throw new Error('library not ready');
    toBench(app);
    app.lessons.close();
    await lib.create(template ? { template, title: templateTitle(template, app.settings.lang.value) } : {});
  });

/** What Continue does now, for its label: `bench` closes Home (the project is already open). */
export type ContinueKind = { kind: 'bench'; title: string } | { kind: 'project'; id: string; title: string } | { kind: 'lesson'; id: string; title: string } | { kind: 'start'; id: string; title: string };

export function continueTarget(app: XrApp): ContinueKind {
  const lang = app.settings.lang.value;
  const lib = libraryOf(app);
  const cur = lib?.current.value ?? null;
  if (cur !== null) return { kind: 'bench', title: lib?.rows.value.find((r) => r.id === cur)?.title ?? '' };
  const last = lib?.last.value ?? null;
  if (last) return { kind: 'project', id: last.id, title: last.title };
  const lesson = app.lessons.last.value;
  if (lesson) return { kind: 'lesson', id: lesson.templateId, title: pickText(lesson.title, lang) };
  return { kind: 'start', id: BLINK, title: templateTitle(BLINK, lang) };
}

export function continueLast(app: XrApp): Promise<boolean> {
  const t = continueTarget(app);
  if (t.kind === 'bench') {
    app.shell.closeHome();
    leaveLab(app);
    toBench(app);
    return Promise.resolve(true);
  }
  return t.kind === 'project' ? openProject(app, t.id) : openLesson(app, t.id);
}

/** Where a drone ends up: flying in the Range, or on the bench (the drone bench: build, wire, test the motors). */
export type DroneAt = 'range' | 'bench';

/** After a drone project is open: the Range place, or the bench (with Home closed) for the drone bench. */
const settleDrone = (app: XrApp, at: DroneAt) => {
  if (at === 'range') {
    app.shell.go('range');
    return;
  }
  app.shell.closeHome();
  toBench(app);
};

/** The Range's drone: its home entry opens the craft; then the Range place once Range offers it, or the drone bench. */
export const openDrone = (app: XrApp, at: DroneAt = 'range') =>
  run(app, async () => {
    const entry = app.shell.entries.value.find((e) => e.slot === 'range');
    if (!entry) throw new Error('no range entry');
    app.lessons.close();
    if (!app.shell.offered.value.includes('range')) {
      toBench(app);
      entry.open();
      if (!(await offeredSoon(app, 'range'))) throw new Error('range was not offered');
    }
    settleDrone(app, at);
  });

/** A drone craft or robot from `content/projects` (LAB_TEMPLATES), opened like the Drones tile, then the Range place or the drone bench. */
export const openCraft = (app: XrApp, templateId: string, at: DroneAt = 'range') =>
  run(app, async () => {
    if (!LAB_TEMPLATES.some((t) => t.id === templateId)) throw new Error(`unknown craft ${templateId}`);
    app.lessons.close();
    toBench(app);
    await app.project.open(await app.templates.load(templateId));
    if (!(await offeredSoon(app, 'range'))) throw new Error('range was not offered');
    settleDrone(app, at);
  });

/** The mode switch: `room` and `bench` go when offered; `range` opens the drone first when nothing offers it. */
export function goPlace(app: XrApp, place: Place): Promise<boolean> {
  if (app.shell.offered.value.includes(place)) {
    app.shell.closeHome();
    leaveLab(app);
    return Promise.resolve(app.shell.go(place));
  }
  return place === 'range' ? openDrone(app) : Promise.resolve(false);
}

/** The shell's own panels, so they can open each other without importing each other. */
export type PanelName = 'home' | 'menu' | 'projects' | 'settings';
const panels = new WeakMap<object, Map<PanelName, () => void>>();

/** Registers what opens `name`; the returned function unregisters it. */
export function providePanel(app: XrApp, name: PanelName, open: () => void): () => void {
  let m = panels.get(app.world);
  if (!m) panels.set(app.world, (m = new Map()));
  m.set(name, open);
  return () => {
    if (m.get(name) === open) m.delete(name);
  };
}

/** Opens `name`; false when that panel is not built yet (its tile shows as not ready). */
export function openPanel(app: XrApp, name: PanelName): boolean {
  const open = panels.get(app.world)?.get(name);
  if (!open) return false;
  open();
  return true;
}

export const hasPanel = (app: XrApp, name: PanelName): boolean => panels.get(app.world)?.has(name) ?? false;
