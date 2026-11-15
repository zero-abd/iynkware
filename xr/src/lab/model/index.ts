/**
 * Lab item models: each item's own state on the clock (flame, temperature, swing) and its mistake rules, in the lab's
 * own store. This module makes the lab's context (store, runner, tutor, feed, inventory: `xr/src/lab/context.ts`),
 * runs its clock every frame while a lab is open, and exposes it at `window.iynkware.lab` for the emulator scripts.
 */
import type { FeatureModule } from '../../contracts/app';
import { onLookFrame } from '../../look/runner';
import { createLabContext, setLabOf } from '../context';

/** Frames longer than this (a tab in the background) advance the lab clock by this much only. */
const MAX_FRAME_MS = 100;

export const modelModule: FeatureModule = {
  id: 'lab/model',
  mount(app) {
    const ctx = createLabContext(() => app.settings.lang.value);
    setLabOf(app.world, ctx);
    const offFrame = onLookFrame(app.world, (dt) => ctx.frame(Math.min(MAX_FRAME_MS, dt * 1000)));
    // `window.iynkware` is set by main.ts after every module has mounted: attach once it exists.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attach = () => {
      const w = (globalThis as { iynkware?: Record<string, unknown> }).iynkware;
      if (w) w.lab = ctx;
      else timer = setTimeout(attach, 100);
    };
    if (typeof window !== 'undefined') attach();
    return () => {
      if (timer) clearTimeout(timer);
      offFrame();
      ctx.dispose();
      setLabOf(app.world, undefined);
    };
  },
};
