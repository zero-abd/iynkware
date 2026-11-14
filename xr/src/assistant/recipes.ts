/**
 * The op builders the person's hands use (contracts/assistant.ts `BuildRecipes`), over the 2D Studio's own rules:
 * `legRecipe` for the nets a seated part's legs make and `wireRecipe` for a wire and the nets it joins
 * (`src/studio/rules/connect.ts`, imported unchanged: one code path for both apps, as XR_DESIGN.md 3.4 asks). The
 * placement batch follows the Studio's `placeBatch` and `breadboardBatch`. The bench's gestures use the same iynk
 * builders (`xr/src/bench/core/actions.ts`, bench-internal); once those actions are reachable through `XrApp` (#107),
 * this file calls them instead, so hands and co-builder share one function per verb, not only one rule.
 */
import { newId, type EntityPrefix } from '@/core/ids';
import { builtinRegistry } from '@/parts/builtin';
import { interfaceOf } from '@/parts/pins';
import type { PartRegistry } from '@/parts/registry';
import type { ComponentDependency, Op, Project, WireEnd } from '@/project/generated/types';
import { legRecipe, wireRecipe, type WireEndRef } from '@/studio/rules/connect';
import type { IdSource } from '@/studio/views/breadboard';
import type { BuildRecipes } from '../contracts/assistant';

export interface RecipeOptions {
  /** Where a part's dependency comes from when neither the call nor the project has it. Default: the built-in parts. */
  readonly registry?: PartRegistry;
  /** New net and wire ids. Default: random, as the Studio makes them. */
  readonly ids?: IdSource;
}

const randomIds: IdSource = (prefix) => newId(prefix);

function toRef(end: WireEnd): WireEndRef {
  if (end.kind === 'pin') return { kind: 'pin', c: end.c, p: end.p };
  if (end.kind === 'hole') return { kind: 'hole', surface: end.surface, hole: end.hole };
  throw new RangeError('a wire to a junction is not something the bench can make by hand');
}

export const stringLegs = (legs: Record<string, string | undefined> | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(legs ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'));

export function createRecipes(opts: RecipeOptions = {}): BuildRecipes {
  const ids = opts.ids ?? randomIds;
  let registry = opts.registry;
  const builtin = (ref: string, version: string): ComponentDependency | undefined => {
    registry ??= builtinRegistry();
    const d = registry.get(ref, version);
    return d && { ref: d.id, version: d.version, origin: 'builtin', interface: interfaceOf(d) };
  };

  return {
    place(doc, viewId, entity, placement, o) {
      const item = entity.kind === 'board' ? entity.board : entity.component;
      const { ref, version } = item.definition;
      const view = doc.views.find((v) => v.id === viewId);
      if (!view) throw new RangeError(`no view ${viewId}`);
      const ops: Op[] = [];
      let dep = doc.dependencies.components.find((d) => d.ref === ref && d.version === version);
      if (!dep) {
        dep = o?.dependency ?? builtin(ref, version);
        if (!dep) throw new RangeError(`no part ${ref}@${version}`);
        ops.push({ k: 'dep.set', dependency: dep });
      }
      const exists = (entity.kind === 'board' ? doc.boards : doc.components).some((x) => x.id === item.id);
      if (!exists) ops.push(entity.kind === 'board' ? { k: 'board.add', board: entity.board } : { k: 'component.add', component: entity.component });
      // A breadboard becomes the view's surface, as the Studio's `breadboardBatch` makes it.
      const surface = entity.kind === 'component' && dep.interface.role === 'surface' && view.kind === 'breadboard' && view.surface === undefined;
      if (surface) ops.push({ k: 'view.set', id: viewId, surface: item.id });
      ops.push({ k: 'view.place', view: viewId, placement });
      const legs = stringLegs(placement.legs);
      // The Studio computes leg nets against the document before the part is added (`placeBatch`); so does this.
      if (Object.keys(legs).length > 0 && view.surface !== undefined) ops.push(...legRecipe(doc, viewId, item.id, legs, ids));
      return ops;
    },
    wire(doc, viewId, from, to, o) {
      const { batch } = wireRecipe(doc, viewId, toRef(from), toRef(to), ids);
      if (!o?.id && !o?.color) return batch;
      return batch.map((op) =>
        op.k === 'wire.add' ? { ...op, wire: { ...op.wire, ...(o.id && { id: o.id }), ...(o.color && { color: o.color }) } } : op,
      );
    },
  };
}

/** A deterministic id source for tests and replays: `<prefix>_cb<n>`, skipping ids the document already has. */
export function countingIds(taken: () => ReadonlySet<string>): IdSource {
  let n = 0;
  return (<P extends EntityPrefix>(prefix: P) => {
    const used = taken();
    let id: string;
    do id = `${prefix}_cb${++n}`;
    while (used.has(id));
    return id as `${P}_${string}`;
  }) as IdSource;
}

/** Every entity id in a document (boards, components, nets, views, wires), for `countingIds`. */
export function idsIn(doc: Project): Set<string> {
  const out = new Set<string>();
  for (const x of [...doc.boards, ...doc.components, ...doc.nets, ...doc.views]) out.add(x.id);
  for (const v of doc.views) for (const w of v.wires) out.add(w.id);
  return out;
}
