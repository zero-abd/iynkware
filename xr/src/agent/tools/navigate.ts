/**
 * The agent's way around the app: go anywhere from anywhere, and press any button the pillars put in the menu.
 *
 *   go_to          a lab (chemistry, physics, electrical, signals), the drone or a drone by name (Tiny Whoop, racer),
 *                  the list of drones ("drone projects": named, not opened), the bench, room size, Home, a template
 *                  (blink, servo, button, piano, robot …) or a saved project, by name. It leaves what is open first
 *                  (a lab, the Range, Home, a lesson guide) through the shell's own switch (`shell/switch`), so it works
 *                  from any workbench: from a lab to the drone, from the drone to a lab, from one lab to another.
 *   list_controls  every menu row (Build with me, Voice, see-through, each lab, …), with its state for a switch
 *   use_control    runs one of them by id or name
 *
 * `createNavHost` binds these to the app; the tools only see `NavHost`, so tests can fake it.
 */
import { LAB_TEMPLATES, TEMPLATES } from '@content/projects';
import type { XrApp } from '../../contracts/app';
import { pickText, type Lang } from '../../contracts/common';
import { labOf } from '../../lab/context';
import { LAB_IDS, type LabId } from '../../lab/model/types';
import { libraryOf } from '../../shell/library/types';
import { goPlace, newProject, openCraft, openDrone, openProject } from '../../shell/switch';
import { droneCrafts } from '../knowledge';
import type { Args, ToolHost, ToolResult } from './catalog';

export type Destination =
  | { readonly kind: 'lab'; readonly lab: LabId }
  | { readonly kind: 'drone' }
  /** The drones to choose from: listed, nothing opens. */
  | { readonly kind: 'drones' }
  | { readonly kind: 'craft'; readonly id: string; readonly title: string }
  | { readonly kind: 'bench' }
  | { readonly kind: 'room' }
  | { readonly kind: 'home' }
  | { readonly kind: 'template'; readonly id: string; readonly title: string }
  | { readonly kind: 'project'; readonly id: string; readonly title: string };

export interface NavHost {
  /** Saved projects, for names. */
  projects(): ReadonlyArray<{ id: string; title: string }>;
  go(d: Destination): Promise<boolean>;
  controls(lang: Lang): ReadonlyArray<{ id: string; label: string; on?: boolean }>;
  runControl(id: string): boolean;
  /** Where the person is now. */
  where(): { place: string; lab: string | null; project: string; home?: boolean };
}

const fail = (error: string, extra: Record<string, unknown> = {}): ToolResult => ({ ok: false, error, ...extra });

const LAB_WORDS: ReadonlyArray<readonly [RegExp, LabId]> = [
  [/chem/, 'chemistry'],
  [/physi|pendul/, 'physics'],
  [/electri|ohm|elektr/, 'electrical'],
  [/signal|system|wave|scope|oscillo/, 'signals'],
];

/** A destination for words like "the drone project", "my signals and systems lab", "servo", "workbench". */
export function destinationOf(words: string, nav: Pick<NavHost, 'projects'>, lang: Lang = 'en'): Destination | null {
  const clean = (x: string) => x.toLowerCase().replace(/\b(the|my|a|an|go|to|open|switch|back)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const t = clean(words);
  if (!t) return null;
  const lab = LAB_IDS.find((id) => t === id) ?? LAB_WORDS.find(([re]) => re.test(t))?.[1];
  if (lab && /lab|labor|chem|physi|signal|system|electri|ohm|pendul|scope|wave/.test(t)) return { kind: 'lab', lab };
  if (/\bdrones\b|drohnen|drone (projects|list|crafts|models)|(list|all|which|choose|pick)\b.*\bdrone/.test(t)) return { kind: 'drones' };
  const craft = craftOf(t, lang);
  if (craft) return craft;
  if (/drone|quad|range|fly|flight|drohne/.test(t)) return { kind: 'drone' };
  if (/^home|main menu|start screen/.test(t)) return { kind: 'home' };
  if (/room size|room scale|full size|life size/.test(t)) return { kind: 'room' };
  if (/^(bench|workbench|circuit bench|circuit|werkbank)( project)?$/.test(t)) return { kind: 'bench' };
  const project = nav.projects().find((p) => clean(p.title) === t || (clean(p.title).length >= 3 && t.includes(clean(p.title))));
  if (project) return { kind: 'project', ...project };
  const key = t.replace(/\b(project|template|lesson|circuit|build)\b/g, ' ').trim();
  if (key.length >= 3) {
    const hit =
      TEMPLATES.find((x) => x.id === key) ??
      TEMPLATES.find((x) => x.id.includes('uno-r3') && x.id.includes(key.replace(/\s+/g, '-'))) ??
      TEMPLATES.find((x) => x.id.includes(key.replace(/\s+/g, '-'))) ??
      TEMPLATES.find((x) => pickText(x.title, lang).toLowerCase().includes(key));
    if (hit) return { kind: 'template', id: hit.id, title: pickText(hit.title, lang) };
  }
  if (lab) return { kind: 'lab', lab };
  return null;
}

/** A drone craft by its catalogue id (whoop, racer, quad5) or title words ("tiny whoop", "long range"). */
function craftOf(t: string, lang: Lang): Destination | null {
  const key = t.replace(/\b(drone|drones|project|craft|quad|copter|fly|open)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const flat = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const k = flat(key);
  if (k.length < 4) return null;
  const hit = LAB_TEMPLATES.find((x) => x.lab === 'drone' && x.kind === 'craft' && (flat(x.catalogue.id) === k || flat(pickText(x.title, lang)).includes(k) || flat(pickText(x.title, 'en')).includes(k)));
  return hit ? { kind: 'craft', id: hit.id, title: pickText(hit.title, lang) } : null;
}

export const NAV_RUNS: Readonly<Record<string, (h: ToolHost, a: Args) => Promise<ToolResult> | ToolResult>> = {
  async go_to(h, a) {
    const nav = h.nav;
    if (!nav) return fail('switching is not available here');
    const d = destinationOf(a.where as string, nav, h.lang());
    if (!d) {
      return fail(`I do not know a place or project called "${a.where}"`, {
        try: ['chemistry lab', 'physics lab', 'electrical lab', 'signals lab', 'drone', 'drones', 'workbench', 'home', ...TEMPLATES.filter((x) => x.id.includes('uno-r3')).slice(0, 6).map((x) => x.id)],
      });
    }
    if (d.kind === 'drones') {
      return { ok: true, listed: 'drones', drones: droneCrafts(h.lang()).map((c) => c.title), note: 'Nothing opened: say these and ask which one to open (go_to with its name).' };
    }
    const ok = await nav.go(d);
    return ok ? { ok: true, went: d, now: nav.where() } : fail(`could not open ${d.kind}`, { now: nav.where() });
  },
  list_controls(h) {
    if (!h.nav) return fail('controls are not available here');
    return { ok: true, controls: h.nav.controls(h.lang()), now: h.nav.where() };
  },
  use_control(h, a) {
    const nav = h.nav;
    if (!nav) return fail('controls are not available here');
    const want = (a.control as string).trim().toLowerCase();
    const list = nav.controls(h.lang());
    const c = list.find((x) => x.id.toLowerCase() === want || x.label.toLowerCase() === want) ?? list.find((x) => x.label.toLowerCase().includes(want) || x.id.toLowerCase().includes(want));
    if (!c) return fail(`no control "${a.control}"`, { controls: list.map((x) => x.label) });
    if (!nav.runControl(c.id)) return fail(`${c.label} did not run`);
    return { ok: true, ran: c.label, now: nav.controls(h.lang()).find((x) => x.id === c.id)?.on };
  },
};

export const NAV_KINDS = { go_to: 'act', list_controls: 'read', use_control: 'act' } as const;

/** `NavHost` over the app: the shell's switch, the lab context and the menu rows. */
export function createNavHost(app: XrApp): NavHost {
  const leaveLab = () => {
    const lab = labOf(app.world);
    if (lab?.store.lab) lab.leave();
  };
  return {
    projects: () => (libraryOf(app)?.rows.value ?? []).map((r) => ({ id: r.id, title: r.title })),
    async go(d) {
      switch (d.kind) {
        case 'lab': {
          const lab = labOf(app.world);
          if (!lab) return false;
          if (app.shell.place.value !== 'bench') app.shell.go('bench');
          app.lessons.close();
          app.shell.closeHome();
          lab.open(d.lab);
          return lab.store.lab === d.lab;
        }
        case 'drone':
          leaveLab();
          return openDrone(app);
        case 'drones':
          return true;
        case 'craft':
          leaveLab();
          return openCraft(app, d.id);
        case 'bench':
          leaveLab();
          app.shell.closeHome();
          return app.shell.place.value === 'bench' || app.shell.go('bench');
        case 'room':
          leaveLab();
          return goPlace(app, 'room');
        case 'home':
          app.shell.openHome();
          return true;
        case 'template':
          leaveLab();
          return newProject(app, d.id);
        case 'project':
          leaveLab();
          return openProject(app, d.id);
      }
    },
    controls: (lang) => app.shell.menuItems.value.map((m) => ({ id: m.id, label: pickText(m.label, lang), ...(m.toggle ? { on: m.toggle.value } : {}) })),
    runControl(id) {
      const m = app.shell.menuItems.value.find((x) => x.id === id);
      if (!m) return false;
      m.run();
      return true;
    },
    where: () => ({ place: app.shell.place.value, lab: labOf(app.world)?.store.lab ?? null, project: app.project.doc.id, home: app.shell.homeOpen.value }),
  };
}
