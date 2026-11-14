/**
 * Generic health for every part (docs/XR_DESIGN.md section 4): a hot part's materials ease towards the palette's warm
 * state tone, a burnt part's to char and its motion freezes; reset gives the original colours back. The host applies it
 * to every view that has no `health` of its own. Heat lines, smoke, sizzle and callouts are the findings module's.
 *
 * A placement's meshes share geometry and, mostly, materials with every other placement of the same part, so the first
 * tint gives each mesh its own clone of its material and the last (reset, dispose) puts the shared one back.
 */
import { Color, type Material, type Mesh, type Object3D } from '@iwsdk/core';
import type { PartHealth } from '../../contracts/part-view';
import { CHAR, TONE_FILL, hexNum } from '../../look/palette';
import { easeIynk } from '../../look/motion';

/** How far towards the warm tone a hot part goes (1 would be the tone itself): the part stays itself. */
export const HOT_AMOUNT = 0.55;
/** Seconds to ease from one look to the next. */
export const TINT_S = 0.45;

/** The two targets of the tint: how warm, and how charred, 0..1 each. */
export interface Tint {
  warm: number;
  char: number;
}

/** The targets for a health: ok none, hot warm, burnt char. `reversed` is the wiring's, not the part's: no tint. */
export function tintTarget(health: PartHealth): Tint {
  return health === 'hot' ? { warm: HOT_AMOUNT, char: 0 } : health === 'burnt' ? { warm: 0, char: 1 } : { warm: 0, char: 0 };
}

/** Moves `value` towards `target` at `1 / seconds` a second, never past it. */
export function approach(value: number, target: number, dtSeconds: number, seconds = TINT_S): number {
  const step = Math.max(0, dtSeconds) / seconds;
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}

/** Whether a health freezes the part's motion. */
export const freezes = (health: PartHealth): boolean => health === 'burnt';

const WARM = new Color(hexNum(TONE_FILL.warn));
const BURNT = new Color(hexNum(CHAR));

interface Slot {
  mesh: Mesh;
  original: Material | Material[];
  /** The clone this slot paints, once there is one. */
  own: Material | Material[] | null;
  /** The original colours of each material, to ease from. */
  base: Color[];
}

export interface GenericHealth {
  /** A new latch. Returns whether the part's motion must freeze. */
  set(health: PartHealth): boolean;
  /** Eases the tint; call every frame while a tint is moving (`moving` says so). */
  tick(dtSeconds: number): void;
  readonly moving: boolean;
  /** Back to the original colours and materials at once. */
  reset(): void;
  dispose(): void;
}

const tmp = new Color();

function materialsOf(m: Material | Material[]): Material[] {
  return Array.isArray(m) ? m : [m];
}
const colourOf = (m: Material): Color | undefined => ((m as Material & { color?: Color }).color instanceof Color ? (m as Material & { color: Color }).color : undefined);

export function createGenericHealth(object: Object3D, reduced: () => boolean): GenericHealth {
  const slots: Slot[] = [];
  let collected = false;
  let target: Tint = { warm: 0, char: 0 };
  let tint: Tint = { warm: 0, char: 0 };

  const collect = () => {
    if (collected) return;
    collected = true;
    object.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      // The screen of a display is lit pixels, not paint: it is not part of the colour of the part.
      if (mesh.name === 'screen') return;
      slots.push({ mesh, original: mesh.material, own: null, base: [] });
    });
  };
  const own = (slot: Slot) => {
    if (slot.own) return;
    const clone = Array.isArray(slot.original) ? slot.original.map((m) => m.clone()) : slot.original.clone();
    slot.own = clone;
    slot.base = materialsOf(clone).map((m) => colourOf(m)?.clone() ?? new Color(1, 1, 1));
    slot.mesh.material = clone;
  };
  const release = () => {
    for (const slot of slots) {
      if (!slot.own) continue;
      slot.mesh.material = slot.original;
      for (const m of materialsOf(slot.own)) m.dispose();
      slot.own = null;
      slot.base = [];
    }
  };
  const paint = () => {
    if (tint.warm === 0 && tint.char === 0) {
      release();
      return;
    }
    const w = easeIynk(tint.warm);
    const c = easeIynk(tint.char);
    for (const slot of slots) {
      own(slot);
      materialsOf(slot.own!).forEach((m, i) => {
        const col = colourOf(m);
        if (!col) return;
        col.copy(slot.base[i]!);
        if (w > 0) col.lerp(tmp.copy(WARM).multiply(slot.base[i]!).lerp(WARM, 0.5), w);
        if (c > 0) col.lerp(BURNT, c);
      });
    }
  };

  return {
    set(health) {
      collect();
      target = tintTarget(health);
      if (reduced()) {
        tint = { ...target };
        paint();
      }
      return freezes(health);
    },
    tick(dt) {
      if (tint.warm === target.warm && tint.char === target.char) return;
      tint.warm = approach(tint.warm, target.warm, dt);
      tint.char = approach(tint.char, target.char, dt);
      paint();
    },
    get moving() {
      return tint.warm !== target.warm || tint.char !== target.char;
    },
    reset() {
      target = { warm: 0, char: 0 };
      tint = { warm: 0, char: 0 };
      release();
    },
    dispose() {
      target = { warm: 0, char: 0 };
      tint = { warm: 0, char: 0 };
      release();
      slots.length = 0;
    },
  };
}
