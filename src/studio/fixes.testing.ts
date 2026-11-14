import { newId } from "../core/ids.ts";
import { blankProject } from "../project/blank.ts";
import type { Instrument, Op, Project } from "../project/generated/types.ts";
import { checkBatch } from "../project/semantic.ts";
import { applyDetached } from "../project/session.ts";
import { seededRandom, USER } from "../project/session.testing.ts";
import { builtinRegistry } from "../parts/builtin.ts";
import { interfaceOf } from "../parts/pins.ts";
import { legRecipe, wireRecipe, type WireEndRef } from "./rules/connect.ts";
import { BREADBOARD_REF, breadboardBatch, surfaceGeom, type IdSource } from "./views/breadboard.ts";
import { buildSimNetlist } from "../sim/netlist.ts";
import { extractCodeFacts } from "../sim/faults/code-facts.ts";
import { withoutOnboardPullups } from "../sim/faults/circuit.fixture.ts";
import { buildNetView } from "../sim/faults/netlist-view.ts";
import { allRules, runRules } from "../sim/faults/rules.ts";
import type { Finding, RunFacts } from "../sim/faults/types.ts";
import { resolveFixes, type FixDeps, type ResolvedFix } from "./fixes.ts";

export const registry = builtinRegistry();

const describe = (id: string) => {
  const [ref = "", version = ""] = id.split("@");
  return registry.get(ref, version);
};

/** The document after the ops, which must apply under the rules the editor applies. */
export function applied(doc: Project, ops: Op[]): Project {
  const done = applyDetached(doc, ops, { author: USER, at: doc.meta.updatedAt, invariants: checkBatch });
  if (!done.ok) throw new Error(`${done.reject.code}: ${done.reject.message}`);
  return done.state;
}

export type PartSeat = { id: string; ref: string; refdes: string; params?: Record<string, number | string> };
export type NetSeat = { id: string; pins: [string, string][]; class?: "signal" | "power" | "ground" };

const blank = (id: string): Project => blankProject({ board: "uno", title: "fix", locale: "en", actor: USER.actor, now: "2026-10-28T10:00:00.000Z", id });

/** A blank Uno project (`brd_uno`, sketch `main.ino`) with parts and nets added the way the editor adds them. */
export function circuit(parts: PartSeat[], nets: NetSeat[], sketch?: string): Project {
  const ops: Op[] = [];
  for (const ref of new Set(parts.map((p) => p.ref))) {
    const d = registry.latest(ref)!;
    ops.push({ k: "dep.set", dependency: { ref: d.id, version: d.version, origin: "builtin", interface: interfaceOf(d) } });
  }
  for (const p of parts) {
    const d = registry.latest(p.ref)!;
    ops.push({ k: "component.add", component: { id: p.id, definition: { ref: d.id, version: d.version }, refdes: p.refdes, ...(p.params ? { params: p.params } : {}) } });
    ops.push({ k: "view.place", view: "vw_sch", placement: { c: p.id, x_mm: 10, y_mm: 10 } });
  }
  for (const n of nets) {
    ops.push({ k: "net.create", net: { id: n.id, ...(n.class ? { class: n.class } : {}), connections: n.pins.map(([c, p]) => ({ c, p })) as [{ c: string; p: string }] } });
  }
  const start = blank("prj_fixtest");
  if (sketch !== undefined) ops.push({ k: "source.edit", id: "src_main", baseSeq: 0, pos: 0, del: start.sources[0]!.content.length, ins: sketch });
  return applied(start, ops);
}

/** Every rule over the document, the way the Studio runs the static ones. A `run` adds the rules that read a finished run. */
export function findingsOf(doc: Project, extra: { run?: RunFacts; instruments?: Instrument[]; bareBus?: boolean } = {}): Finding[] {
  const { net } = buildSimNetlist(doc, registry);
  const sources = Object.fromEntries(doc.sources.map((s) => [s.path, s.content]));
  const code = extractCodeFacts(sources, Object.keys(sources).sort(), { variant: "uno-r3" });
  return runRules(allRules(), { view: buildNetView(net, extra.bareBus ? (id) => { const d = describe(id); return d && withoutOnboardPullups(d); } : describe), code, run: extra.run, instruments: extra.instruments }).findings;
}

let counter = 0;
export const testIds: FixDeps["ids"] = (prefix) => `${prefix}_t${++counter}` as ReturnType<NonNullable<FixDeps["ids"]>>;
export const deps: FixDeps = { reg: registry, ids: testIds };

export const fixesFor = (doc: Project, finding: Finding): ResolvedFix[] => resolveFixes(doc, finding.fixes, deps);

export const ledOnD13 = (): Project =>
  circuit(
    [{ id: "cmp_led", ref: "core.led-5mm", refdes: "D1" }],
    [
      { id: "net_d13", class: "signal", pins: [["brd_uno", "D13"], ["cmp_led", "A"]] },
      { id: "net_gnd", class: "ground", pins: [["brd_uno", "GND"], ["cmp_led", "K"]] },
    ],
  );

/** What a student builds in the editor: an LED seated in a breadboard, D13 wired to the strip of its anode and GND to the strip of its cathode, or the other way round. */
export function ledOnBreadboard(reversed = false): Project {
  const rnd = seededRandom();
  const ids: IdSource = (prefix) => newId(prefix, rnd);
  let state = blank("prj_bbfix");
  const commit = (batch: Op[]) => void (state = applied(state, batch));
  const { batch, component: breadboard } = breadboardBatch(registry, ids, { x: 0, y: 0 });
  commit([...batch, { k: "view.place", view: "vw_bb", placement: { c: "brd_uno", x_mm: -80, y_mm: 0 } }]);

  const d = registry.latest("core.led-5mm")!;
  const legs = { A: "b11", K: "b12" };
  const hole = surfaceGeom(registry.latest(BREADBOARD_REF)!).byName.get(legs.A)!;
  const pin = d.pins.find((p) => p.id === "A")!.position!;
  const c = ids("cmp");
  commit([
    { k: "dep.set", dependency: { ref: d.id, version: d.version, origin: "builtin", interface: interfaceOf(d) } },
    { k: "component.add", component: { id: c, definition: { ref: d.id, version: d.version }, refdes: "D1" } },
    { k: "view.place", view: "vw_bb", placement: { c, x_mm: hole.xMm - pin.x, y_mm: hole.yMm - ((d.dimensions?.body?.h ?? 0) - pin.y), legs } },
    ...legRecipe(state, "vw_bb", c, legs, ids),
  ]);
  const wire = (a: WireEndRef, b: WireEndRef) => commit(wireRecipe(state, "vw_bb", a, b, ids).batch);
  wire({ kind: "pin", c: "brd_uno", p: "D13" }, { kind: "hole", surface: breadboard, hole: reversed ? "c12" : "c11" });
  wire({ kind: "pin", c: "brd_uno", p: "GND" }, { kind: "hole", surface: breadboard, hole: reversed ? "c11" : "c12" });
  return state;
}
