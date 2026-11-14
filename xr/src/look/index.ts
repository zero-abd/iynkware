/**
 * The look kit (the Art lead's folder): iynk's palette, ink, light, motion and effects for every pillar. This module is
 * mounted first (features.ts) and owns what belongs to no pillar: the stage around the bench and the shared motion
 * runner. Pillars import the kit's pieces from `xr/src/look/*`; they never copy colours or easings.
 *
 * The kit, one line each:
 *   palette.ts   INK, PAPER, SHADOW, ACCENT, BANDS (three tone bands per material), WIRE, LED_GLOW, ROOM, STATE
 *   type.ts      TYPE (the dmm type scale), FONT, FONT_MONO, dmm(), scriptOf(), loadFonts(), onFontsReady()
 *   motion.ts    easeIynk, DURATION, SPRINGS, createMotion(): tweens and springs, reduced motion, nothing per frame
 *   runner.ts    motionOf(world), onLookFrame(world, fn): the world's one runner and per-frame hook
 *   moves.ts     dropIn, riseIn, fadeIn, pressTravel, hoverLift, panelOpen, panelClose, drawOn
 *   light.ts     SUN, FIXED_LIGHT, SHADOW_LENGTH, BENCH_LOOK, shadowOffset(), figureLights()
 *   paint.ts     paintPlate, paintPill, paintTag, paintKicker, paintIcon, paintText, fitLines, wrap
 *   icons.ts     ICONS: Phosphor regular glyphs for canvas textures
 *   callout.ts   createCallout(text): ink dot, leader and a cream tag or paper card sized in dmm
 *   stage.ts     the flat page framed like a figure plate
 *   ink.ts       loadInk(), inkKit(): the converted figures' ink material for what the kit draws; paintBands, drawnBox
 *   mat.ts       the inked work mat and front rail
 *   wires.ts     inked jumper wires that draw themselves on
 *   bench.ts     the bench in the look: mat, rail, wires, and parts dropping in, easing and leaving
 *   studio.ts    the paper studio: dome, horizon ring, floor disc and an inked table, for the plain VR space
 *   fx.ts        effectsOf(world): pop and snap rings, spark, heat lines, smoke; one instanced draw per kind
 */
import type { FeatureModule, XrApp } from '../contracts/app';
import { mountBenchLook } from './bench';
import { motionOf, prefersReducedMotion } from './runner';
import { mountStage } from './stage';
import { loadFonts } from './type';

/** Reduced motion: the headset's own setting once it exists (#17), else the 2D app's, else the browser's. */
export function reducedMotionOf(app: Pick<XrApp, 'settings'>): boolean {
  const xr = app.settings.xr.value as unknown as { reducedMotion?: boolean; reduceMotion?: boolean };
  if (typeof xr.reducedMotion === 'boolean') return xr.reducedMotion;
  if (typeof xr.reduceMotion === 'boolean') return xr.reduceMotion;
  const shared = app.settings.shared.value.reduceMotion;
  if (typeof shared === 'boolean') return shared;
  return prefersReducedMotion();
}

export const lookModule: FeatureModule = {
  id: 'look',
  mount(app) {
    void loadFonts();
    const motion = motionOf(app.world);
    const sync = () => {
      motion.reducedMotion = reducedMotionOf(app);
    };
    sync();
    const offXr = app.settings.xr.subscribe(sync);
    const offShared = app.settings.shared.subscribe(sync);
    const offStage = mountStage(app);
    const offBench = mountBenchLook(app);
    return () => {
      offXr();
      offShared();
      offStage();
      offBench();
    };
  },
};
