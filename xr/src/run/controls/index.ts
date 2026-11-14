/**
 * Run controls: Run and Stop on the bench, the run status label, and the part views fed from sim frames (the views
 * themselves are registered by `../views`). Skeleton scope; grows pause, step, slow motion and the serial monitor.
 */
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { PartView } from '../../contracts/part-view';
import type { RunState } from '../../contracts/sim';
import { textLabel } from '../../ui/text';

const BUTTON = { w: 0.1, h: 0.035, d: 0.06 };

function resolveParams(app: XrApp, partId: string): Record<string, unknown> {
  const doc = app.project.doc;
  const c = doc.components.find((x) => x.id === partId);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c?.params ?? {})) {
    if (v && typeof v === 'object' && 'param' in v) out[k] = doc.parameters.find((p) => p.id === (v as { param: string }).param)?.value ?? null;
    else out[k] = v;
  }
  return out;
}

export function makeBenchButton(text: string, colour: number): { group: Group; mesh: Mesh } {
  const group = new Group();
  const mesh = new Mesh(new BoxGeometry(BUTTON.w, BUTTON.h, BUTTON.d), new MeshStandardMaterial({ color: colour, roughness: 0.7 }));
  mesh.position.y = BUTTON.h / 2;
  mesh.name = `button:${text}`;
  group.add(mesh);
  const label = textLabel(BUTTON.w * 0.9, BUTTON.d * 0.6, { bg: '#00000000', fg: '#231e16' });
  label.set(text, { bg: 'rgba(0,0,0,0)' });
  label.mesh.rotation.x = -Math.PI / 2;
  label.mesh.position.set(0, BUTTON.h / 2 + 0.0008, 0);
  mesh.add(label.mesh);
  return { group, mesh };
}

export const controlsModule: FeatureModule = {
  id: 'run/controls',
  mount(app) {
    const controls = new Group();
    controls.name = 'run-controls';
    controls.position.set(0.3, 0, 0.22);
    app.bench.table.add(controls);
    const run = makeBenchButton('Run', 0x7ccf6b);
    const stop = makeBenchButton('Stop', 0xe8695a);
    run.group.position.x = 0;
    stop.group.position.x = 0.12;
    controls.add(run.group, stop.group);

    const status = textLabel(0.34, 0.05);
    status.mesh.position.set(0, 0.3, -0.27);
    app.bench.table.add(status.mesh);
    const show = (t: string) => status.set(t);
    show('Stopped');

    const views = new Map<string, PartView>();
    const buildViews = () => {
      for (const v of views.values()) v.dispose();
      views.clear();
      const doc = app.project.doc;
      for (const item of [...doc.components, ...doc.boards]) {
        const object = app.bench.objectOf(item.id);
        if (!object) continue;
        void app.assets.get(item.definition.ref, item.definition.version).then((asset) => {
          views.set(
            item.id,
            app.views.create({
              partId: item.id,
              refdes: item.refdes,
              ref: item.definition.ref,
              version: item.definition.version,
              params: resolveParams(app, item.id),
              asset,
              object,
              anchor: (name) => asset.anchors.get(name),
            }),
          );
        });
      }
    };
    const offLayout = app.bench.onLayout(buildViews);
    buildViews();

    const offFrame = app.sim.onFrame((f) => {
      for (const [id, state] of f.parts) views.get(id)?.update(state);
      show(`Running  ${(f.atNs / 1e9).toFixed(1)} s`);
    });
    const offState = app.sim.onState((s: RunState) => {
      if (s === 'idle' || s === 'unloaded') {
        for (const v of views.values()) v.reset();
        show('Stopped');
      } else if (s === 'error') show('The project did not load');
      else if (s !== 'running') show(`Run ${s}`);
    });

    const press = async (what: 'run' | 'stop') => {
      try {
        if (what === 'run') {
          if (app.sim.state === 'running') return;
          if (app.sim.state === 'unloaded' || app.sim.state === 'error') {
            show('Starting');
            const r = await app.sim.load(app.project.doc);
            if (!r.ok) return;
          }
          await app.sim.run();
        } else await app.sim.stop();
      } catch (err) {
        console.error('[iynkware] run control', err);
        show('Something went wrong');
      }
    };
    const offRun = app.input.bind(run.mesh, { id: 'run', ray: true, poke: true }, (e) => {
      if (e.type === 'select') void press('run');
      if (e.type === 'select-start') run.mesh.scale.setScalar(0.94);
      if (e.type === 'select-end' || e.type === 'hover-end') run.mesh.scale.setScalar(1);
    });
    const offStop = app.input.bind(stop.mesh, { id: 'stop', ray: true, poke: true }, (e) => {
      if (e.type === 'select') void press('stop');
      if (e.type === 'select-start') stop.mesh.scale.setScalar(0.94);
      if (e.type === 'select-end' || e.type === 'hover-end') stop.mesh.scale.setScalar(1);
    });
    // Editing the circuit while it runs reloads it, as the Studio does.
    const offDoc = app.project.subscribe(() => {
      if (app.sim.state === 'running' || app.sim.state === 'paused') void app.sim.load(app.project.doc).then(() => app.sim.run());
    });

    return () => {
      offLayout();
      offFrame();
      offState();
      offRun();
      offStop();
      offDoc();
      for (const v of views.values()) v.dispose();
      controls.removeFromParent();
      status.mesh.removeFromParent();
      status.dispose();
    };
  },
};
