/**
 * The scale service (contracts/scale.ts): state and intents only. The sub-modules of `xr/src/scale` realise them: zoom
 * animates the bench to `workScale`, room fades to and from Room size and sets the stage, insight applies the lenses,
 * flow draws current and voltages, probe opens the inspector, space draws the paper room. Nothing here touches the
 * scene, so the service works (and is tested) without a renderer.
 */
import type { XrMode } from '../contracts/app';
import type { ReadonlyValue } from '../contracts/common';
import type { LensSetting, RoomKind, ScaleService, ScaleStage } from '../contracts/scale';
import type { SettingsStore } from '../contracts/settings';
import type { ShellService } from '../contracts/shell';
import type { BenchSpace } from '../contracts/space';
import { value } from '../ui/value';

/** The bench's work-scale steps (docs/XR_DESIGN.md 3.4 and 8.1). */
export const WORK_SCALE_STEPS: readonly number[] = Object.freeze([1, 2, 3, 4, 6]);

/** The step nearest `scale` by ratio (5 goes to 6, 2.4 to 2), so a step is as far in either direction. */
export function nearestStep(scale: number, steps: readonly number[] = WORK_SCALE_STEPS): number {
  if (!Number.isFinite(scale) || scale <= 0) return steps[0]!;
  let best = steps[0]!;
  let bestDist = Infinity;
  for (const s of steps) {
    const d = Math.abs(Math.log(scale / s));
    if (d < bestDist - 1e-9) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

/** The step `delta` steps from the one nearest `scale`, clamped to the ends. */
export function stepFrom(scale: number, delta: number, steps: readonly number[] = WORK_SCALE_STEPS): number {
  const i = steps.indexOf(nearestStep(scale, steps));
  return steps[Math.max(0, Math.min(steps.length - 1, i + Math.trunc(delta)))]!;
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** What only the pillar's own sub-modules set: the stage (room) and the fade flag (room, space). */
export interface ScaleInternals {
  setStage(stage: ScaleStage): void;
  setFading(fading: boolean): void;
}

const internals = new WeakMap<ScaleService, ScaleInternals>();

/** The setters behind a service made by `createScaleService`. For `xr/src/scale/*` only. */
export function scaleInternals(service: ScaleService): ScaleInternals {
  const i = internals.get(service);
  if (!i) throw new Error('scale: not a service made by createScaleService');
  return i;
}

export interface ScaleServiceOptions {
  bench: Pick<BenchSpace, 'root'>;
  settings: SettingsStore;
  mode: ReadonlyValue<XrMode>;
  /** Room size is the shell's `room` place: the view follows `place`, and the intents go through `go`. */
  shell: Pick<ShellService, 'place' | 'go'>;
}

export function createScaleService(opts: ScaleServiceOptions): ScaleService {
  const { settings, mode, shell } = opts;
  const workScale = value(nearestStep(settings.xr.value.benchScale));
  const viewOf = (): 'bench' | 'room' => (shell.place.value === 'room' ? 'room' : 'bench');
  const view = value<'bench' | 'room'>(viewOf());
  shell.place.subscribe(() => view.set(viewOf()));
  const fading = value(false);
  const stage = value<ScaleStage>({ kind: 'bench', root: opts.bench.root });
  const seeThrough = value<LensSetting>({ amount: 0, part: null });
  const explode = value<LensSetting>({ amount: 0, part: null });
  const flow = value(false);
  const inspected = value<string | null>(null);
  const inspecting = value(false);

  const roomOf = (): RoomKind => (mode.value === 'vr' || settings.xr.value.space === 'vr' ? 'paper' : 'passthrough');
  const room = value<RoomKind>(roomOf());
  const roomSwitchable = value(mode.value !== 'vr');
  const derive = () => {
    room.set(roomOf());
    roomSwitchable.set(mode.value !== 'vr');
  };
  mode.subscribe(derive);
  settings.xr.subscribe(derive);

  const lens = (current: LensSetting, amount: number, part: string | null | undefined): LensSetting => {
    const next = { amount: clamp01(amount), part: part === undefined ? current.part : part };
    return next.amount === current.amount && next.part === current.part ? current : next;
  };

  const service: ScaleService = {
    steps: WORK_SCALE_STEPS,
    workScale,
    setWorkScale: (scale) => workScale.set(nearestStep(scale)),
    stepWorkScale: (delta) => workScale.set(stepFrom(workScale.value, delta)),
    view,
    fading,
    stage,
    enterRoom() {
      if (!fading.value && shell.place.value !== 'room') shell.go('room');
    },
    leaveRoom() {
      if (!fading.value && shell.place.value === 'room') shell.go('bench');
    },
    seeThrough,
    setSeeThrough: (amount, part) => seeThrough.set(lens(seeThrough.value, amount, part)),
    explode,
    setExplode: (amount, part) => explode.set(lens(explode.value, amount, part)),
    flow,
    setFlow: (on) => flow.set(on),
    inspected,
    inspect: (part) => inspected.set(part),
    inspecting,
    setInspecting: (on) => inspecting.set(on),
    room,
    roomSwitchable,
    setRoom(next) {
      if (!roomSwitchable.value) return;
      const space = next === 'paper' ? 'vr' : 'mr';
      if (settings.xr.value.space !== space) settings.setXr({ space });
    },
  };
  internals.set(service, {
    setStage: (s) => stage.set(s),
    setFading: (f) => fading.set(f),
  });
  return service;
}
