import { newId, type EntityId, type EntityPrefix } from "../core/ids.ts";
import type { Component, Op, PinRef, Project, View, Wire } from "../project/generated/types.ts";
import { netlist, type Netlist } from "../project/netlist.ts";
import { checkBatch } from "../project/semantic.ts";
import { applyDetached } from "../project/session.ts";
import { interfaceOf } from "../parts/pins.ts";
import type { PartRegistry } from "../parts/registry.ts";
import type { FindingFix, FixPlan } from "../sim/faults/types.ts";
import { refdesPrefix } from "./tools/place.ts";
import type { Rotation } from "./engine/types.ts";
import { legRecipe } from "./rules/connect.ts";
import { surfaceGeom, turn } from "./views/breadboard.ts";

export type FixIds = <P extends EntityPrefix>(prefix: P) => EntityId<P>;

type Seat = { x: number; y: number; legs: Record<string, string> };

export type FixPreview = { before: string[]; after: string[] };

/** A fix of a finding as the Problems panel shows it. A fix with no ops is advice only. */
export type ResolvedFix = {
  kind: FindingFix["kind"];
  messageKey: string;
  args: Record<string, string | number>;
  ops: Op[];
  /** What the ops were made from, so that several fixes can be built into one batch. */
  plan?: FixPlan;
  safe: boolean;
  preview: FixPreview;
};

export type FixDeps = { reg: Pick<PartRegistry, "get" | "latest">; ids?: FixIds };

const SYSTEM_AUTHOR = { actor: "iynk", kind: "system" } as const;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const SEAT_TOLERANCE_MM = 0.05;

const definedLegs = (legs: Record<string, string | undefined> = {}): Record<string, string> =>
  Object.fromEntries(Object.entries(legs).flatMap(([pin, hole]) => (hole === undefined ? [] : [[pin, hole]])));

const surfaceGeomOf = (deps: Required<FixDeps>, definition: { ref: string; version: string }) => {
  const d = deps.reg.get(definition.ref, definition.version);
  return d && surfaceGeom(d);
};
const PLACE_OFFSET_MM = { x: 12, y: 8 };
/** A resistor on a breadboard spans four columns: its legs are in P1 = column, P2 = column + 4. */
const RESISTOR_SPAN = 4;
const GRID_HOLE = /^([a-j])(\d{1,2})$/;
const HALF_ROWS = ["abcde", "fghij"] as const;
const PREVIEW_LINES = 4;
const BASE_OHMS = 1000;
const NPN = "core.npn-2n2222";
const DIODE = "core.diode-1n4007";
const RESISTOR = "core.resistor";

/** One build threads the ids, refdes and dependencies it hands out, so several fixes can go into one batch. */
class Build {
  readonly ops: Op[] = [];
  private readonly nodes: Netlist;
  private readonly refdes: Set<string>;
  private readonly pinned = new Set<string>();
  private placed = 0;

  constructor(
    readonly doc: Project,
    private readonly deps: Required<FixDeps>,
  ) {
    this.nodes = netlist(doc);
    this.refdes = new Set([...doc.boards, ...doc.components].map((c) => c.refdes));
    for (const dep of doc.dependencies.components) this.pinned.add(`${dep.ref}@${dep.version}`);
  }

  /** The document net a node of the rules' view stands for. */
  netOfNode(node: string): string | undefined {
    return this.nodes.nodes.find((n) => n.id === node)?.nets[0];
  }

  netOfPin(pin: { part: string; pin: string }): string | undefined {
    return this.doc.nets.find((n) => n.connections.some((c) => c.c === pin.part && c.p === pin.pin))?.id;
  }

  newNet(pins: PinRef[]): string {
    const id = this.deps.ids("net");
    this.ops.push({ k: "net.create", net: { id, connections: pins as [PinRef, ...PinRef[]] } });
    return id;
  }

  connect(net: string, c: string, p: string, move = false): void {
    this.ops.push({ k: "net.connect", net, pin: { c, p }, ...(move ? { move } : {}) });
  }

  /** A new part of the palette, drawn beside `near` in every view that shows it, or where `seats` puts it in a view. */
  addPart(ref: string, near: string, params?: Component["params"], seats: ReadonlyMap<string, Seat> = new Map()): string | undefined {
    const d = this.deps.reg.latest(ref);
    if (!d) return undefined;
    const id = this.deps.ids("cmp");
    const key = `${d.id}@${d.version}`;
    if (!this.pinned.has(key)) {
      this.pinned.add(key);
      this.ops.push({ k: "dep.set", dependency: { ref: d.id, version: d.version, origin: "builtin", interface: interfaceOf(d) } });
    }
    const prefix = refdesPrefix(d);
    let n = 1;
    while (this.refdes.has(`${prefix}${n}`)) n++;
    const refdes = `${prefix}${n}`;
    this.refdes.add(refdes);
    this.ops.push({ k: "component.add", component: { id, definition: { ref: d.id, version: d.version }, refdes, ...(params ? { params } : {}) } });
    this.placed++;
    for (const view of this.doc.views) {
      const seat = seats.get(view.id);
      const at = view.kind === "board" || view.kind === "mat" ? undefined : view.placements.find((p) => p.c === near);
      if (seat) this.ops.push({ k: "view.place", view: view.id, placement: { c: id, x_mm: seat.x, y_mm: seat.y, rotation_deg: 0, legs: seat.legs } });
      else if (at) this.ops.push({ k: "view.place", view: view.id, placement: { c: id, x_mm: at.x_mm + PLACE_OFFSET_MM.x, y_mm: at.y_mm + PLACE_OFFSET_MM.y * this.placed, rotation_deg: 0 } });
    }
    return id;
  }

  private series(at: { part: string; pin: string }, ohms: number): string | undefined {
    const net = this.netOfPin(at);
    const moves = net ? this.reseat(at) : undefined;
    const r = net && moves && this.addPart(RESISTOR, at.part, { ohms }, moves.seats);
    if (!net || !moves || !r) return undefined;
    this.ops.push(...moves.cut);
    const [old, through] = moves.swapped ? (["P2", "P1"] as const) : (["P1", "P2"] as const);
    this.connect(net, r, old);
    const side = this.newNet([{ c: r, p: through }]);
    this.connect(side, at.part, at.pin, true);
    this.ops.push(...moves.wires(net));
    return side;
  }

  /**
   * On a breadboard the strip a leg sits in carries one net, so a resistor between a leg and what it was wired to must
   * stand across two strips: the leg keeps its strip and the resistor's other end goes to a free strip four columns
   * away, with the wires that met the leg moved there. Returns undefined when the layout has no room or the strip
   * holds another part.
   */
  private reseat(at: { part: string; pin: string }): { seats: Map<string, Seat>; cut: Op[]; swapped: boolean; wires(net: string): Op[] } | undefined {
    const seats = new Map<string, Seat>();
    const cut: Op[] = [];
    const moved: ((net: string) => Op[])[] = [];
    let swapped: boolean | undefined;
    for (const view of this.doc.views) {
      const seated = view.placements.find((p) => p.c === at.part)?.legs?.[at.pin];
      if (view.kind !== "breadboard" || seated === undefined) continue;
      const plan = this.seatIn(view, at, seated);
      if (!plan || (swapped !== undefined && swapped !== plan.swapped)) return undefined;
      swapped = plan.swapped;
      seats.set(view.id, plan.seat);
      cut.push(...plan.cut);
      moved.push((id) => plan.wires.map((w): Op => ({ k: "wire.add", view: view.id, wire: { ...w, id: this.deps.ids("wir"), net: id } })));
    }
    return { seats, cut, swapped: swapped ?? false, wires: (id) => moved.flatMap((make) => make(id)) };
  }

  private seatIn(view: View, at: { part: string; pin: string }, hole: string): { seat: Seat; cut: Op[]; wires: Wire[]; swapped: boolean } | undefined {
    const surface = this.doc.components.find((c) => c.id === view.surface);
    const surfacePlacement = view.placements.find((p) => p.c === view.surface);
    const resistor = this.deps.reg.latest(RESISTOR);
    const grid = surface && surfaceGeomOf(this.deps, surface.definition);
    const [, row, column] = GRID_HOLE.exec(hole) ?? [];
    const p1 = resistor?.pins.find((p) => p.id === "P1")?.position;
    if (!grid || !surfacePlacement || !resistor || !p1 || !row || !column) return undefined;

    const stripOf = (h: string): string | undefined => grid.byName.get(h)?.strip;
    const holeEnds = (w: Wire) => [w.from, w.to].flatMap((e) => (e.kind === "hole" && e.surface === view.surface ? [e.hole] : []));
    const taken = new Set([...view.placements.flatMap((p) => Object.values(p.legs ?? {})), ...view.wires.flatMap(holeEnds)].filter((h): h is string => h !== undefined));
    const mine = stripOf(hole);
    if (view.placements.some((p) => p.c !== at.part && Object.values(p.legs ?? {}).some((h) => h !== undefined && stripOf(h) === mine))) return undefined;
    const meeting = view.wires.filter((w) => holeEnds(w).some((h) => stripOf(h) === mine));
    if (meeting.some((w) => holeEnds(w).length === 2 && holeEnds(w).every((h) => stripOf(h) === mine))) return undefined;
    const takenStrips = new Set([...taken].map(stripOf));

    const rows = HALF_ROWS.find((half) => half.includes(row)) ?? "";
    for (const delta of [-RESISTOR_SPAN, RESISTOR_SPAN]) {
      const there = Number(column) + delta;
      const across = [...rows].map((r) => `${r}${there}`).filter((h) => grid.byName.has(h));
      const spare = (r: string) => !taken.has(`${r}${column}`) && !taken.has(`${r}${there}`) && across.includes(`${r}${there}`);
      const free = [...rows].find(spare);
      if (free === undefined || across.length === 0 || takenStrips.has(stripOf(across[0]!))) continue;
      const room = across.filter((h) => h !== `${free}${there}`);
      if (room.length < meeting.length) continue;

      const swapped = delta > 0;
      const legs = swapped ? { P1: `${free}${column}`, P2: `${free}${there}` } : { P1: `${free}${there}`, P2: `${free}${column}` };
      const anchor = grid.byName.get(legs.P1)!;
      const height = resistor.dimensions?.body?.h ?? 0;
      const seat = { x: round2(surfacePlacement.x_mm + anchor.xMm - p1.x), y: round2(surfacePlacement.y_mm + anchor.yMm - (height - p1.y)), legs };
      const spares = [...room];
      const wires = meeting.map((w): Wire => {
        const end = (e: Wire["from"]): Wire["from"] => (e.kind === "hole" && e.surface === view.surface && stripOf(e.hole) === mine ? { kind: "hole", surface: e.surface, hole: spares.shift()! } : e);
        const { route_mm: _route, ...rest } = w;
        return { ...rest, from: end(w.from), to: end(w.to) };
      });
      return { seat, cut: meeting.map((w): Op => ({ k: "wire.remove", view: view.id, id: w.id })), wires, swapped };
    }
    return undefined;
  }

  private toRail(net: string | undefined, rail: string | undefined, ohms: number, near: string): boolean {
    const r = net && rail && net !== rail ? this.addPart(RESISTOR, near, { ohms }) : undefined;
    if (!net || !rail || !r) return false;
    this.connect(net, r, "P1");
    this.connect(rail, r, "P2");
    return true;
  }

  private turn(plan: Extract<FixPlan, { t: "turn" }>): boolean {
    const seated = this.doc.views.filter((v) => v.kind === "breadboard" && v.placements.find((p) => p.c === plan.part)?.legs?.[plan.a] !== undefined);
    if (seated.length > 1) return false;
    const view = seated[0];
    if (view) return this.turnSeated(view, plan);
    const [a, b] = [this.netOfPin({ part: plan.part, pin: plan.a }), this.netOfPin({ part: plan.part, pin: plan.b })];
    const alone = (id: string) => (this.doc.nets.find((n) => n.id === id)?.connections.length ?? 0) < 2;
    if (!a || !b || a === b || alone(a) || alone(b)) return false;
    this.connect(b, plan.part, plan.a, true);
    this.connect(a, plan.part, plan.b, true);
    return true;
  }

  /** A two-legged part seated in a breadboard is turned half way round, which puts each leg in the other's hole; the nets follow the strips. */
  private turnSeated(view: View, plan: Extract<FixPlan, { t: "turn" }>): boolean {
    const placement = view.placements.find((p) => p.c === plan.part);
    const surface = this.doc.components.find((c) => c.id === view.surface);
    const part = this.doc.components.find((c) => c.id === plan.part);
    const grid = surface && surfaceGeomOf(this.deps, surface.definition);
    const d = part && this.deps.reg.get(part.definition.ref, part.definition.version);
    const surfaceAt = view.placements.find((p) => p.c === view.surface);
    const [pa, pb] = [plan.a, plan.b].map((id) => d?.pins.find((p) => p.id === id)?.position);
    const [ha, hb] = [placement?.legs?.[plan.a], placement?.legs?.[plan.b]];
    if (!placement || !grid || !d || !surfaceAt || !pa || !pb || !ha || !hb) return false;

    const height = d.dimensions?.body?.h ?? 0;
    const offset = (p: { x: number; y: number }) => ({ x: p.x, y: height - p.y });
    const rotation = ((((placement.rotation_deg ?? 0) + 180) % 360) as Rotation);
    const [holeA, holeB] = [grid.byName.get(ha), grid.byName.get(hb)];
    if (!holeA || !holeB) return false;
    const turnedA = turn(offset(pa), rotation);
    const turnedB = turn(offset(pb), rotation);
    const origin = { x: surfaceAt.x_mm + holeB.xMm - turnedA.x, y: surfaceAt.y_mm + holeB.yMm - turnedA.y };
    const lands = { x: origin.x + turnedB.x - surfaceAt.x_mm - holeA.xMm, y: origin.y + turnedB.y - surfaceAt.y_mm - holeA.yMm };
    if (Math.hypot(lands.x, lands.y) > SEAT_TOLERANCE_MM) return false;

    const legs: Record<string, string> = { ...definedLegs(placement.legs), [plan.a]: hb, [plan.b]: ha };
    this.ops.push({ k: "view.place", view: view.id, placement: { ...placement, x_mm: round2(origin.x), y_mm: round2(origin.y), rotation_deg: rotation, legs } });
    this.ops.push(...legRecipe(this.doc, view.id, plan.part, legs, this.deps.ids));
    return true;
  }

  private driver(plan: Extract<FixPlan, { t: "driver" }>): boolean {
    const gpioNet = this.netOfPin(plan.gpio);
    const ground = this.netOfNode(plan.ground);
    const supply = this.netOfNode(plan.supply);
    if (!gpioNet || !ground || !supply) return false;
    const q = this.addPart(NPN, plan.motor.part);
    const rb = this.addPart(RESISTOR, plan.motor.part, { ohms: BASE_OHMS });
    const d = this.addPart(DIODE, plan.motor.part);
    if (!q || !rb || !d) return false;
    this.connect(gpioNet, rb, "P1");
    this.newNet([{ c: rb, p: "P2" }, { c: q, p: "B" }]);
    const collector = this.newNet([{ c: q, p: "C" }]);
    this.connect(collector, plan.motor.part, plan.motor.pin, true);
    this.connect(ground, q, "E");
    if (this.netOfPin(plan.other) !== supply) this.connect(supply, plan.other.part, plan.other.pin, true);
    this.connect(supply, d, "K");
    this.connect(collector, d, "A");
    return true;
  }

  private divider(plan: Extract<FixPlan, { t: "divider" }>): boolean {
    const through = this.series(plan.at, plan.top);
    const ground = this.netOfNode(plan.ground);
    return through !== undefined && this.toRail(through, ground, plan.bottom, plan.at.part);
  }

  private edit(plan: Extract<FixPlan, { t: "edit" }>): boolean {
    const edits = plan.edits.map((e) => ({ ...e, id: this.doc.sources.find((s) => s.path === e.file)?.id }));
    if (edits.some((e) => e.id === undefined)) return false;
    for (const e of edits) this.ops.push({ k: "source.edit", id: e.id!, baseSeq: this.doc.revision, pos: e.pos, del: e.del, ins: e.ins });
    return true;
  }

  add(plan: FixPlan): boolean {
    switch (plan.t) {
      case "series":
        return this.series(plan.at, plan.ohms) !== undefined;
      case "to-rail":
        return this.toRail(this.netOfNode(plan.net), this.netOfNode(plan.rail), plan.ohms, plan.near);
      case "turn":
        return this.turn(plan);
      case "join": {
        const net = this.netOfNode(plan.net);
        if (!net) return false;
        this.connect(net, plan.pin.part, plan.pin.pin);
        return true;
      }
      case "cut": {
        const pins = plan.pins.filter((p) => this.netOfPin(p) !== undefined);
        for (const p of pins) this.ops.push({ k: "net.disconnect", pin: { c: p.part, p: p.pin } });
        return pins.length > 0;
      }
      case "driver":
        return this.driver(plan);
      case "divider":
        return this.divider(plan);
      case "edit":
        return this.edit(plan);
    }
  }
}

const defaults = (deps: FixDeps): Required<FixDeps> => ({ ids: deps.ids ?? ((prefix) => newId(prefix)), reg: deps.reg });

/** The ops of the plans in one batch and the document they make, or undefined when a plan does not fit the document or the document refuses the batch. */
function planBatch(doc: Project, plans: readonly FixPlan[], deps: FixDeps): { ops: Op[]; after: Project } | undefined {
  const build = new Build(doc, defaults(deps));
  if (!plans.every((plan) => build.add(plan)) || build.ops.length === 0) return undefined;
  const applied = applyDetached(doc, build.ops, { author: SYSTEM_AUTHOR, at: doc.meta.updatedAt, invariants: checkBatch });
  return applied.ok ? { ops: build.ops, after: applied.state } : undefined;
}

/** One batch for every safe fix, so each gets its own refdes and ids; undefined when there is none or the document refuses the batch. */
export const safeFixOps = (doc: Project, fixes: readonly ResolvedFix[], deps: FixDeps): Op[] | undefined => {
  const plans = fixes.flatMap((fix) => (fix.safe && fix.plan ? [fix.plan] : []));
  return plans.length === 0 ? undefined : planBatch(doc, plans, deps)?.ops;
};

export const formatOhms = (ohms: number): string => (ohms >= 1_000_000 ? `${ohms / 1_000_000} MΩ` : ohms >= 1000 ? `${ohms / 1000} kΩ` : `${ohms} Ω`);

const labelOf = (doc: Project) => {
  const names = new Map([...doc.boards, ...doc.components].map((c) => [c.id, c.refdes]));
  return (pin: PinRef): string => `${names.get(pin.c) ?? pin.c}.${pin.p}`;
};

function pinsTouched(ops: readonly Op[], after: Project): PinRef[] {
  const pins: PinRef[] = [];
  for (const op of ops) {
    if (op.k === "net.connect" || op.k === "net.disconnect") pins.push(op.pin);
    else if (op.k === "net.create") pins.push(...op.net.connections);
    else if (op.k === "component.add") pins.push(...after.nets.flatMap((n) => n.connections).filter((c) => c.c === op.component.id));
  }
  return pins;
}

const netLine = (label: (pin: PinRef) => string, pins: readonly PinRef[]): string => {
  const names = pins.map(label);
  return names.length > PREVIEW_LINES + 2 ? `${names.slice(0, PREVIEW_LINES + 2).join(" - ")} - ...` : names.join(" - ");
};

function netLines(doc: Project, touched: readonly PinRef[]): string[] {
  const label = labelOf(doc);
  const touches = (pins: readonly PinRef[]) => pins.some((p) => touched.some((t) => t.c === p.c && t.p === p.p));
  return doc.nets.filter((n) => n.connections.length > 1 && touches(n.connections)).map((n) => netLine(label, n.connections));
}

/** The lines of each edited source that differ, with the line number, from the first line that changed. */
function codeLines(before: Project, after: Project, ops: readonly Op[]): FixPreview {
  const out: FixPreview = { before: [], after: [] };
  const ids = new Set(ops.flatMap((op) => (op.k === "source.edit" ? [op.id] : [])));
  for (const id of ids) {
    const [was, now] = [before.sources.find((s) => s.id === id), after.sources.find((s) => s.id === id)];
    if (!was || !now) continue;
    const [a, b] = [was.content.split("\n"), now.content.split("\n")];
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    const show = (lines: string[], to: string[]) => lines.slice(head, lines.length - tail).slice(0, PREVIEW_LINES).forEach((line, i) => to.push(`${was.path}:${head + i + 1}  ${line.trim()}`));
    show(a, out.before);
    show(b, out.after);
  }
  return out;
}

/** What the ops change, written for the Before and After columns: the nets they touch, the parts they add and the code lines they edit. */
export function previewOf(doc: Project, after: Project, ops: readonly Op[]): FixPreview {
  const touched = pinsTouched(ops, after);
  const before = netLines(doc, touched);
  const now = netLines(after, touched);
  const added = ops.flatMap((op) => {
    if (op.k !== "component.add") return [];
    const ohms = op.component.params?.ohms;
    return [typeof ohms === "number" ? `${op.component.refdes}: ${formatOhms(ohms)}` : op.component.refdes];
  });
  const code = codeLines(doc, after, ops);
  return {
    before: [...before.filter((line) => !now.includes(line)), ...code.before],
    after: [...added, ...now.filter((line) => !before.includes(line)), ...code.after],
  };
}

/** A part id in a message argument reads as its refdes, a resistor value as ohms. */
function argsOf(doc: Project, args: FindingFix["args"]): ResolvedFix["args"] {
  const names = new Map([...doc.boards, ...doc.components].map((c) => [c.id, c.refdes]));
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, key === "ohms" && typeof value === "number" ? formatOhms(value) : typeof value === "string" ? value.replace(/\b[a-z]{3}_[a-z0-9_-]+/g, (id) => names.get(id) ?? id) : value]),
  );
}

/** Turns the fixes of a finding into what the panel shows. A fix the document would refuse is kept as advice. */
export function resolveFixes(doc: Project, fixes: readonly FindingFix[] | undefined, deps: FixDeps): ResolvedFix[] {
  return (fixes ?? []).map((fix) => {
    const batch = fix.plan ? planBatch(doc, [fix.plan], deps) : undefined;
    return {
      kind: fix.kind,
      messageKey: fix.messageKey,
      args: argsOf(doc, fix.args),
      ops: batch?.ops ?? [],
      ...(batch && fix.plan ? { plan: fix.plan } : {}),
      safe: batch !== undefined && fix.safe === true,
      preview: batch ? previewOf(doc, batch.after, batch.ops) : { before: [], after: [] },
    };
  });
}
