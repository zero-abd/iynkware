/**
 * The drone's motor sound in the Range: a synthesized hum (no file, nothing fetched) that starts when the craft is
 * armed, rises in pitch and loudness with the motor command and stops on disarm, crash or leaving the Range. It follows
 * the headset sound switch and the simulation bus volume. The AudioContext is made and resumed on the arm frame (the
 * arm press is the user gesture); the nodes exist only while armed, and the per-frame work is three AudioParam sets.
 */
import type { FeatureModule, XrApp } from '../../../contracts/app';
import { onLookFrame } from '../../shared';
import { flightSceneOf, type FlightScene } from '../scene';
import { motorGain, motorHz } from './model';

interface Hum {
  readonly oscs: OscillatorNode[];
  readonly gain: GainNode;
}

export const motorModule: FeatureModule = {
  id: 'range/flight/motor',
  mount(app) {
    let current: { dispose(): void } | null = null;
    const sync = (scene: FlightScene | null) => {
      current?.dispose();
      current = scene ? openMotor(app, scene) : null;
    };
    const off = flightSceneOf(app).subscribe(sync);
    sync(flightSceneOf(app).value);
    return () => {
      off();
      current?.dispose();
      current = null;
    };
  },
};

function openMotor(app: XrApp, scene: FlightScene): { dispose(): void } {
  let ctx: AudioContext | null = null;
  let failed = false;
  let hum: Hum | null = null;

  const start = (c: AudioContext): Hum => {
    const gain = c.createGain();
    gain.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(gain).connect(c.destination);
    // a saw and a detuned saw an octave up: a buzzy electric whine
    const oscs = [1, 2.01].map((m) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = motorHz(0) * m;
      o.connect(lp);
      o.start();
      return o;
    });
    return { oscs, gain };
  };
  const stop = () => {
    if (!hum) return;
    const h = hum;
    hum = null;
    try {
      h.gain.gain.value = 0;
      for (const o of h.oscs) o.stop();
      h.gain.disconnect();
    } catch {
      /* already stopped */
    }
  };

  const off = onLookFrame(app.world, () => {
    const f = scene.runner.frame;
    const xr = app.settings.xr.value;
    const gain = motorGain(f.thr, f.armed, f.crashed, xr.sound, xr.volumes.simulation);
    if (gain <= 0) return stop();
    if (!hum) {
      if (failed) return;
      try {
        ctx ??= new AudioContext();
        if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
        hum = start(ctx);
      } catch {
        failed = true;
        return;
      }
    }
    const t = ctx!.currentTime;
    const hz = motorHz(f.thr);
    hum.oscs[0]!.frequency.setTargetAtTime(hz, t, 0.05);
    hum.oscs[1]!.frequency.setTargetAtTime(hz * 2.01, t, 0.05);
    hum.gain.gain.setTargetAtTime(gain, t, 0.05);
  });

  // for scripts and tests: is the hum running, and at what pitch and level
  scene.root.userData.motor = () => ({ running: !!hum, state: ctx?.state ?? 'none', hz: hum?.oscs[0]?.frequency.value ?? 0, gain: hum?.gain.gain.value ?? 0 });

  return {
    dispose() {
      off();
      stop();
      void ctx?.close().catch(() => undefined);
      ctx = null;
      delete scene.root.userData.motor;
    },
  };
}
