/**
 * The lab tutor: live instruction and feedback from item state, mistakes and the current step. The brain is
 * `tutor.ts` (made with the lab's context); this module shows what it says as a callout over the item it is about,
 * in the person's language, for a few seconds (a hazard stays while it lasts). `app.overlay` cannot be used: its
 * targets are `BoardTarget`s, which name project parts, and lab items are not in the project, so the callout is the
 * look kit's own (`look/callout.ts`) on the bench table, above the item's pose. The panel shows the latest line too.
 *
 * For a model-backed or voice tutor, `labOf(world).feed` is the seam: `subscribe` and `snapshot()` (docs/XR_LAB.md).
 */
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { createCallout, type Callout, type CalloutTone } from '../../look/callout';
import { onLookFrame } from '../../look/runner';
import { labOf, type LabContext } from '../context';
import { modelOf } from '../model/registry';
import { say } from '../text';
import type { TutorEvent, TutorKind } from './tutor';

const TONE: Readonly<Record<TutorKind, CalloutTone>> = { instruct: 'do', praise: 'pass', warn: 'warn', hazard: 'fail', hint: 'info' };
/** How long a callout stays, ms (wall clock). */
const SHOW_MS: Readonly<Record<TutorKind, number>> = { instruct: 9000, praise: 3000, warn: 8000, hazard: 12000, hint: 9000 };

interface Shown {
  callout: Callout;
  until: number;
  event: TutorEvent;
}

export function mountTutorCallouts(app: XrApp, lab: LabContext): Unsubscribe {
  const { store } = lab;
  const shown = new Map<string, Shown>();
  let clock = 0;

  const remove = (id: string) => {
    const s = shown.get(id);
    if (!s) return;
    s.callout.dispose();
    s.callout.group.removeFromParent();
    shown.delete(id);
  };

  const place = (s: Shown, id: string) => {
    const it = store.get(id);
    if (!it) return remove(id);
    const h = modelOf(it.kind).foot[2] / 1000;
    s.callout.group.position.set(it.pose.x / 1000, Math.min(h, 0.3) + 0.02, it.pose.z / 1000);
  };

  const offTutor = lab.tutor.subscribe((e) => {
    // One instruction at a time: a new step's callout replaces the last step's, wherever it was.
    if (e.kind === 'instruct' || (e.kind === 'praise' && !e.equipmentId)) {
      for (const [id, s] of [...shown]) if (s.event.kind === 'instruct') remove(id);
    }
    // Events about the experiment as a whole go to the panel only.
    if (!e.equipmentId) return;
    const old = shown.get(e.equipmentId);
    // A warning does not push out a hazard on the same item.
    if (old && old.event.kind === 'hazard' && e.kind !== 'hazard' && e.kind !== 'praise' && clock < old.until) return;
    remove(e.equipmentId);
    const callout = createCallout(say(e.text, app.settings.lang.value), { tone: TONE[e.kind], distance: 0.7, shape: 'card', lift: 0.06 });
    callout.group.name = `lab-tutor:${e.equipmentId}`;
    app.bench.table.add(callout.group);
    const s: Shown = { callout, until: clock + SHOW_MS[e.kind], event: e };
    shown.set(e.equipmentId, s);
    place(s, e.equipmentId);
  });

  const offStore = store.subscribe((c) => {
    if (c.type === 'clear') for (const id of [...shown.keys()]) remove(id);
    if (c.type === 'remove') remove(c.id);
    if (c.type === 'move') {
      const s = shown.get(c.id);
      if (s) place(s, c.id);
    }
  });

  const offLang = app.settings.lang.subscribe((l) => {
    for (const s of shown.values()) s.callout.set(say(s.event.text, l));
  });

  const offFrame = onLookFrame(app.world, (dt) => {
    clock += dt * 1000;
    if (shown.size === 0) return;
    for (const [id, s] of shown) {
      if (clock < s.until) continue;
      // A hazard stays up while its mistake still holds.
      if (s.event.kind === 'hazard' && s.event.mistakeId && lab.tutor.active.get(id)?.mistakeId === s.event.mistakeId) continue;
      remove(id);
    }
  });

  return () => {
    offTutor();
    offStore();
    offLang();
    offFrame();
    for (const id of [...shown.keys()]) remove(id);
  };
}

export const tutorModule: FeatureModule = {
  id: 'lab/tutor',
  mount(app) {
    const lab = labOf(app.world);
    if (!lab) return () => undefined;
    return mountTutorCallouts(app, lab);
  },
};
