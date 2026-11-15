/**
 * The run cluster (docs/XR_DESIGN.md 6.1 and section 4): Reset, Step, Run/Pause and Speed on the front rail, the
 * clock above them, and the ring round each running board. `machine.ts` decides; this file feeds it the bridge's
 * states and diagnostics, the presses, the clock, the session's visibility and the document's edits, carries out its
 * effects one after another on `app.sim`, and draws what it says. The part views are fed by `../views/host.ts`.
 */
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { InteractionEvent } from '../../contracts/input';
// The look kit's reduced motion also follows the browser's own preference.
import { reducedMotionOf as reducedMotion } from '../../look';
import { bindPlate } from '../kit/plate';
import { runFeedback } from '../kit/feedback';
import { onTick } from '../kit/ticker';
import { rangeOf, runDrone, runDroneHere } from '../../range/activate';
import { flyHereOf } from '../../range/flight/here';
import { createCluster } from './cluster';
import {
  clockSeconds,
  clockText,
  dueAt,
  editKind,
  initialState,
  loadReason,
  next,
  progressOf,
  SPEEDS,
  viewOf,
  type ClusterEvent,
  type ClusterState,
  type Control,
  type Effect,
  type Visibility,
} from './machine';
import { createBoardRings } from './ring';
import { controlStrings as S } from './strings';

/** The clock redraws at most 10 times a second (9.2). */
const CLOCK_MS = 100;
/** The ring on the Run plate moves in twentieths, so its face redraws at most 20 times a phase. */
const RING_STEPS = 20;

export const controlsModule: FeatureModule = {
  id: 'run/controls',
  mount(app: XrApp) {
    const lang = () => app.settings.lang.value;
    const cluster = createCluster(app, lang());
    app.bench.table.add(cluster.group);
    const layout = () => cluster.place(app.settings.xr.value.posture, app.settings.xr.value.dominantHand);
    layout();
    let reduced = reducedMotion(app);
    const rings = createBoardRings(app, () => reduced);
    rings.rebuild();
    const fb = runFeedback(app);
    const now = () => performance.now();

    let state: ClusterState = initialState(app.sim.state, now());
    /** The press that started a load, so the run's start cue buzzes the hand that asked for it. */
    let asker: InteractionEvent | null = null;
    let chain: Promise<void> = Promise.resolve();
    let disposed = false;

    // The clock: the last frame's time and when it came.
    let frameNs = app.sim.lastFrame?.atNs ?? 0;
    let frameAt = now();
    let drawnCs = -1;
    let drawnSpeed = -1;
    let drawnLang = '';
    let drawnAt = -Infinity;
    let ring = -1;

    const drawClock = (t: number, force: boolean) => {
      const seconds = clockSeconds(frameNs, t - frameAt, SPEEDS[state.speed]!, state.phase === 'running');
      const cs = Math.floor(seconds * 100 + 1e-6);
      const l = lang();
      if (cs === drawnCs && state.speed === drawnSpeed && l === drawnLang) return;
      if (!force && t - drawnAt < CLOCK_MS) return;
      drawnCs = cs;
      drawnSpeed = state.speed;
      drawnLang = l;
      drawnAt = t;
      const text = clockText(seconds, state.speed);
      cluster.clock.set({ lines: [text], lang: l });
      cluster.group.userData.clock = text;
    };

    const drawRing = (t: number) => {
      const p = progressOf(state, t);
      const q = p === null ? -1 : Math.round(p * RING_STEPS);
      if (q === ring) return;
      ring = q;
      cluster.plates.run.set({ progress: q < 0 ? null : q / RING_STEPS });
    };

    const draw = () => {
      const l = lang();
      const v = viewOf(state);
      // A drone has no sketch: Run on range and Run here (Stop while it flies here), nothing else.
      const drone = rangeOf(app).value?.kind === 'drone';
      cluster.drone(drone);
      cluster.here.set({ label: S.t(l, flyHereOf(app).value ? 'stopHere' : 'runHere'), lang: l, icon: flyHereOf(app).value ? 'stop' : 'run' });
      cluster.plates.run.set({
        icon: v.run.icon,
        label: drone ? S.t(l, 'runOnRange') : S.t(l, v.run.label),
        lang: l,
        badge: !drone && v.run.badge ? { text: S.t(l, v.run.badge), tone: v.run.tone ?? 'warn' } : null,
      });
      cluster.plates.step.set({ label: S.t(l, 'step'), lang: l, disabled: v.stepDisabled });
      cluster.plates.reset.set({ label: S.t(l, 'reset'), lang: l });
      cluster.plates.speed.set({ label: v.speedLabel, lang: l });
      rings.set(v.ring);
      ring = -2;
      drawRing(now());
      drawClock(now(), true);
      // For scripts and tests: what the cluster shows.
      cluster.group.userData.state = { phase: v.phase, label: v.run.label, badge: v.run.badge, speed: v.speedLabel, reason: state.reason, restart: state.restart };
    };

    const exec = async (e: Effect): Promise<void> => {
      switch (e.t) {
        case 'load': {
          let ev: ClusterEvent;
          try {
            const r = await app.sim.load(app.project.doc);
            frameNs = app.sim.lastFrame?.atNs ?? 0;
            ev = { t: 'loaded', id: e.id, ok: r.ok, ...(r.ok ? {} : { reason: loadReason(r.diagnostics) }) };
            if (!r.ok) console.warn('[iynkware] the run did not load', r.diagnostics.map((d) => d.id).join(', '));
          } catch (err) {
            console.error('[iynkware] load', err);
            ev = { t: 'loaded', id: e.id, ok: false, reason: 'refused' };
          }
          dispatch(ev);
          return;
        }
        case 'run':
          return app.sim.run();
        case 'pause':
          return app.sim.pause();
        case 'step':
          return app.sim.step(e.ms);
        case 'stop':
          // Back to t = 0, once the old run's last frames are in.
          await app.sim.stop();
          frameNs = 0;
          frameAt = now();
          return;
        case 'speed':
          return app.sim.setSpeed(e.x);
        case 'cue':
          return;
      }
    };

    function dispatch(e: ClusterEvent, from: InteractionEvent | null = null) {
      if (disposed) return;
      const r = next(state, e, now());
      const changed = r.state !== state;
      const was = state.phase;
      state = r.state;
      if (e.t === 'press' && state.phase === 'compiling' && was !== 'compiling') asker = from;
      for (const fx of r.effects) {
        if (fx.t === 'cue') {
          fb.play(fx.cue, cluster.worldOf('run'), from ?? (fx.cue === 'run-start' ? asker : null));
          if (fx.cue === 'run-start') asker = null;
          continue;
        }
        if (fx.t === 'stop' || fx.t === 'load') {
          frameNs = 0;
          frameAt = now();
        }
        chain = chain.then(() => exec(fx)).catch((err) => console.error('[iynkware] run control', err));
      }
      if (changed) draw();
    }

    const offs = [
      ...(['reset', 'step', 'run', 'speed'] as const).map((c: Control) =>
        bindPlate(app, cluster.plates[c], `run:${c}`, (e) => {
          // A drone has no sketch: Run builds it, or takes the person to fly it when it is built.
          if (c === 'run' && state.phase !== 'running') {
            const d = runDrone(app);
            if (d) {
              if (d === 'ready' && app.shell.offered.value.includes('range')) app.shell.go('range');
              return;
            }
          }
          dispatch({ t: 'press', control: c }, e);
        }),
      ),
      bindPlate(app, cluster.here, 'run:here', () => void runDroneHere(app)),
      rangeOf(app).subscribe(() => draw()),
      flyHereOf(app).subscribe(() => draw()),
      app.sim.onState((s) => dispatch({ t: 'bridge', state: s })),
      app.sim.onDiagnostic((d) => dispatch({ t: 'diagnostic', kind: d.kind })),
      app.sim.onFrame((f) => {
        frameNs = f.atNs;
        frameAt = now();
      }),
      app.project.subscribe((change) => dispatch({ t: 'edit', kind: editKind(change), origin: change.origin })),
      app.world.visibilityState.subscribe((v) => dispatch({ t: 'visibility', state: v as Visibility })),
      app.settings.lang.subscribe(() => draw()),
      app.settings.xr.subscribe(() => {
        layout();
        reduced = reducedMotion(app);
      }),
      app.settings.shared.subscribe(() => (reduced = reducedMotion(app))),
      app.bench.onLayout(() => rings.rebuild()),
      onTick(app.world, (dt) => {
        const t = now();
        const due = dueAt(state);
        if (due !== null && t >= due) dispatch({ t: 'tick' });
        if (ring !== -1) drawRing(t);
        drawClock(t, false);
        rings.tick(dt);
      }),
    ];
    draw();

    return () => {
      disposed = true;
      for (const off of offs) off();
      rings.dispose();
      cluster.dispose();
    };
  },
};
