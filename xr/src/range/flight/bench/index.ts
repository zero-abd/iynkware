/**
 * The drone bench in the room (issue #121): the converted drone on the bench with only the parts that are on, a plate
 * per part in build order (fit, fit turned round, take off), the bench actions (Build it for me, Strip, Battery, Smoke
 * stopper, Motor test, Calibrate), the motors' phase leads while the wires are on, and what the bench says as a callout.
 * The model (`../model`) decides everything and finishes tests at once; this file draws the state it stores in the
 * project document and animates the tests. Deferred: the wiring sheet and the design panel (#164).
 */
import { Group, SphereGeometry } from '@iwsdk/core';
import type { DroneContent } from '@/content/schema';
import { loadDrone as loadDroneContent } from '@/content/index.generated';

type DroneId = Parameters<typeof loadDroneContent>[0];
import type { XrApp, FeatureModule } from '../../../contracts/app';
import type { Lang } from '../../../contracts/common';
import { rangeOf } from '../../activate';
import {
  bindPlate,
  createCallout,
  dropIn,
  fadeIn,
  inkSolid,
  loadDrone,
  onLookFrame,
  plateButton,
  type Callout,
  type DroneHandle,
  type Plate,
} from '../../shared';
import { applyBench, benchCraft, benchOf, benchOps, loadFigureText, benchText, pickOf, wrongMotors } from '../model';
import type { BenchAction, BenchCraft, BenchMessage, BenchState, FigureText } from '../model';
import { benchFocusOf } from '../focus';
import { BENCH_STRINGS as S } from './strings';
import { benchView, lastSay, motorSequence, panelCells, toneOf, type SpinStep } from './view';

/** The drone's place on the bench top, and its size against real (a 5-inch quad is small to work on). */
const DRONE_AT = { x: 0, z: -0.04 };
const DRONE_SCALE = 1.25;
/** Seconds the bench's callout stays, and how long it takes to fade. */
const SAY_S = 5;
const SAY_FADE_S = 0.6;
/** A part that goes on flashes this long. */
const FLASH_S = 0.6;
/** How long a part the crash card named stays picked out. */
const FOCUS_S = 4;
const SMOKE_S = 0.9;
const MOTOR_S = 0.8;

const PART_PLATE = { w: 0.1, d: 0.044, distanceM: 0.8, standing: true } as const;
const TURN_PLATE = { w: 0.1, d: 0.026, distanceM: 0.8, standing: true } as const;
const PANEL_Z = -0.235;
const PANEL_LEAN = 0.5;
const ACTION_COLS = [0.256, 0.328, 0.4] as const;
const ACTION_ROWS = [0.04, 0.13] as const;

type Anim =
  | { kind: 'motors'; t: number; steps: SpinStep[]; length: number; active: number; say: Pending | null }
  | { kind: 'smoke'; t: number; short: boolean; say: Pending | null };

interface Pending {
  readonly text: string;
  readonly tone: 'pass' | 'fail';
}

interface Session {
  dispose(): void;
}

async function openSession(app: XrApp, contentId: string, craft: BenchCraft, isLive: () => boolean): Promise<Session | null> {
  const [drone, content, text0] = await Promise.all([
    loadDrone(contentId),
    loadDroneContent(contentId as DroneId),
    loadFigureText(app.settings.lang.value),
  ]);
  if (!isLive()) {
    drone?.dispose();
    return null;
  }
  if (!drone) {
    console.warn(`range bench: the converted drone ${contentId} is not available, nothing drawn`);
    return null;
  }
  return createSession(app, craft, drone, content, text0);
}

function createSession(app: XrApp, craft: BenchCraft, drone: DroneHandle, content: DroneContent | null, text0: FigureText): Session {
  const lang = (): Lang => app.settings.lang.value;
  let text = text0;
  const root = new Group();
  root.name = 'range-bench';
  app.bench.table.add(root);

  // The drone, nose away from the person (the craft's nose is +z).
  const rig = new Group();
  rig.name = 'range-bench-drone';
  rig.position.set(DRONE_AT.x, 0, DRONE_AT.z);
  rig.rotation.y = Math.PI;
  rig.scale.setScalar(DRONE_SCALE);
  rig.add(drone.object);
  root.add(rig);
  const droneParts = drone.sidecar.parts.map((p) => p.id).filter((id) => id !== '');

  // The part plates, standing behind the drone.
  const panel = new Group();
  panel.name = 'range-bench-parts';
  panel.position.z = PANEL_Z;
  root.add(panel);
  const cells = panelCells(craft.parts.length, 5, 0.108, 0.09, 0.055);
  const offs: Array<() => void> = [];
  // For scripts and tests: every plate's hit mesh by its input id.
  const hits: Record<string, unknown> = {};
  root.userData.hits = hits;
  root.userData.drone = drone;
  const bind = (plate: Plate, id: string, fn: () => void) => {
    hits[id] = plate.hit;
    offs.push(bindPlate(app, plate, id, fn));
  };
  const plates: Plate[] = [];
  const mk = (size: Parameters<typeof plateButton>[1], look: Parameters<typeof plateButton>[2]) => {
    const p = plateButton(app, size, look);
    plates.push(p);
    return p;
  };
  const partPlates = craft.parts.map((part, i) => {
    const cell = cells[i]!;
    const pivot = new Group();
    pivot.position.set(cell.x, cell.y, 0);
    pivot.rotation.x = -PANEL_LEAN;
    panel.add(pivot);
    const main = mk(PART_PLATE, { icon: null, label: part.short, lang: lang() });
    main.group.position.y = part.polar ? 0.016 : 0;
    pivot.add(main.group);
    let turn: Plate | null = null;
    if (part.polar) {
      turn = mk(TURN_PLATE, { icon: null, label: S.t(lang(), 'fitTurned'), lang: lang() });
      turn.group.position.y = -0.03;
      pivot.add(turn.group);
    }
    bind(main, `bench:part:${part.id}`, () => {
      const on = Object.hasOwn(benchOf(app.project.doc).placed, part.id);
      act(on ? { type: 'remove', part: part.id } : { type: 'add', part: part.id });
    });
    if (turn)
      bind(turn, `bench:turn:${part.id}`, () => {
        const placed = benchOf(app.project.doc).placed;
        act(placed[part.id] === 1 ? { type: 'remove', part: part.id } : { type: 'add', part: part.id, orient: 1 });
      });
    return { main, turn };
  });

  // The bench actions lying at the front right.
  const actions = new Group();
  actions.name = 'range-bench-actions';
  root.add(actions);
  const actionSpec = [
    { id: 'build', icon: 'run', key: 'build', col: 0, row: 0 },
    { id: 'strip', icon: 'reset', key: 'strip', col: 1, row: 0 },
    { id: 'plug', icon: 'speed', key: 'battery', col: 2, row: 0 },
    { id: 'smoke', icon: 'hot', key: 'smoke', col: 0, row: 1 },
    { id: 'motors', icon: 'step', key: 'motors', col: 1, row: 1 },
    { id: 'calibrate', icon: 'probe', key: 'calibrate', col: 2, row: 1 },
  ] as const;
  const actionPlates = actionSpec.map((a) => {
    const plate = mk({ w: 0.068, d: 0.08, primary: a.id === 'build' }, { icon: a.icon, label: S.t(lang(), a.key), lang: lang() });
    plate.group.position.set(ACTION_COLS[a.col], 0, ACTION_ROWS[a.row]);
    actions.add(plate.group);
    bind(plate, `bench:${a.id}`, () => act({ type: a.id }));
    return plate;
  });

  // Phase leads: one small plate per motor, shown while the motor wires are on.
  const leads = new Group();
  leads.name = 'range-bench-leads';
  root.add(leads);
  const leadPlates = craft.motors.map((m, i) => {
    const plate = mk({ w: 0.06, d: 0.05, h: 0.006 }, { icon: null, label: m.id, lang: lang() });
    plate.group.position.set(-0.335 + (i % 4) * 0.063, 0, 0.12 - Math.floor(i / 4) * 0.06);
    leads.add(plate.group);
    bind(plate, `bench:leads:${m.id}`, () => act({ type: 'cross', motor: m.id }));
    return plate;
  });

  // The smoke stopper's lamp: an ink bulb that blinks (safe) or stays lit (short).
  const lampOk = inkSolid(new SphereGeometry(0.014, 16, 12), '#e4694e');
  const lampShort = inkSolid(new SphereGeometry(0.014, 16, 12), '#a8402b');
  const lamps = new Group();
  lamps.position.set(0.328, 0.018, -0.045);
  lampOk.group.visible = lampShort.group.visible = false;
  lamps.add(lampOk.group, lampShort.group);
  root.add(lamps);

  // Spin channels, built once.
  const propCh = craft.motors.map((m) => `prop:${m.id}`);
  const motorCh = craft.motors.map((m) => `motor:${m.id}`);
  const spin = (index: number, rpm: number) => {
    drone.set(propCh[index]!, rpm);
    drone.set(motorCh[index]!, rpm);
  };

  // ---- state ----
  let shown: BenchState | null = null;
  let anim: Anim | null = null;
  let flashLeft = 0;
  let focusId: string | null = null;
  let focusLeft = 0;
  let callout: Callout | null = null;
  let sayLeft = 0;
  let disposed = false;

  const showSay = (p: Pending) => {
    callout?.dispose();
    callout = createCallout(p.text, { tone: p.tone, distance: 0.6, lift: 0.1, shape: 'card' });
    callout.group.name = 'range-bench-say';
    callout.group.userData.text = p.text;
    callout.group.userData.tone = p.tone;
    callout.group.position.set(0.16, 0.02, DRONE_AT.z - 0.02);
    root.add(callout.group);
    sayLeft = SAY_S;
    const label = callout.group.getObjectByName('look:callout-label') as { material: { opacity: number } } | undefined;
    if (label) {
      label.material.opacity = 0;
      fadeIn(app.world, (a) => (label.material.opacity = a), { ms: 250 });
    }
  };

  const saying = (msg: BenchMessage, st: BenchState): Pending => ({ text: benchText(msg, craft, lang(), text), tone: toneOf(msg) });

  function render(): void {
    if (disposed) return;
    const st = benchOf(app.project.doc);
    const view = benchView(craft, st);
    const l = lang();
    // Parts: only those on are shown; everything else the asset has is hidden.
    for (const id of droneParts) drone.setPartVisible(id, Object.hasOwn(st.placed, id));
    // A part that goes on flashes (one at a time: Build it for me puts many on at once).
    if (shown) {
      const added = craft.parts.filter((p) => Object.hasOwn(st.placed, p.id) && !Object.hasOwn(shown!.placed, p.id));
      if (added.length === 1) {
        drone.highlight(added[0]!.id);
        flashLeft = FLASH_S;
      } else if (added.length > 1) {
        drone.highlight(null);
        flashLeft = 0;
      }
    }
    shown = st;
    if (focusId) drone.highlight(focusId);
    view.parts.forEach((pv, i) => {
      const part = craft.parts[i]!;
      const { main, turn } = partPlates[i]!;
      main.set({
        label: text[part.short] ?? part.short,
        lang: l,
        latched: pv.state === 'on',
        badge: part.id === focusId ? { text: '!', tone: 'bad' } : pv.state === 'next' ? { text: S.t(l, 'next'), tone: 'accent' } : pv.turned ? { text: S.t(l, 'turned'), tone: 'warn' } : null,
      });
      turn?.set({ label: S.t(l, 'fitTurned'), lang: l, latched: pv.turned });
    });
    const states = [view.build, view.strip, view.plug, view.smoke, view.motors, view.calibrate];
    actionSpec.forEach((a, i) => {
      const v = states[i]!;
      actionPlates[i]!.set({
        label: S.t(l, a.key),
        lang: l,
        disabled: !v.available,
        latched: a.id === 'plug' && v.done,
        badge: v.done ? { text: S.t(l, a.id === 'plug' ? 'pluggedIn' : 'passed'), tone: 'good' } : null,
      });
    });
    leads.visible = view.leads.length > 0;
    view.leads.forEach((lv, i) =>
      leadPlates[i]?.set({
        label: lv.motor,
        lang: l,
        latched: lv.crossed,
        badge: { text: S.t(l, lv.crossed ? 'leadsCrossed' : 'leadsStraight'), tone: lv.crossed ? 'warn' : 'good' },
      }),
    );
  }

  function act(action: BenchAction): void {
    if (disposed) return;
    if (anim) return showSay(saying({ kind: 'say', key: 'busy' }, benchOf(app.project.doc)));
    const doc = app.project.doc;
    const before = benchOf(doc);
    const pick = content ? pickOf(doc, content) : null;
    const cells = pick && content ? (content.design.batts[pick.batt]?.cells ?? 0) : 0;
    const wrongBefore = !before.motorOk ? wrongMotors(craft, before) : [];
    const res = applyBench(before, action, { craft, pick, cells });
    const ops = benchOps(doc, res.state);
    if (ops.length) app.project.apply(ops, { label: `bench ${action.type}` });
    else render();
    const say = lastSay(res.messages);
    const pending = say ? saying(say, res.state) : null;
    const ran = (key: string) => res.messages.some((m) => m.kind === 'log' && m.key === key);
    if (ran('motors')) {
      const steps = motorSequence(craft, wrongBefore, MOTOR_S);
      anim = { kind: 'motors', t: 0, steps, length: steps.length * MOTOR_S, active: -1, say: pending };
    } else if (ran('smoke')) {
      anim = { kind: 'smoke', t: 0, short: say?.key === 'smokeShort', say: pending };
    } else if (pending) showSay(pending);
  }

  // ---- frame ----
  const tick = (dt: number) => {
    if (anim) {
      anim.t += dt;
      if (anim.kind === 'motors') {
        const i = anim.t >= anim.length ? -1 : Math.floor(anim.t / MOTOR_S);
        if (i !== anim.active) {
          if (anim.active >= 0) spin(anim.active, 0);
          anim.active = i;
          if (i >= 0) spin(i, anim.steps[i]!.rpm);
          // The motor found spinning the wrong way is picked out in the accent while it turns.
          drone.highlight(i >= 0 && anim.steps[i]!.wrong ? 'MOTORS' : null);
        }
        if (anim.active >= 0) drone.update(dt);
        if (anim.t >= anim.length) finish();
      } else {
        const lit = anim.short ? anim.t < SMOKE_S : anim.t < SMOKE_S * 0.35;
        (anim.short ? lampShort : lampOk).group.visible = lit && anim.t < SMOKE_S;
        if (anim.t >= SMOKE_S) finish();
      }
    }
    if (focusLeft > 0) {
      focusLeft -= dt;
      if (focusLeft <= 0) {
        focusId = null;
        drone.highlight(null);
        render();
      }
    }
    if (flashLeft > 0) {
      flashLeft -= dt;
      if (flashLeft <= 0) drone.highlight(null);
    }
    if (callout && sayLeft > 0) {
      sayLeft -= dt;
      const label = callout.group.getObjectByName('look:callout-label') as { material: { opacity: number } } | undefined;
      if (label && sayLeft < SAY_FADE_S && sayLeft > 0) label.material.opacity = sayLeft / SAY_FADE_S;
      if (sayLeft <= 0) {
        callout.dispose();
        callout = null;
      }
    }
  };

  function finish(): void {
    const a = anim;
    anim = null;
    lampOk.group.visible = lampShort.group.visible = false;
    if (a?.kind === 'motors') for (let i = 0; i < craft.motors.length; i++) spin(i, 0);
    if (a?.say) showSay(a.say);
  }

  // ---- wiring ----
  offs.push(onLookFrame(app.world, tick));
  offs.push(app.project.subscribe(render));
  offs.push(
    app.settings.lang.subscribe(() => {
      const want = lang();
      void loadFigureText(want).then((t) => {
        if (disposed || want !== lang()) return;
        text = t;
        render();
      });
    }),
  );
  // A part the crash card named: picked out for a few seconds, once.
  const focus = benchFocusOf(app);
  const takeFocus = () => {
    const id = focus.value;
    if (!id) return;
    focus.set(null);
    if (!craft.parts.some((p) => p.id === id)) return;
    focusId = id;
    focusLeft = FOCUS_S;
    flashLeft = 0;
    render();
  };
  offs.push(focus.subscribe(takeFocus));
  render();
  takeFocus();

  // Arrival.
  dropIn(app.world, rig, { height: 0.08 });
  dropIn(app.world, panel, { height: 0.04, delay: 120 });
  dropIn(app.world, actions, { height: 0.04, delay: 240 });

  return {
    dispose() {
      disposed = true;
      for (const off of offs) off();
      callout?.dispose();
      for (const p of plates) p.dispose();
      lampOk.dispose();
      lampShort.dispose();
      drone.dispose();
      root.removeFromParent();
    },
  };
}

export const benchModule: FeatureModule = {
  id: 'range/flight/bench',
  mount(app) {
    const range = rangeOf(app);
    let session: Session | null = null;
    let wanted: string | null = null;
    let token = 0;

    const sync = () => {
      const p = range.value;
      const id = p?.kind === 'drone' && app.shell.place.value === 'bench' ? p.contentId : null;
      if (id === wanted) return;
      wanted = id;
      const mine = ++token;
      session?.dispose();
      session = null;
      if (!id) return;
      const craft = benchCraft(id);
      if (!craft) return;
      void openSession(app, id, craft, () => mine === token)
        .then((s) => {
          if (mine !== token) return s?.dispose();
          session = s;
        })
        .catch((e: unknown) => console.warn('range bench:', e instanceof Error ? e.message : e));
    };

    const offs = [range.subscribe(sync), app.shell.place.subscribe(sync)];
    sync();
    return () => {
      token++;
      for (const off of offs) off();
      session?.dispose();
      session = null;
    };
  },
};
