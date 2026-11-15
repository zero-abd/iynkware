/**
 * What the companion knows about where the person is: one compact brief per scene, built from the registries the app
 * already has, and sent with every turn (`bridge.context().scene`). Nothing here is written by hand per lab or item, so
 * a new lab, experiment, item or drone is known the moment it is registered:
 *
 *   labs and experiments   lab/experiments/list.ts (EXPERIMENTS, LAB_LAYOUTS), lab/model/catalogue.ts (LAB_NAMES)
 *   lab items              lab/model/catalogue.ts (notesOf: name, summary, safe use, hazards), lab/model/registry.ts
 *   drones and robots      content/projects (LAB_TEMPLATES, lab 'drone' | 'robotics')
 *   board projects         content/projects (TEMPLATES)
 *
 * The brief is detailed for the scene the person is in (a lab: every experiment with its goal and steps, every item
 * with what it is and how to use it safely) and only an index for the rest, so it stays small. Pure TypeScript.
 */
import { LAB_TEMPLATES, TEMPLATES } from '@content/projects';
import { pickText, type Lang, type LocalizedText } from '../../contracts/common';
import { EXPERIMENTS, LAB_LAYOUTS } from '../../lab/experiments/list';
import { LAB_NAMES, notesOf } from '../../lab/model/catalogue';
import { modelOf } from '../../lab/model/registry';
import { LAB_IDS, type LabId } from '../../lab/model/types';
import { say } from '../../lab/text';

export type SceneId = 'home' | 'bench' | 'range' | 'room' | `lab:${LabId}`;

/** Where the person is, as the nav host reports it. */
export interface Where {
  readonly place: string;
  readonly lab: string | null;
  readonly home?: boolean;
}

export const sceneOf = (w: Where): SceneId => {
  if (w.lab && (LAB_IDS as readonly string[]).includes(w.lab)) return `lab:${w.lab as LabId}`;
  if (w.home) return 'home';
  if (w.place === 'range' || w.place === 'room') return w.place;
  return 'bench';
};

export interface Catalogue {
  readonly labs: ReadonlyArray<{ readonly id: LabId; readonly name: string; readonly experiments: readonly string[] }>;
  readonly drones: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly robots: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly projects: { readonly count: number; readonly examples: readonly string[] };
}

const title = (t: { title: unknown }, lang: Lang) => pickText(t.title as LocalizedText, lang);
const crafts = (lab: 'drone' | 'robotics', lang: Lang) =>
  LAB_TEMPLATES.filter((t) => t.lab === lab && (lab === 'drone' ? t.kind === 'craft' : t.kind === 'bench'))
    .sort((a, b) => a.order - b.order)
    .map((t) => ({ id: t.id, title: title(t, lang) }));

/** The drone crafts the person can open, in catalogue order. */
export const droneCrafts = (lang: Lang) => crafts('drone', lang);

/** Everything there is, one line each: what the companion can name from any scene. */
export function catalogue(lang: Lang): Catalogue {
  const boards = TEMPLATES.filter((t) => t.id.includes('uno-r3'));
  return {
    labs: LAB_IDS.map((id) => ({
      id,
      name: say(LAB_NAMES[id], lang),
      experiments: EXPERIMENTS.filter((e) => e.lab === id).map((e) => say(e.title, lang)),
    })),
    drones: droneCrafts(lang),
    robots: crafts('robotics', lang),
    projects: { count: TEMPLATES.length, examples: boards.slice(0, 8).map((t) => title(t, lang)) },
  };
}

export interface ItemBrief {
  readonly kind: string;
  readonly name: string;
  readonly summary: string;
  readonly safeUse: readonly string[];
  readonly hazards: readonly string[];
  readonly actions: readonly string[];
}

export interface LabBrief {
  readonly id: LabId;
  readonly name: string;
  readonly experiments: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly goal: string;
    readonly steps: readonly string[];
    readonly hazards: readonly string[];
  }>;
  readonly items: readonly ItemBrief[];
}

export function itemBrief(kind: string, lang: Lang): ItemBrief {
  const n = notesOf(kind);
  return {
    kind,
    name: say(n.name, lang),
    summary: say(n.summary, lang),
    safeUse: n.safeUse.map((x) => say(x, lang)),
    hazards: n.hazards.map((x) => say(x, lang)),
    actions: modelOf(kind).actions,
  };
}

/** A lab in full: its experiments (goal, steps, hazards) and every item it lays out or an experiment uses. */
export function labBrief(id: LabId, lang: Lang, extraKinds: readonly string[] = []): LabBrief {
  const exps = EXPERIMENTS.filter((e) => e.lab === id);
  const kinds = [...new Set([...LAB_LAYOUTS[id].map((k) => k.kind), ...exps.flatMap((e) => e.kit.map((k) => k.kind)), ...extraKinds])];
  return {
    id,
    name: say(LAB_NAMES[id], lang),
    experiments: exps.map((e) => ({
      id: e.id,
      title: say(e.title, lang),
      goal: say(e.goal, lang),
      steps: e.steps.map((s) => say(s.text, lang)),
      hazards: e.hazards.map((h) => say(h, lang)),
    })),
    items: kinds.map((k) => itemBrief(k, lang)),
  };
}

export interface SceneBrief {
  readonly scene: SceneId;
  /** What this scene is for, in a sentence the model can build on. */
  readonly about: string;
  readonly lab?: LabBrief;
  readonly index: Catalogue;
}

const ABOUT: Readonly<Record<'home' | 'bench' | 'range' | 'room' | 'lab', string>> = {
  home: 'Home: the start panel. From here the person opens a project, a lesson, a lab or the drones.',
  bench: 'The circuit bench: a microcontroller project built part by part, wired, run in simulation and stress tested.',
  range: 'The Range: the open drone or robot flies or drives in the person’s room, in simulation.',
  room: 'Room size: the open project shown at full size in the room.',
  lab: 'A training lab: real equipment on the bench, guided experiments in practice or exam mode, and a tutor.',
};

/** The brief for where the person is, plus the index of everything. `extraKinds`: lab items on the bench now. */
export function sceneBrief(w: Where, lang: Lang, extraKinds: readonly string[] = []): SceneBrief {
  const scene = sceneOf(w);
  const index = catalogue(lang);
  if (scene.startsWith('lab:')) {
    const id = scene.slice(4) as LabId;
    return { scene, about: ABOUT.lab, lab: labBrief(id, lang, extraKinds), index };
  }
  return { scene, about: ABOUT[scene as keyof typeof ABOUT], index };
}
