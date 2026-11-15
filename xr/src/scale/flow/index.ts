/**
 * Flow: current along wires, strips and through two pin parts, and node voltages, from the running simulation's analog
 * readouts. A "Current flow" row on the Look inside panel turns it on. Dots are one InstancedMesh in a group that
 * copies the stage's matrix; the labels are one InstancedMesh facing the viewer. Both sleep while flow is off.
 */
import { Group, Vector3 } from '@iwsdk/core';
import { rangeOf, rampStep } from '@/studio/overlays/flow/scale';
import type { FeatureModule } from '../../contracts/app';
import type { Vec3 } from '../../contracts/common';
import { benchInternals } from '../../bench/space';
import { analogFeed, type AnalogView } from '../kit/analog';
import { scaleControls } from '../kit/controls';
import { onFrame } from '../kit/frame';
import { reducedMotion } from '../kit/prefs';
import { tr } from '../kit/text';
import { SimClock } from './clock';
import { FlowDots } from './dots';
import { FlowLabels, pickLabels } from './labels';
import { buildTopology, segmentAmps, type PathEnv, type Topology } from './paths';
import { FLOW_STRINGS as S } from './strings';

const OWNER = 'scale/flow';

export const flowModule: FeatureModule = {
  id: 'scale/flow',
  mount(app) {
    const { scale, project, bench, sim, world } = app;
    const feed = analogFeed(app);
    const ctl = scaleControls(app);
    const dots = new FlowDots();
    const labels = new FlowLabels();
    const clock = new SimClock();
    const root = new Group();
    root.name = 'scale-flow';
    root.matrixAutoUpdate = false;
    root.visible = false;
    root.add(dots.mesh);
    labels.mesh.visible = false;
    world.scene.add(root);
    world.scene.add(labels.mesh);

    let topo: Topology | null = null;
    let amps = new Float64Array(0);
    let view: AnalogView | null = feed.view;
    let unwant: (() => void) | null = null;
    const tmp = new Vector3();

    const env = (): PathEnv | null => {
      const inner = benchInternals(bench);
      if (!inner) return null;
      return {
        wirePath: (id) => bench.wirePath(id),
        pinAt: (part, pin) => {
          const p = inner.anchorBoard(part, pin, tmp);
          return p ? ([p.x, p.y, p.z] as Vec3) : null;
        },
      };
    };

    const rebuild = () => {
      const e = env();
      const viewId = benchInternals(bench)?.viewId;
      topo = e && viewId ? buildTopology(project.doc, viewId, e) : null;
      amps = new Float64Array(topo?.segs.length ?? 0);
      dots.setTopology(topo);
      refresh();
    };

    /** A new analog state (or none): currents, colours and labels. Runs per sim frame, not per render frame. */
    const refresh = () => {
      if (!scale.flow.value || !topo || !view) {
        dots.clear();
        labels.set([], null);
        return;
      }
      const t = topo;
      const v = view;
      segmentAmps(t, v, amps);
      const max = rangeOf(v.volts).max;
      dots.setFlow(amps, (i) => {
        const s = t.segs[i]!;
        const a = s.nodeA === undefined ? undefined : v.volts[s.nodeA];
        const b = s.nodeB === undefined ? undefined : v.volts[s.nodeB];
        if (a === undefined && b === undefined) return 0;
        const mean = a === undefined ? b! : b === undefined ? a : (a + b) / 2;
        return rampStep(mean, max);
      });
      const lang = app.settings.lang.value;
      labels.set(pickLabels(lang, v.volts, t.spots, sim.netlist?.ground), { text: tr(S, lang, 'chip'), at: t.chip });
    };

    const on = () => {
      if (unwant) return;
      unwant = feed.want(OWNER, { volts: 'all', amps: [], pinAmps: true, waves: [] });
      view = feed.view;
      root.visible = true;
      labels.mesh.visible = true;
      rebuild();
    };
    const off = () => {
      unwant?.();
      unwant = null;
      root.visible = false;
      labels.mesh.visible = false;
      dots.clear();
      labels.clear();
    };
    const sync = () => (scale.flow.value ? on() : off());

    const stops = [
      scale.flow.subscribe(sync),
      bench.onLayout(() => scale.flow.value && rebuild()),
      feed.onChange((next) => {
        view = next;
        refresh();
      }),
      sim.onFrame((f) => clock.push(f.atNs)),
      sim.onState((s) => {
        if (s === 'idle' || s === 'unloaded') clock.reset();
      }),
      app.settings.lang.subscribe(() => scale.flow.value && refresh()),
      onFrame(world, (dt) => {
        if (!scale.flow.value) return;
        const stage = scale.stage.value;
        const m = stage.root.matrixWorld;
        root.matrix.copy(m);
        root.matrixWorldNeedsUpdate = true;
        const e = m.elements;
        const s = Math.hypot(e[0]!, e[1]!, e[2]!) || 1;
        dots.update(clock.advance(dt), { kind: stage.kind, scale: s, reduced: reducedMotion(app) });
        labels.update(m, world.camera.matrixWorld.elements, performance.now());
      }),
    ];

    const row = ctl.add({
      id: 'flow/current',
      host: 'panel',
      order: 2,
      icon: 'lightning',
      label: (lang) => tr(S, lang, 'row'),
      latched: () => scale.flow.value,
      watch: [scale.flow],
      run: () => scale.setFlow(!scale.flow.value),
    });
    sync();

    return () => {
      row();
      for (const stop of stops) stop();
      off();
      world.scene.remove(root);
      world.scene.remove(labels.mesh);
      dots.dispose();
      labels.dispose();
    };
  },
};
