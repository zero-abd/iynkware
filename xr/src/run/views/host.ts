/**
 * The part-view host: one view per placed part, built again on every bench layout, fed from the sim. A frame's part
 * states go to `update`, a change in `frame.analog.parts[id]` to `health`, every render frame while running to `tick`,
 * and the run stopping (or failing to load) to `reset`. The views themselves are the factories registered in
 * `index.ts`; this file knows nothing about any one part.
 *
 * Health: a view with no `health` of its own gets the generic one (`health.ts`): a hot part warms, a burnt one chars
 * and its motion freezes (no more `update` or `tick`) until reset.
 *
 * A view is chosen by descriptor ref, then by the kind of the part's first state. A part laid out before the run has no
 * state yet, so a part whose view was chosen without one is chosen again when its first state arrives.
 */
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { PartHealth, PartState, PartView, PartViewContext } from '../../contracts/part-view';
import { reducedMotionOf } from '../../look';
import { onTick } from '../kit/ticker';
import { createGenericHealth, type GenericHealth } from './health';

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
  const contexts = new Map<string, PartViewContext>();
  /** The views that have a `tick`, as an array so the per-frame loop allocates nothing. */
  const ticking: PartView[] = [];
  /** Generic health of the views that have none of their own. */
  const generic = new Map<string, GenericHealth>();
  const tinting: GenericHealth[] = [];
  /** Parts whose view was chosen before they had a state. */
  const unsure = new Set<string>();
  /** States of views built while the run was at rest, to hand them over when it starts. */
  const held = new Map<string, PartState>();
  /** Parts whose generic health says burnt: their motion is frozen. */
  const frozen = new Set<string>();
  const health = new Map<string, PartHealth>();
  const watts = new Map<string, number>();
  let generation = 0;

  const forget = () => {
    health.clear();
    watts.clear();
    frozen.clear();
  };

  const clear = () => {
    for (const v of views.values()) v.dispose();
    for (const g of generic.values()) g.dispose();
    views.clear();
    contexts.clear();
    generic.clear();
    ticking.length = 0;
    tinting.length = 0;
    unsure.clear();
    held.clear();
    forget();
  };

  const adopt = (id: string, view: PartView, ctx: PartViewContext) => {
    views.set(id, view);
    if (view.tick) ticking.push(view);
    if (!view.health) {
      const g = createGenericHealth(ctx.object, () => reducedMotionOf(app));
      generic.set(id, g);
      tinting.push(g);
    }
  };

  const drop = (id: string) => {
    const old = views.get(id);
    if (!old) return;
    old.dispose();
    views.delete(id);
    const at = ticking.indexOf(old);
    if (at >= 0) ticking.splice(at, 1);
    const g = generic.get(id);
    if (g) {
      g.dispose();
      generic.delete(id);
      tinting.splice(tinting.indexOf(g), 1);
    }
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
          const ctx: PartViewContext = { partId: item.id, refdes: item.refdes, ref, version, params: resolveParams(app, item.id), asset, object, anchor: (id) => asset.anchors.get(id) };
          contexts.set(item.id, ctx);
          adopt(item.id, app.views.create(ctx, first), ctx);
          if (!first) unsure.add(item.id);
          const view = views.get(item.id)!;
          // Frames are change driven: a view built mid-run shows the last state now, not at the next change.
          if (first && (app.sim.state === 'running' || app.sim.state === 'paused')) view.update(first);
          // Built at rest from the load frame: it gets that state when the run starts, since a state that never
          // changes (a part not simulated yet) is never sent again.
          else if (first) held.set(item.id, first);
        })
        .catch((err) => console.error('[iynkware] part view', item.id, err));
    }
  };

  const feed = (state: PartState, id: string) => {
    held.delete(id);
    if (unsure.delete(id)) {
      // The first state this part has had: choose its view again, now that its kind is known.
      const ctx = contexts.get(id);
      if (ctx) {
        drop(id);
        adopt(id, app.views.create(ctx, state), ctx);
      }
    }
    if (frozen.has(id)) return;
    views.get(id)?.update(state);
  };

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
        const view = views.get(id);
        if (view?.health) view.health(p.state, p.watts);
        else if (generic.get(id)?.set(p.state)) frozen.add(id);
        else frozen.delete(id);
      }
    }),
    app.sim.onState((s) => {
      if ((s === 'running' || s === 'paused') && held.size > 0) {
        for (const [id, state] of held) views.get(id)?.update(state);
        held.clear();
      }
      if (s !== 'idle' && s !== 'unloaded' && s !== 'error') return;
      for (const v of views.values()) v.reset();
      for (const g of generic.values()) g.reset();
      forget();
    }),
    onTick(app.world, (dt) => {
      for (let i = 0; i < tinting.length; i++) if (tinting[i]!.moving) tinting[i]!.tick(dt);
      if (app.sim.state !== 'running') return;
      for (let i = 0; i < ticking.length; i++) {
        const v = ticking[i]!;
        if (frozen.size === 0 || !frozen.has(v.partId)) v.tick!(dt);
      }
    }),
  ];
  build();

  return () => {
    generation++;
    for (const off of offs) off();
    clear();
  };
}
