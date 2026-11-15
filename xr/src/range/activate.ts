/**
 * Range noticing the open project: a drone craft or a physics robot makes Range offer the `range` place (the shell's
 * mode switch lists it), and the home panel gets a Drones tile that opens the converted quad. Every Range sub-module
 * reads `rangeOf(app)` instead of inspecting the document itself.
 */
import type { FeatureModule, XrApp } from '../contracts/app';
import type { LocalizedText, ReadonlyValue, Unsubscribe } from '../contracts/common';
import { LANGS } from '../contracts/common';
import { lastCraftOf, pickerPendingOf } from './flight/picker/model';
import { defineStrings, watchRangeProject, type RangeProject } from './shared';

/** The template the Drones tile opens: the craft whose figure is converted. */
export const DRONE_TEMPLATE = 'prj_drone-quad5';

export const ACTIVATE_STRINGS = defineStrings({
  en: { drones: 'Drones', dronesDetail: 'Build a 5-inch quad and fly it in your room' },
  de: { drones: 'Drohnen', dronesDetail: 'Bau einen 5-Zoll-Quad und flieg ihn in deinem Zimmer' },
  es: { drones: 'Drones', dronesDetail: 'Monta un quad de 5 pulgadas y vuélalo en tu habitación' },
  fr: { drones: 'Drones', dronesDetail: 'Monte un quad de 5 pouces et fais-le voler dans ta pièce' },
  hi: { drones: 'ड्रोन', dronesDetail: '5 इंच का क्वाड बनाओ और उसे अपने कमरे में उड़ाओ' },
  zh: { drones: '无人机', dronesDetail: '组装一台 5 英寸四轴，在你的房间里飞' },
});

const localized = (key: 'drones' | 'dronesDetail'): LocalizedText =>
  Object.fromEntries(LANGS.map((l) => [l, ACTIVATE_STRINGS.t(l, key)])) as LocalizedText;

const droneRuns = new WeakMap<object, () => 'built' | 'ready'>();

/** The drone bench (while it is on the table) says what Run does: builds the drone, or says it is ready to fly. */
export function provideDroneRun(app: Pick<XrApp, 'world'>, run: (() => 'built' | 'ready') | null): void {
  if (run) droneRuns.set(app.world, run);
  else droneRuns.delete(app.world);
}

/**
 * Run on a drone project: 'built' when it just assembled the drone, 'ready' when it is already built and fit to fly,
 * 'wait' when the bench is not up yet, null when the open project is not a drone (the normal Run applies).
 */
export function runDrone(app: Pick<XrApp, 'world' | 'project'>): 'built' | 'ready' | 'wait' | null {
  if (rangeOf(app).value?.kind !== 'drone') return null;
  return droneRuns.get(app.world)?.() ?? 'wait';
}

const watchers = new WeakMap<object, ReadonlyValue<RangeProject | null>>();

/** The open project's Range kind (one watcher per app, made when Range mounts). */
export function rangeOf(app: Pick<XrApp, 'world' | 'project'>): ReadonlyValue<RangeProject | null> {
  let w = watchers.get(app.world);
  if (!w) {
    w = watchRangeProject(app.project);
    watchers.set(app.world, w);
  }
  return w;
}

export const activateModule: FeatureModule = {
  id: 'range/activate',
  mount(app) {
    const range = rangeOf(app);
    let offer: Unsubscribe | null = null;
    let offerKind: RangeProject['kind'] | null = null;
    const sync = (p: RangeProject | null) => {
      // a drone swapped for a robot (the picker's Robots row) is offered to the other module
      if (p && offer && offerKind !== p.kind) {
        offer();
        offer = null;
      }
      if (p && !offer) {
        offerKind = p.kind;
        offer = app.shell.offer('range', p.kind === 'drone' ? 'range/flight' : 'range/robots');
      }
      if (!p && offer) {
        offer();
        offer = null;
        offerKind = null;
        if (app.shell.place.value === 'range') app.shell.go('bench');
      }
    };
    sync(range.value);
    const offRange = range.subscribe(sync);
    const offEntry = app.shell.addEntry({
      id: 'range/drones',
      slot: 'range',
      title: localized('drones'),
      detail: localized('dronesDetail'),
      open() {
        // the last craft (quad5 at first), and the picker opens when the person arrives in the Range
        pickerPendingOf(app).set(true);
        void app.templates.load(`prj_drone-${lastCraftOf(app).value}`).then((doc) => app.project.open(doc));
      },
    });
    return () => {
      offRange();
      offEntry();
      offer?.();
      (range as { dispose?: () => void }).dispose?.();
      watchers.delete(app.world);
    };
  },
};
