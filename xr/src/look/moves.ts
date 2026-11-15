/**
 * The named moves, so every pillar moves things the same iynk way: parts drop in and settle, wires draw themselves on,
 * buttons travel when pressed, plates lift under hover, panels scale in and out. Each move is keyed on its object, so a
 * new move of the same kind replaces the running one instead of fighting it. Reduced motion is honoured by the runner.
 *
 *   import { dropIn, drawOn, pressTravel, hoverLift, panelOpen, panelClose, fadeIn } from '../look/moves';
 *   dropIn(app.world, partObject);                    // falls 6 cm onto the mat, squashes, settles
 *   drawOn(app.world, wireMesh);                      // the tube grows from its first end to its second
 *   pressTravel(app.world, cap, 0.003, true);         // 3 mm down; false springs it back
 *   hoverLift(app.world, plate, 0.003, true);         // lifts towards the viewer (+z of the plate)
 *   panelOpen(app.world, panel, (a) => setPanelOpacity(a));
 *   fadeIn(app.world, (a) => mat.uniforms.uOpacity.value = a, { ms: 400 });
 */
import type { Mesh, Object3D, World } from '@iwsdk/core';
import { DURATION, easeIynk, linear, type Ease } from './motion';
import { motionOf } from './runner';

/** Ease-in for a fall (gravity-like): slow at the top, fast at the bottom. */
const fall: Ease = (t) => t * t;

interface Rest {
  y: number;
  z: number;
  scale: number;
  sy: number;
}
const restOf = (o: Object3D): Rest => {
  let r = o.userData.lookRest as Rest | undefined;
  if (!r) {
    r = { y: o.position.y, z: o.position.z, scale: o.scale.x, sy: o.scale.y };
    o.userData.lookRest = r;
  }
  return r;
};
/** Forget the rest pose (call after moving an object on purpose, so the next move starts from where it is now). */
export const resetRest = (o: Object3D): void => {
  delete o.userData.lookRest;
};

const key = (o: Object3D, kind: string) => {
  let k = o.userData.lookKeys as Record<string, object> | undefined;
  if (!k) {
    k = {};
    o.userData.lookKeys = k;
  }
  return (k[kind] ??= {});
};

/**
 * A part arriving: it falls `height` metres (in its parent's frame) onto where it is now, squashes 6 % on landing and
 * settles with one small bounce. Its origin must be on its base (the asset frame's y = 0), so it never sinks into the
 * mat. `delay` staggers several parts (60 ms apart reads like the site's stagger-in).
 */
export function dropIn(world: World, o: Object3D, opts: { height?: number; delay?: number; onDone?: () => void } = {}): void {
  const m = motionOf(world);
  const rest = restOf(o);
  const h = opts.height ?? 0.06;
  o.position.y = rest.y + (m.reducedMotion ? 0 : h);
  m.tween({
    key: key(o, 'drop'),
    ms: DURATION.dropIn * 0.6,
    delay: opts.delay ?? 0,
    ease: fall,
    onUpdate: (k) => {
      o.position.y = rest.y + h * (1 - k);
    },
    onDone: () => {
      if (m.reducedMotion) {
        opts.onDone?.();
        return;
      }
      m.spring({
        key: key(o, 'squash'),
        from: 0.94,
        to: 1,
        velocity: -1.2,
        preset: 'wobble',
        onUpdate: (s) => {
          o.scale.y = rest.sy * s;
          const spread = 1 + (1 - s) * 0.4;
          o.scale.x = rest.scale * spread;
          o.scale.z = rest.scale * spread;
        },
        onDone: () => {
          o.scale.set(rest.scale, rest.sy, rest.scale);
          opts.onDone?.();
        },
      });
    },
  });
}

/** The bench arriving (XR_DESIGN.md 2.4): fades in over 400 ms while rising 0.03 m into place. */
export function riseIn(world: World, o: Object3D, setOpacity: (a: number) => void, opts: { rise?: number; ms?: number } = {}): void {
  const m = motionOf(world);
  const rest = restOf(o);
  const rise = opts.rise ?? 0.03;
  m.tween({
    key: key(o, 'rise'),
    ms: opts.ms ?? DURATION.benchIn,
    onUpdate: (k) => {
      o.position.y = rest.y - rise * (1 - k);
      setOpacity(k);
    },
  });
}

/** A fade of anything (an opacity setter), eased; `to` 1 by default. */
export function fadeIn(
  world: World,
  setOpacity: (a: number) => void,
  opts: { ms?: number; from?: number; to?: number; key?: object; onDone?: () => void } = {},
): void {
  const from = opts.from ?? 0, to = opts.to ?? 1;
  motionOf(world).tween({
    key: opts.key,
    ms: opts.ms ?? DURATION.fade,
    onUpdate: (k) => setOpacity(from + (to - from) * k),
    onDone: opts.onDone,
  });
}

/** A button cap or plate travelling `depth` metres down its own -y while held (`down`), springing back when let go. */
export function pressTravel(world: World, o: Object3D, depth: number, down: boolean, axis: 'y' | 'z' = 'y'): void {
  const m = motionOf(world);
  const rest = restOf(o);
  const base = axis === 'y' ? rest.y : rest.z;
  const from = o.position[axis];
  if (down) {
    m.tween({
      key: key(o, 'press'),
      ms: DURATION.press,
      ease: linear,
      onUpdate: (k) => {
        o.position[axis] = from + (base - depth - from) * k;
      },
    });
  } else {
    m.spring({
      key: key(o, 'press'),
      from,
      to: base,
      preset: 'snappy',
      onUpdate: (x) => {
        o.position[axis] = x;
      },
    });
  }
}

/** A plate lifting `lift` metres towards the viewer under hover (its own +z for a panel, +y for a cap), and back. */
export function hoverLift(world: World, o: Object3D, lift: number, on: boolean, axis: 'y' | 'z' = 'z'): void {
  const m = motionOf(world);
  const rest = restOf(o);
  const base = axis === 'y' ? rest.y : rest.z;
  const from = o.position[axis];
  if (on) {
    m.spring({
      key: key(o, 'hover'),
      from,
      to: base + lift,
      preset: 'snappy',
      onUpdate: (x) => {
        o.position[axis] = x;
      },
    });
  } else {
    m.tween({
      key: key(o, 'hover'),
      ms: DURATION.hoverOff,
      onUpdate: (k) => {
        o.position[axis] = from + (base - from) * k;
      },
    });
  }
}

/**
 * Whether pointer rays and pokes may hit `o` and everything under it. three's raycaster ignores `visible`, so a hidden
 * panel would otherwise keep swallowing rays meant for what is behind it: hidden panels are `pointerEvents: 'none'`
 * (inherited by every child). Showing it clears the override.
 */
type PointerObject = Object3D & { pointerEvents?: 'none' | 'auto' | 'listener' };
const panelPointerRest = new WeakMap<Object3D, PointerObject['pointerEvents']>();

export function setPanelHit(o: Object3D, on: boolean): void {
  o.traverse((child) => {
    const p = child as PointerObject;
    if (on) {
      if (!panelPointerRest.has(child)) return;
      const rest = panelPointerRest.get(child);
      panelPointerRest.delete(child);
      p.pointerEvents = rest;
      return;
    }
    if (!panelPointerRest.has(child)) panelPointerRest.set(child, p.pointerEvents);
    p.pointerEvents = 'none';
  });
}

/** A panel opening: scales in from 0.96 and fades in over 300 ms (the site's scale-in). */
export function panelOpen(world: World, o: Object3D, setOpacity?: (a: number) => void, onDone?: () => void): void {
  const rest = restOf(o);
  o.visible = true;
  setPanelHit(o, true);
  motionOf(world).tween({
    key: key(o, 'panel'),
    ms: DURATION.panelOpen,
    onUpdate: (k) => {
      o.scale.setScalar(rest.scale * (0.96 + 0.04 * k));
      setOpacity?.(k);
    },
    onDone,
  });
}

/** A panel closing: shrinks to 0.96 and fades out over 200 ms, then hides. */
export function panelClose(world: World, o: Object3D, setOpacity?: (a: number) => void, onDone?: () => void): void {
  const rest = restOf(o);
  // A closing panel is already gone for interaction purposes. Leaving its children hittable during the 200 ms
  // scale-out lets an old Home control steal the trigger intended for the Menu that just opened in the same place.
  setPanelHit(o, false);
  motionOf(world).tween({
    key: key(o, 'panel'),
    ms: DURATION.panelClose,
    onUpdate: (k) => {
      o.scale.setScalar(rest.scale * (1 - 0.04 * k));
      setOpacity?.(1 - k);
    },
    onDone: () => {
      o.visible = false;
      o.scale.setScalar(rest.scale);
      onDone?.();
    },
  });
}

/**
 * A wire drawing itself from its first end to its second: the mesh's draw range grows over `ms`. Works for any
 * indexed geometry laid out along its length (three's TubeGeometry is); `step` rounds the range to whole rings.
 */
export function drawOn(world: World, mesh: Mesh, opts: { ms?: number; step?: number; delay?: number } = {}): void {
  const g = mesh.geometry;
  const total = g.index ? g.index.count : g.attributes.position!.count;
  const step = Math.max(1, opts.step ?? 1);
  g.setDrawRange(0, 0);
  motionOf(world).tween({
    key: key(mesh, 'draw'),
    ms: opts.ms ?? DURATION.drawOn,
    delay: opts.delay,
    ease: easeIynk,
    onUpdate: (k) => {
      const n = k >= 1 ? total : Math.floor((total * k) / step) * step;
      g.setDrawRange(0, n >= total ? Infinity : n);
    },
  });
}
