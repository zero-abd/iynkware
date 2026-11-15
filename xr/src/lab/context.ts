/**
 * The lab, as one object per app: the store, the experiment runner, the tutor and its feed, the inventory, and the
 * moves between labs. Pure TypeScript (no three.js), so it is tested headless; the sub-modules draw it. XrApp has no
 * lab service (a contract change would add one), so the sub-modules find it with `labOf(app.world)`, the way Range
 * finds its own watcher; `window.iynkware.lab` points at it too, for the emulator scripts and DevTools.
 */
import type { Lang } from '../contracts/common';
import { createRunner, type Runner } from './experiments/runner';
import { experimentById, LAB_LAYOUTS } from './experiments/list';
import type { Mode } from './experiments/types';
import { createInventory, type InventoryAnswer, type LabInventory } from './model/inventory';
import { createLabStore, type LabStore, type Pose } from './model/store';
import type { LabId } from './model/types';
import { createTutorFeed, type LabTutorFeed } from './tutor/feed';
import { createTutor, type Tutor } from './tutor/tutor';

export interface LabContext {
  readonly store: LabStore;
  readonly runner: Runner;
  readonly tutor: Tutor;
  readonly feed: LabTutorFeed;
  readonly inventory: LabInventory;
  readonly lang: () => Lang;
  /** Lays out a lab's whole bench (clearing what was there) and stops any experiment. */
  open(lab: LabId): void;
  /** Back to the circuit bench: the lab's items go, the project was never touched. */
  leave(): void;
  /** Starts an experiment in its lab (its own kit). False for an unknown id. */
  start(experimentId: string, mode?: Mode, seed?: number): boolean;
  /** Puts an item on the bench by kind or name; a stand-in box when the lab has no model of it. */
  request(kindOrName: string, pose?: Pose): InventoryAnswer & { readonly id: string };
  /** Advances the lab clock and the tutor (every frame while a lab is open). */
  frame(dtMs: number): void;
  dispose(): void;
}

/** Where a requested item goes when no pose is given: the back of the bench, left of centre. */
const REQUEST_AT: Pose = { x: -60, z: -150, yaw: 0 };

export function createLabContext(lang: () => Lang): LabContext {
  const store = createLabStore();
  const runner = createRunner(store);
  const tutor = createTutor(store, runner);
  const feed = createTutorFeed(store, runner, tutor, lang);
  const inventory = createInventory();
  const ctx: LabContext = {
    store,
    runner,
    tutor,
    feed,
    inventory,
    lang,
    open(lab) {
      runner.stop();
      store.clear();
      store.setLab(lab);
      for (const k of LAB_LAYOUTS[lab]) {
        const params = typeof k.params === 'function' ? k.params(1) : k.params;
        store.place(k.kind, { x: k.x, z: k.z, yaw: k.yaw ?? 0 }, { params });
      }
    },
    leave() {
      runner.stop();
      store.clear();
      store.setLab(null);
    },
    start(id, mode = 'practice', seed) {
      const exp = experimentById(id);
      if (!exp) return false;
      runner.start(exp, { mode, seed });
      return true;
    },
    request(kindOrName, pose = REQUEST_AT) {
      const answer = inventory.request(kindOrName);
      const id = answer.found
        ? store.place(answer.kind, pose)
        : store.place(answer.kind, pose, { label: answer.name, placeholder: true });
      return { ...answer, id };
    },
    frame(dtMs) {
      if (!store.lab) return;
      store.step(dtMs);
      tutor.tick();
    },
    dispose() {
      tutor.dispose();
      runner.dispose();
    },
  };
  return ctx;
}

const contexts = new WeakMap<object, LabContext>();

/** The lab of a world, made when the lab's model module mounts. */
export const labOf = (world: object): LabContext | undefined => contexts.get(world);
export const setLabOf = (world: object, ctx: LabContext | undefined): void => {
  if (ctx) contexts.set(world, ctx);
  else contexts.delete(world);
};
