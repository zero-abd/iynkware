/**
 * The part-view host: one view per placed part, built again on every bench layout, fed from the sim. A frame's part
 * states go to `update`, a change in `frame.analog.parts[id]` to `health`, every render frame while running to `tick`,
 * and the run stopping (or failing to load) to `reset`. The views themselves are the factories registered in
 * `index.ts`; this file knows nothing about any one part.
 */
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { PartHealth, PartState, PartView } from '../../contracts/part-view';
import { onTick } from '../kit/ticker';

/** A component's params with parameter references looked up (`{ param: 'prm_ohms' }` becomes its value). */
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

export function mountViewHost(app: XrApp): Unsubscribe {
  const views = new Map<string, PartView>();
  /** The views that have a `tick`, as an array so the per-frame loop allocates nothing. */
  const ticking: PartView[] = [];
  const health = new Map<string, PartHealth>();
  const watts = new Map<string, number>();
  let generation = 0;

  const forget = () => {
    health.clear();
    watts.clear();
  };

  const clear = () => {
    for (const v of views.values()) v.dispose();
    views.clear();
    ticking.length = 0;
    forget();
  };

  const build = () => {
    const gen = ++generation;
    clear();
    const doc = app.project.doc;
    for (const item of [...doc.components, ...doc.boards]) {
      const object = app.bench.objectOf(item.id);
      if (!object) continue;
      const { ref, version } = item.definition;
      app.assets
        .get(ref, version)
        .then((asset) => {
          if (gen !== generation) return;
          const first = app.sim.lastFrame?.parts.get(item.id);
          const view = app.views.create(
            { partId: item.id, refdes: item.refdes, ref, version, params: resolveParams(app, item.id), asset, object, anchor: (id) => asset.anchors.get(id) },
            first,
          );
          views.set(item.id, view);
          if (view.tick) ticking.push(view);
          // Frames are change driven: a view built mid-run shows the last state now, not at the next change.
          if (first && (app.sim.state === 'running' || app.sim.state === 'paused')) view.update(first);
        })
        .catch((err) => console.error('[iynkware] part view', item.id, err));
    }
  };

  const feed = (state: PartState, id: string) => views.get(id)?.update(state);

  const offs = [
    app.bench.onLayout(build),
    app.sim.onFrame((f) => {
      f.parts.forEach(feed);
      const parts = f.analog?.parts;
      if (!parts) return;
      for (const id in parts) {
        const p = parts[id]!;
        if (health.get(id) === p.state && watts.get(id) === p.watts) continue;
        health.set(id, p.state);
        watts.set(id, p.watts);
        views.get(id)?.health?.(p.state, p.watts);
      }
    }),
    app.sim.onState((s) => {
      if (s !== 'idle' && s !== 'unloaded' && s !== 'error') return;
      for (const v of views.values()) v.reset();
      forget();
    }),
    onTick(app.world, (dt) => {
      if (app.sim.state !== 'running') return;
      for (let i = 0; i < ticking.length; i++) ticking[i]!.tick!(dt);
    }),
  ];
  build();

  return () => {
    generation++;
    for (const off of offs) off();
    clear();
  };
}
