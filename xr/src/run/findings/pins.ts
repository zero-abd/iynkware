/**
 * Pins: each finding as a callout on the part (or the pin) it is about, in the look kit's figure style: an ink dot, a
 * leader and a tag whose tone follows the severity. Pins grow in and shrink away with eased motion, stack when several
 * sit on one anchor, follow the part when the bench lays out again, face the person, and are selected by ray or poke.
 */
import { Group, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Lang, Vec3 } from '../../contracts/common';
import { createCallout, type Callout } from '../../look/callout';
import { faceViewer } from '../kit/chip';
import { animated, MOTION, type Animated } from '../kit/motion';
import { onTick } from '../kit/ticker';
import { spotOf } from './heat';
import { stackSlots, toneOf, type PinSpec } from './static';
import { findingStrings, findingTitle } from './strings';

/** How far above its part a tag floats, metres: clear of the lesson's own callouts at 0.05. */
export const BASE_LIFT = 0.16;

export interface PinHooks {
  /** A pin was selected (ray, poke, hands or controllers). */
  onSelect(spec: PinSpec, at: Vec3): void;
}

export interface Pins {
  /** Shows exactly these pins: keeps those it has, adds new ones, shrinks away the rest. */
  set(specs: readonly PinSpec[]): void;
  /** The text of every pin again (the language changed). */
  retitle(): void;
  /** Moves the pins with their parts (the bench laid out again). */
  relayout(): void;
  /** Where a pin's tag ends (its card stands there), world metres, or null. */
  anchorOf(id: string): Vec3 | null;
  readonly ids: readonly string[];
  /** Draw calls of the pins now. */
  readonly drawCalls: number;
  dispose(): void;
}

interface Live {
  spec: PinSpec;
  callout: Callout;
  grow: Animated;
  at: Vec3;
  slot: number;
  leaving: boolean;
  unbind: () => void;
  text: string;
}

/** The short tag of a pin: the title, marked as from the run when it is. */
export function tagOf(lang: Lang, spec: PinSpec): string {
  const S = findingStrings;
  const title = spec.burnt ? S.t(lang, 'burnt', { name: spec.burnt.why.args.name ?? spec.burnt.part }) : findingTitle(lang, spec.finding!);
  return spec.origin === 'static' ? title : `${S.t(lang, 'run-tag')}: ${title}`;
}

/** Where a pin's dot sits: at its pin on the part when the bench knows it, else on top of the part. */
function anchorOf(app: Pick<XrApp, 'bench'>, spec: PinSpec): Vec3 | null {
  const { part, pin } = spec.place;
  if (pin) {
    const at = app.bench.worldOf({ kind: 'pin', part, pin });
    if (at) return at;
  }
  const spot = spotOf(app, part);
  return spot ? [spot.x, spot.y, spot.z] : null;
}

export function createPins(app: XrApp, root: Object3D, hooks: PinHooks): Pins {
  const group = new Group();
  group.name = 'findings:pins';
  root.add(group);
  const live = new Map<string, Live>();
  const lang = () => app.settings.lang.value;

  const lift = (l: Live) => l.callout.setLift(BASE_LIFT + l.slot * (l.callout.height * 1.15 + 0.004));
  /** The top of a pin's tag: where its card stands. */
  const topOf = (l: Live): Vec3 => [l.at[0], l.at[1] + l.callout.lift + l.callout.height, l.at[2]];

  const dispose = (l: Live) => {
    l.unbind();
    l.grow.dispose();
    l.callout.dispose();
  };

  const add = (spec: PinSpec, slot: number): Live | null => {
    const at = anchorOf(app, spec);
    if (!at) return null;
    const callout = createCallout(tagOf(lang(), spec), { tone: toneOf(spec.severity), shape: 'tag', distance: 0.65, lift: BASE_LIFT });
    callout.group.position.set(at[0], at[1], at[2]);
    callout.group.scale.setScalar(0.001);
    group.add(callout.group);
    const grow = animated(app, 0, (v) => callout.group.scale.setScalar(Math.max(0.001, v)));
    grow.to(1, MOTION.state);
    const label = callout.group.getObjectByName('look:callout-label');
    const l: Live = { spec, callout, grow, at, slot, leaving: false, unbind: () => undefined, text: tagOf(lang(), spec) };
    if (label) {
      l.unbind = app.input.bind(label, { id: `finding:${spec.id}`, ray: true, poke: true }, (e) => {
        if (e.type === 'select' && !l.leaving) hooks.onSelect(l.spec, topOf(l));
      });
    }
    lift(l);
    return l;
  };

  const off = onTick(app.world, () => {
    for (const [id, l] of live) {
      faceViewer(l.callout.group, app.world.camera, 0);
      if (l.leaving && l.grow.value <= 0.01) {
        dispose(l);
        live.delete(id);
      }
    }
  });

  return {
    set(specs) {
      const keep = new Set(specs.map((s) => s.id));
      const slots = stackSlots(specs);
      for (const [id, l] of live) {
        if (keep.has(id) || l.leaving) continue;
        l.leaving = true;
        l.unbind();
        l.unbind = () => undefined;
        l.grow.to(0, MOTION.state);
      }
      for (const spec of specs) {
        const had = live.get(spec.id);
        const slot = slots.get(spec.id) ?? 0;
        if (had && !had.leaving) {
          had.spec = spec;
          if (had.slot !== slot) {
            had.slot = slot;
            lift(had);
          }
          continue;
        }
        if (had) {
          dispose(had);
          live.delete(spec.id);
        }
        const made = add(spec, slot);
        if (made) live.set(spec.id, made);
      }
    },
    retitle() {
      for (const l of live.values()) {
        const text = tagOf(lang(), l.spec);
        if (text === l.text) continue;
        l.text = text;
        l.callout.set(text);
        lift(l);
      }
    },
    relayout() {
      for (const l of live.values()) {
        const at = anchorOf(app, l.spec);
        if (!at) continue;
        l.at = at;
        l.callout.group.position.set(at[0], at[1], at[2]);
      }
    },
    anchorOf(id) {
      const l = live.get(id);
      return l ? topOf(l) : null;
    },
    get ids() {
      return [...live].filter(([, l]) => !l.leaving).map(([id]) => id);
    },
    get drawCalls() {
      return live.size * 3;
    },
    dispose() {
      off();
      for (const l of live.values()) dispose(l);
      live.clear();
      group.removeFromParent();
    },
  };
}
