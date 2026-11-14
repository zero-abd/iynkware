/**
 * The figures' light, fixed to the bench (never to the head, which would make shadows swim). The ink material reads
 * the sun and the fixed light from each asset's sidecar `look`; every converted figure carries the same two, so they
 * are the bench's too. Directions point towards the light, in the bench frame (+y up, the person at +z).
 *
 *   import { SUN, FIXED_LIGHT, SHADOW_LENGTH, shadowOffset, figureLights } from '../look/light';
 *   const [dx, dz] = shadowOffset();            // where a point 1 m up casts its shadow on the mat, per metre
 *   world.scene.add(...figureLights());         // only for the rare material that is not the ink material
 *
 * The sun sits up and to the right of the person and a little in front, so shadows fall to the left and slightly
 * back: the figures' lower-left shadow, seen from the front.
 */
import { DirectionalLight, HemisphereLight, type Object3D } from '@iwsdk/core';
import { hexNum, PAPER, SHADOW } from './palette';

type V3 = readonly [number, number, number];

/** Towards the sun: the converted figures' `look.sun` (tools/xr-assets sidecars). Bands of outer bodies use it. */
export const SUN: V3 = [0.62558, 0.761939, 0.167624];
/** Towards the fixed light: `look.fixedLight`. Bands of small parts and interiors use it. */
export const FIXED_LIGHT: V3 = [-0.169031, 0.845154, 0.507093];
/** A cast shadow's length as a share of the caster's height (core.js SHADOW_LEN). */
export const SHADOW_LENGTH = 0.45;

/** The ink look's `look` block for things the kit draws itself (the mat, the rail, wires, panels' frames). */
export const BENCH_LOOK = {
  ink: '#231e16',
  paper: PAPER,
  shadow: SHADOW,
  sun: [...SUN] as [number, number, number],
  fixedLight: [...FIXED_LIGHT] as [number, number, number],
  defaultView: [0, 0.5, 0.866] as [number, number, number],
  shadowLength: SHADOW_LENGTH,
};

/** The xz offset of a cast shadow per metre of height above the plane: away from the sun, `SHADOW_LENGTH` long. */
export function shadowOffset(sun: V3 = SUN, length = SHADOW_LENGTH): [number, number] {
  const h = Math.hypot(sun[0], sun[2]);
  return h < 1e-6 ? [0, 0] : [(-sun[0] / h) * length, (-sun[2] / h) * length];
}

/**
 * Lights for the few materials that are not the ink material (three's own, in a third-party model): a warm sky and
 * paper bounce, and a sun along `SUN`. The ink material ignores scene lights, so these cost it nothing.
 */
export function figureLights(): Object3D[] {
  const sky = new HemisphereLight(0xfff6e8, hexNum('#6b6150'), 1.6);
  sky.name = 'look:sky';
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.name = 'look:sun';
  sun.position.set(SUN[0] * 3, SUN[1] * 3, SUN[2] * 3);
  return [sky, sun];
}
