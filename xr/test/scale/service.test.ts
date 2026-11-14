/** The scale service: steps, view intents, lenses, and the room derived from the session mode and the settings. */
import { describe, expect, it } from 'vitest';
import { Group } from '@iwsdk/core';
import type { XrMode } from '../../src/contracts/app';
import { createScaleService, nearestStep, scaleInternals, stepFrom, WORK_SCALE_STEPS } from '../../src/scale/service';
import { createSettingsStore } from '../../src/shell/settings';
import { value } from '../../src/ui/value';

function make(mode: XrMode = 'mr') {
  const settings = createSettingsStore();
  const m = value<XrMode>(mode);
  const root = new Group();
  const scale = createScaleService({ bench: { root }, settings, mode: m });
  return { scale, settings, mode: m, root };
}

describe('work-scale steps', () => {
  it('are 1, 2, 3, 4, 6', () => {
    expect(WORK_SCALE_STEPS).toEqual([1, 2, 3, 4, 6]);
  });

  it('snaps to the nearest step by ratio', () => {
    expect(nearestStep(3)).toBe(3);
    expect(nearestStep(2.4)).toBe(2);
    expect(nearestStep(5)).toBe(6);
    expect(nearestStep(0.3)).toBe(1);
    expect(nearestStep(40)).toBe(6);
    expect(nearestStep(Number.NaN)).toBe(1);
  });

  it('steps up and down and stays at the ends', () => {
    expect(stepFrom(3, 1)).toBe(4);
    expect(stepFrom(4, 1)).toBe(6);
    expect(stepFrom(6, 1)).toBe(6);
    expect(stepFrom(1, -1)).toBe(1);
    expect(stepFrom(2.9, -1)).toBe(2);
  });

  it('starts at the step nearest the settings and moves with the intents', () => {
    const { scale, settings } = make();
    expect(scale.workScale.value).toBe(nearestStep(settings.xr.value.benchScale));
    scale.setWorkScale(2);
    expect(scale.workScale.value).toBe(2);
    scale.stepWorkScale(1);
    expect(scale.workScale.value).toBe(3);
    scale.stepWorkScale(-1);
    scale.stepWorkScale(-1);
    scale.stepWorkScale(-1);
    expect(scale.workScale.value).toBe(1);
  });
});

describe('view and stage', () => {
  it('enters and leaves Room size, but not while a fade runs', () => {
    const { scale, root } = make();
    expect(scale.view.value).toBe('bench');
    expect(scale.stage.value).toEqual({ kind: 'bench', root });
    scale.enterRoom();
    expect(scale.view.value).toBe('room');
    scaleInternals(scale).setFading(true);
    scale.leaveRoom();
    expect(scale.view.value).toBe('room');
    scaleInternals(scale).setFading(false);
    scale.leaveRoom();
    expect(scale.view.value).toBe('bench');
  });

  it('takes the stage only from its own internals', () => {
    const { scale } = make();
    const copy = new Group();
    scaleInternals(scale).setStage({ kind: 'room', root: copy });
    expect(scale.stage.value.root).toBe(copy);
    expect(() => scaleInternals({} as never)).toThrow();
  });
});

describe('lenses', () => {
  it('clamp to 0..1 and keep the part until told otherwise', () => {
    const { scale } = make();
    scale.setSeeThrough(2, 'cmp_led1');
    expect(scale.seeThrough.value).toEqual({ amount: 1, part: 'cmp_led1' });
    scale.setSeeThrough(0.5);
    expect(scale.seeThrough.value).toEqual({ amount: 0.5, part: 'cmp_led1' });
    scale.setSeeThrough(Number.NaN, null);
    expect(scale.seeThrough.value).toEqual({ amount: 0, part: null });
    scale.setExplode(-1);
    expect(scale.explode.value.amount).toBe(0);
  });

  it('do not notify when nothing changes', () => {
    const { scale } = make();
    let n = 0;
    scale.explode.subscribe(() => n++);
    scale.setExplode(0.3);
    scale.setExplode(0.3);
    expect(n).toBe(1);
  });

  it('flow and the inspector are plain switches', () => {
    const { scale } = make();
    scale.setFlow(true);
    scale.inspect('cmp_r1');
    expect(scale.flow.value).toBe(true);
    expect(scale.inspected.value).toBe('cmp_r1');
  });
});

describe('room', () => {
  it('follows XrSettings.space in an AR session and persists the choice', () => {
    const { scale, settings } = make('mr');
    expect(scale.room.value).toBe('passthrough');
    expect(scale.roomSwitchable.value).toBe(true);
    scale.setRoom('paper');
    expect(settings.xr.value.space).toBe('vr');
    expect(scale.room.value).toBe('paper');
    scale.setRoom('passthrough');
    expect(scale.room.value).toBe('passthrough');
  });

  it('is the paper room, not switchable, in the immersive-vr fallback', () => {
    const { scale, mode, settings } = make('mr');
    mode.set('vr');
    expect(scale.room.value).toBe('paper');
    expect(scale.roomSwitchable.value).toBe(false);
    scale.setRoom('passthrough');
    expect(scale.room.value).toBe('paper');
    expect(settings.xr.value.space).toBe('mr');
  });
});
