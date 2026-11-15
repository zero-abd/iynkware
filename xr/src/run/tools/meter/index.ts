/**
 * The multimeter: the body on the rack, two probes on leads, and the loop that turns where the probes are clipped into
 * a reading. Clipped anchors are kept as anchors (a pin or a hole) and mapped to the run's nets at read time, so a
 * reload or an edit never leaves a stale net behind. The worker is asked at most 4 times a second, only after
 * something changed (a frame, a probe, the mode, the run's state), and never while another ask is in flight.
 */
import { Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../../contracts/app';
import type { Unsubscribe, Vec3 } from '../../../contracts/common';
import type { Reading } from '../../../contracts/sim';
import { BANDS, WIRE } from '../../../look/palette';
import { bindPlate, faceViewer, onTick, runFeedback, textChip, type LoopHandle } from '../../kit';
import type { AnchorIndex } from '../probes/anchors';
import type { NetLookup } from '../probes/netcache';
import type { NetIndex } from '../probes/nets';
import { createProbe, type Probe } from '../probes/probe';
import { followLayout, layoutNow } from '../rack';
import { createMeterBody, BODY_D } from './body';
import { meterStrings as S } from './strings';
import { createGate, lineOf, MODES, planRead, samePlan, settingsFor, shownOf, type MeterMode, type Plan, type Shown } from './logic';

/** Barrel length of a probe and where it rests behind the body. */
const BEHIND = 0.012;
const SIDE = 0.025;

export function mountMeter(app: XrApp, anchors: AnchorIndex, nets: NetLookup): Unsubscribe {
  const lang = () => app.settings.lang.value;
  const body = createMeterBody(app, lang());
  app.bench.table.add(body.group);
  const fb = runFeedback(app);

  const layout = layoutNow(app);
  body.place(layout);

  const make = (side: -1 | 1, id: string, hex: string, leadHex: string): Probe =>
    createProbe(
      app,
      anchors,
      {
        id,
        hex,
        leadHex,
        rest: (l) => ({ x: l.meter.position[0] + side * SIDE, z: l.meter.position[2] - BODY_D / 2 - BEHIND, yaw: 0 }),
        jack: (_l, out) => body.jackOf(side, out),
        onChange: () => (dirty = true),
      },
      layout,
    );

  let dirty = true;
  const red = make(-1, 'run:meter:red', WIRE.red!, WIRE.red!);
  const black = make(1, 'run:meter:black', BANDS.blackPlastic.l, BANDS.blackPlastic.m);

  let mode: MeterMode = 'dc-volts';
  let reading: Reading | null = null;
  let shown: Shown = shownOf(mode, null, lang(), 'free');
  let plan: Plan = { reason: 'free' };
  let stale = true;
  let inFlight = false;
  let seq = 0;
  const gate = createGate();

  // The net lookup is shared with the scope: rebuilt when the run's netlist or the document changes.
  let seenIndex: NetIndex | null = null;

  // What the person sees besides the body: a chip above the red tip, and the beep.
  const chip = textChip({ widthDmm: 250, lines: 2, sizeDmm: 22, distanceM: 0.45, mono: true });
  chip.group.visible = false;
  app.bench.table.add(chip.group);
  let chipKey = '';
  let beep: LoopHandle | null = null;
  const at = new Vector3();
  const tip = new Vector3();
  const beepAt: [number, number, number] = [0, 0, 0];

  const syncPlates = () => {
    for (const m of MODES) body.plates[m].set({ latched: m === mode });
  };

  const showNow = () => {
    body.show({ mode, shown, lang: lang() });
    const l = lang();
    const names = red.target && black.target ? `${red.target.id} / ${black.target.id}` : '';
    const line =
      shown.closed !== null ? (shown.closed ? S.t(l, 'closed') : S.t(l, 'open')) : shown.reason !== null ? '--' : lineOf(shown);
    const key = JSON.stringify([line, names, shown.reason, l]);
    if (key !== chipKey) {
      chipKey = key;
      chip.set({ lines: [line, names || (shown.reason ? S.t(l, shown.reason) : '')], lang: l, tone: shown.reason ? 'warn' : null });
    }
    // For scripts and tests.
    body.group.userData.meter = { mode, text: shown.text, unit: shown.unit, reason: shown.reason, closed: shown.closed, red: red.target, black: black.target, state: [red.state, black.state], beep: beep !== null };
  };

  const stopBeep = () => {
    beep?.stop();
    beep = null;
  };

  const apply = (next: Reading | null, reason: Parameters<typeof shownOf>[3]) => {
    reading = next;
    shown = shownOf(mode, next, lang(), reason);
    if (mode === 'continuity' && shown.closed === true) {
      red.tipWorld(at);
      beepAt[0] = at.x;
      beepAt[1] = at.y;
      beepAt[2] = at.z;
      if (beep) beep.move(beepAt as unknown as Vec3);
      else beep = fb.loop('beep', beepAt as unknown as Vec3);
    } else stopBeep();
    showNow();
  };

  const live = () => app.sim.state !== 'unloaded' && app.sim.state !== 'error';

  const update = () => {
    const now = performance.now();
    if (dirty) {
      dirty = false;
      stale = true;
      const next = planRead(mode, red.target, black.target, nets.current());
      const same = samePlan(plan, next);
      plan = next;
      if (!same) gate.soon();
      if ('reason' in plan) {
        seq++;
        apply(null, plan.reason);
      }
    }
    // A new netlist (a load) is a change too: the lookup is a new object then.
    const index = nets.current();
    if (index !== seenIndex) {
      seenIndex = index;
      dirty = true;
    }
    if (!stale || inFlight || !('probes' in plan) || !live() || !gate.due(now)) return;
    stale = false;
    inFlight = true;
    gate.mark(now);
    const mine = ++seq;
    const askedMode = mode;
    const probes = plan.probes;
    app.sim
      .meter('run:meter', settingsFor(askedMode), probes)
      .then((r) => {
        if (mine === seq && askedMode === mode) apply(r, null);
      })
      .catch(() => {
        if (mine === seq) apply(null, 'refused');
      })
      .finally(() => {
        inFlight = false;
      });
  };

  const offs: Unsubscribe[] = [
    ...MODES.map((m) =>
      bindPlate(app, body.plates[m], `run:meter:${m}`, () => {
        if (mode === m) return;
        mode = m;
        seq++;
        stopBeep();
        syncPlates();
        dirty = true;
        gate.soon();
      }),
    ),
    bindPlate(app, body.plates.back, 'run:meter:back', () => {
      red.putBack();
      black.putBack();
    }),
    app.sim.onFrame(() => {
      stale = true;
    }),
    app.sim.onState(() => {
      stale = true;
      dirty = true;
      gate.soon();
    }),
    app.settings.lang.subscribe(() => {
      body.setLang(lang());
      shown = shownOf(mode, reading, lang(), shown.reason);
      chipKey = '';
      showNow();
    }),
    followLayout(app, (l) => {
      body.place(l);
      red.setLayout(l);
      black.setLayout(l);
    }),
    onTick(app.world, () => {
      update();
      // The chip floats above the red probe's far end once it has left the rack.
      const on = red.state !== 'racked';
      chip.group.visible = on;
      if (on) {
        red.tipLocal(tip);
        chip.group.position.set(tip.x, tip.y + 0.14, tip.z + 0.03);
        faceViewer(chip.group, app.world.camera);
      }
      if (beep) {
        red.tipWorld(at);
        beepAt[0] = at.x;
        beepAt[1] = at.y;
        beepAt[2] = at.z;
        beep.move(beepAt as unknown as Vec3);
      }
    }),
  ];
  syncPlates();
  showNow();

  return () => {
    for (const off of offs) off();
    stopBeep();
    red.dispose();
    black.dispose();
    chip.dispose();
    body.dispose();
  };
}
