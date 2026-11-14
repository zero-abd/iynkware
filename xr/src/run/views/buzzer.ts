/**
 * The buzzer view: a square tone at the part, at the pitch the simulation reports, for as long as it is on. The run
 * kit's feedback owns the audio context and respects the sound setting. The tone changes pitch in place, goes quiet
 * while the run is paused, and is stopped on off, reset and dispose.
 */
import type { XrApp } from '../../contracts/app';
import type { Vec3 } from '../../contracts/common';
import type { PartState, PartView, PartViewFactory } from '../../contracts/part-view';
import { runFeedback, type ToneHandle } from '../kit/feedback';
import { Vector3 } from '@iwsdk/core';

/** The pitch to sound for a buzzer state: 0 (silence) when it is off or reports no pitch. */
export function toneHz(state: { on: boolean; hz: number }): number {
  return state.on && Number.isFinite(state.hz) && state.hz > 0 ? state.hz : 0;
}

export function buzzerView(app: XrApp): PartViewFactory {
  return (ctx): PartView => {
    let tone: ToneHandle | null = null;
    let hz = 0;
    let paused = app.sim.state === 'paused';
    const where = (): Vec3 => {
      const p = ctx.object.getWorldPosition(new Vector3());
      return [p.x, p.y, p.z];
    };
    const stop = () => {
      tone?.stop();
      tone = null;
    };
    const sync = () => {
      const want = paused ? 0 : hz;
      if (want === 0) {
        tone?.set(0);
        return;
      }
      if (!tone) tone = runFeedback(app).tone(want, where());
      else tone.set(want);
    };
    const off = app.sim.onState((s) => {
      const next = s === 'paused';
      if (next === paused) return;
      paused = next;
      sync();
    });
    return {
      partId: ctx.partId,
      update(state: PartState) {
        if (state.kind !== 'buzzer') return;
        const next = toneHz(state);
        if (next === hz) return;
        hz = next;
        if (hz === 0) {
          // Off: stop for good, so a silent buzzer holds no oscillator.
          stop();
          return;
        }
        sync();
      },
      reset() {
        hz = 0;
        stop();
      },
      dispose() {
        off();
        hz = 0;
        stop();
      },
    };
  };
}
