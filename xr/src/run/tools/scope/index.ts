/**
 * The scope: a yellow clip probe on the rack and the screen panel it opens. Clipping the probe on a pin or hole puts a
 * voltage probe on that net in the run and watches its waveform; the panel draws the samples the frames bring (at most
 * 10 times a second), with time and volts per division and Single. Putting the probe back, or lifting it, takes the
 * probe off the run and closes the panel. The run clears its probes when it loads, stops, or starts again from its end,
 * so the probe is added again after every change of the run's state.
 */
import { Group } from '@iwsdk/core';
import type { XrApp } from '../../../contracts/app';
import type { Unsubscribe } from '../../../contracts/common';
import { BANDS, FIGURE_ACCENT, WIRE } from '../../../look/palette';
import { inkSolid, onTick, roundedSlab } from '../../kit';
import type { AnchorIndex } from '../probes/anchors';
import type { NetLookup } from '../probes/netcache';
import { createProbe } from '../probes/probe';
import { followLayout, layoutNow } from '../rack';
import { createScopeScreen, type ScopeKey, type ScreenModel } from './screen';
import {
  createSweep,
  createTraceBuffer,
  DEFAULT_TIME_STEP,
  DEFAULT_VOLT_STEP,
  stepBy,
  TIME_STEPS,
  VOLT_STEPS,
} from './trace';
import type { ScopeReason } from './strings';

/** The probe's id in the run, and the owner of its analog watch. */
export const SCOPE_PROBE = 'run-scope';
export const SCOPE_OWNER = 'run/scope';
/** Samples the run keeps for the probe. */
const CAPACITY = 4096;
/** The screen is redrawn at most this often (10 Hz). */
const DRAW_EVERY_MS = 100;

export function mountScope(app: XrApp, anchors: AnchorIndex, nets: NetLookup): Unsubscribe {
  const screen = createScopeScreen(app);
  app.bench.table.add(screen.panel.group);

  // The probe's base on the rack: a small inked tap the lead plugs into.
  const tap = new Group();
  tap.name = 'run-scope-tap';
  const tapSolid = inkSolid(roundedSlab(0.034, 0.022, 0.016, 0.005), BANDS.mustard.l);
  tap.add(tapSolid.group);
  app.bench.table.add(tap);
  const tapAt = { x: 0, z: 0 };
  const placeTap = (l: ReturnType<typeof layoutNow>) => {
    tapAt.x = l.scopeProbe.position[0];
    tapAt.z = l.scopeProbe.position[2] - 0.098;
    tap.position.set(tapAt.x, 0, tapAt.z);
  };
  const layout = layoutNow(app);
  placeTap(layout);

  let dirty = true;
  let seenIndex: object | null = null;
  const probe = createProbe(
    app,
    anchors,
    {
      id: 'run:scope:probe',
      hex: WIRE.yellow!,
      leadHex: FIGURE_ACCENT,
      rest: (l) => ({ x: l.scopeProbe.position[0], z: l.scopeProbe.position[2] + 0.03, yaw: 0 }),
      jack: (_l, out) => out.set(tapAt.x, 0.012, tapAt.z),
      onChange: () => (dirty = true),
    },
    layout,
  );

  const trace = createTraceBuffer();
  const sweep = createSweep();
  let timeIdx = DEFAULT_TIME_STEP;
  let voltIdx = DEFAULT_VOLT_STEP;
  let nowNs = 0;
  let wired: string | null = null;
  let reason: ScopeReason | null = 'free';
  let drawDirty = true;
  let lastDraw = -Infinity;
  let chain: Promise<void> = Promise.resolve();
  let gone = false;

  /** Puts the probe on the run and watches it; harmless when the run already has it. */
  const register = () => {
    const net = wired;
    if (net === null) return;
    chain = chain
      .then(async () => {
        if (gone || wired !== net) return;
        await app.sim.addProbe({ id: SCOPE_PROBE, kind: 'voltage', target: net, capacity: CAPACITY, envelope: false });
        await app.sim.watchAnalog({ volts: [], amps: [], pinAmps: false, waves: [SCOPE_PROBE] }, SCOPE_OWNER);
      })
      .catch(() => undefined);
  };

  const release = () => {
    if (wired === null) return;
    wired = null;
    trace.clear();
    sweep.reset();
    chain = chain
      .then(async () => {
        await app.sim.removeProbe(SCOPE_PROBE);
        await app.sim.unwatchAnalog(SCOPE_OWNER);
      })
      .catch(() => undefined);
  };

  /** What the probe's place means now: which net it watches, or why it watches none. */
  const sync = () => {
    dirty = false;
    drawDirty = true;
    const t = probe.target;
    // For scripts and tests: whether the panel is meant to be open.
    screen.panel.group.userData.scopeOpen = probe.state === 'clipped' && t !== null;
    if (probe.state !== 'clipped' || t === null) {
      release();
      reason = 'free';
      screen.panel.open(false);
      return;
    }
    screen.panel.open(true);
    const index = nets.current();
    const net = index === null ? null : index.netOf(t);
    reason = index === null ? 'not-loaded' : net === null ? 'no-net' : null;
    if (net === null) {
      release();
      return;
    }
    if (wired !== net) {
      release();
      trace.clear();
      wired = net;
    }
    register();
  };

  const draw = (now: number) => {
    const t = probe.target;
    const model: ScreenModel = {
      lang: app.settings.lang.value,
      where: t ? t.id : null,
      net: wired ? nets.nameOf(wired) : null,
      reason,
      trace,
      endNs: sweep.endNs(nowNs),
      timeIdx,
      voltIdx,
      frozen: sweep.frozen,
    };
    lastDraw = now;
    drawDirty = false;
    screen.draw(model);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < trace.length; i++) {
      const v = trace.valueAt(i);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // For scripts and tests.
    screen.panel.group.userData.scope = { open: screen.panel.isOpen, where: model.where, net: model.net, reason, samples: trace.length, lo, hi, nowNs, timeIdx, voltIdx, frozen: sweep.frozen };
  };

  const key = (k: ScopeKey) => {
    if (k === 't-') timeIdx = stepBy(TIME_STEPS, timeIdx, -1);
    else if (k === 't+') timeIdx = stepBy(TIME_STEPS, timeIdx, 1);
    else if (k === 'v-') voltIdx = stepBy(VOLT_STEPS, voltIdx, -1);
    else if (k === 'v+') voltIdx = stepBy(VOLT_STEPS, voltIdx, 1);
    else sweep.toggle(nowNs);
    drawDirty = true;
    lastDraw = -Infinity;
  };

  const offs: Unsubscribe[] = [
    screen.onKey(key),
    app.sim.onFrame((f) => {
      if (f.atNs < nowNs) {
        // The run started again from the beginning.
        trace.clear();
        sweep.reset();
      }
      nowNs = f.atNs;
      const w = f.analog?.waves?.[SCOPE_PROBE];
      if (w && w.v.length > 0) trace.push(w.fromNs, w.stepNs, w.v, f.analog?.full === true);
      drawDirty = true;
    }),
    // A load, a stop and a restart from the end each clear the run's probes: add it again, and look at the net again.
    app.sim.onState(() => {
      dirty = true;
      register();
    }),
    app.settings.lang.subscribe(() => (drawDirty = true)),
    followLayout(app, (l) => {
      placeTap(l);
      screen.panel.place(l.scopeScreen);
      probe.setLayout(l);
    }),
    onTick(app.world, () => {
      // A new netlist (a load) is a change too: the lookup is a new object then.
      const index = nets.current();
      if (dirty || index !== seenIndex) {
        seenIndex = index;
        sync();
      }
      if (!screen.panel.isOpen) return;
      const now = performance.now();
      if (drawDirty && now - lastDraw >= DRAW_EVERY_MS) draw(now);
    }),
  ];

  return () => {
    gone = true;
    for (const off of offs) off();
    release();
    probe.dispose();
    tapSolid.dispose();
    tap.removeFromParent();
    screen.dispose();
  };
}
