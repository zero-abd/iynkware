import type { Project } from "../../project/generated/types.ts";
import type { PartRegistry } from "../../parts/registry.ts";
import { PROFILES, boardIdOf, pinElectrical } from "../boards/profiles.ts";
import type { SimPart } from "../engine.ts";
import { makeModelEnv, resolveLayers } from "../models/kinds.ts";
import { buildSimNetlist } from "../netlist.ts";
import { PWL_COMPAT } from "./elements.ts";
import { buildElements } from "./live.ts";
import type { PartLayers } from "./live.ts";
import { forNewton } from "./newton-bridge.ts";
import type { DiodeParams, Element, ElementOa, ElementTmr, ElementVw } from "./types.ts";

/** One thing the deck leaves out or approximates. Shaped like the export module's `LossItem`, which the sim layer does not import. */
export interface SpiceLoss {
  code: string;
  severity: "info" | "warning" | "error";
  path?: string;
  message: string;
  args?: Record<string, string | number>;
}

export const SPICE_LOSS = {
  notModelled: "spice.not-modelled",
  floating: "spice.board-pins-open",
  instruments: "spice.instruments-left-out",
  limit: "spice.source-limit",
  slew: "spice.slew-left-out",
  phase: "spice.phase-left-out",
  nothing: "spice.nothing-to-export",
} as const;

export interface SpiceExport {
  /** The `.cir` file: one deck that `ngspice -b` runs, with a `.tran` card sized from the circuit. */
  text: string;
  /** The SPICE node of every net of the project, by net id (the solver's own ids). Ground is `0`. */
  nodes: ReadonlyMap<string, string>;
  loss: SpiceLoss[];
}

export interface SpiceOptions {
  exportedAt: string;
  appVersion: string;
  /** Length of the `.tran` card in seconds; with none, the project's own run length. */
  stopSeconds?: number;
  /** Largest step of the `.tran` card in seconds; with none, a two thousandth of the length, at most a millisecond. */
  stepSeconds?: number;
}

const num = (x: number): string => String(Number(x.toPrecision(10)));
const clean = (text: string): string => text.replace(/[^A-Za-z0-9_]/g, "_");
const MIN_OHMS = PWL_COMPAT.minOhms;

const profileOf = (part: SimPart) => (part.kind === "board" ? PROFILES[boardIdOf(part.descriptor)] : undefined);

/** Every behavioural part is a subcircuit, written once into the deck however many of them the circuit has. */
const OPAMP_SUBCKT = [
  ".subckt IYNK_OPAMP inp inn out vcc vee PARAMS: gain=1e5 gbw=1e6 rout=75 hr=1.5 hrl=0.02",
  "* one pole at gbw/gain on the open-loop drive, then a tanh clamp inside the rails, as the solver does",
  "B_drive t 0 V = (V(vcc) + V(vee) + hrl - hr) / 2 + gain * (V(inp) - V(inn))",
  "R_pole t w 1",
  "C_pole w 0 {gain / (6.283185307 * gbw)}",
  "B_out o 0 V = (V(vcc) + V(vee) + hrl - hr) / 2 + (V(vcc) - V(vee) - hr - hrl) / 2 * tanh((V(w) - (V(vcc) + V(vee) + hrl - hr) / 2) / ((V(vcc) - V(vee) - hr - hrl) / 2))",
  "R_out o out {rout}",
  ".ends IYNK_OPAMP",
];

const TIMER_SUBCKT = [
  ".subckt IYNK_555 gnd trig out reset ctrl thr dis vcc PARAMS: rout=20 drop=1.7 disr=10 iq=0.0003",
  "* the bipolar 555: a 5k, 10k divider sets the thresholds at 1/3 and 2/3 of ctrl; the latch is a capacitor two switches charge",
  "R_up vcc ctrl 5k",
  "R_lo ctrl gnd 10k",
  "B_iq vcc gnd I = max(0, iq * min(1, max(0, V(vcc,gnd)) / 5) - V(vcc,gnd) / 15k)",
  "B_ok ok 0 V = (V(reset,gnd) > 0.7 && V(vcc,gnd) >= 1) ? 1 : 0",
  "B_set set 0 V = (V(trig,gnd) < V(ctrl,gnd) / 2 && V(ok) > 0.5) ? 1 : 0",
  "B_clr clr 0 V = ((V(thr,gnd) > V(ctrl,gnd) && V(set) < 0.5) || V(ok) < 0.5) ? 1 : 0",
  "V_hi hi 0 1",
  "S_on hi q set 0 SWL",
  "S_off q 0 clr 0 SWL",
  "C_q q 0 1n",
  "R_q q 0 1e12",
  "B_vo vo 0 V = V(q) > 0.5 ? V(vcc) - drop : V(gnd)",
  "R_out vo out {rout}",
  "B_lo lo 0 V = V(q) < 0.5 && V(vcc,gnd) >= 1 ? 1 : 0",
  "S_dis dis gnd lo 0 SWD",
  ".model SWL SW(Vt=0.5 Vh=0.05 Ron=10 Roff=1e12)",
  ".model SWD SW(Vt=0.5 Vh=0.05 Ron={disr} Roff=1e12)",
  ".ends IYNK_555",
];

interface Deck {
  lines: string[];
  models: Map<string, string>;
  uses: { opamp: boolean; timer: boolean };
  /** Waveform sources whose start phase the card cannot carry. */
  phased: string[];
  node(n: number): string;
  label(id: string, letter: string): string;
  internal(base: string): string;
}

const waveCard = (e: ElementVw): string => {
  const period = e.hz > 0 ? 1 / e.hz : 0;
  const lo = e.offsetV - e.amplitudeV;
  const hi = e.offsetV + e.amplitudeV;
  const delay = period > 0 ? ((1 - ((e.phaseDeg / 360) % 1)) % 1) * period : 0;
  const edge = period / 1000;
  switch (e.shape) {
    case "sine":
      return `SIN(${num(e.offsetV)} ${num(e.amplitudeV)} ${num(e.hz)} 0 0 ${num(e.phaseDeg)})`;
    case "square":
      return `PULSE(${num(lo)} ${num(hi)} ${num(delay)} ${num(edge)} ${num(edge)} ${num(period / 2 - edge)} ${num(period)})`;
    case "pulse":
      return `PULSE(${num(e.offsetV)} ${num(hi)} ${num(delay)} ${num(edge)} ${num(edge)} ${num(Math.max(0, e.duty * period - edge))} ${num(period)})`;
    case "triangle": {
      return `PWL(0 ${num(e.offsetV)} ${num(period / 4)} ${num(hi)} ${num((3 * period) / 4)} ${num(lo)} ${num(period)} ${num(e.offsetV)}) r=0`;
    }
  }
};

function diodeModel(deck: Deck, p: DiodeParams): string {
  const zener = p.vbrVolts !== undefined;
  const parts = [`IS=${num(p.isAmps)}`, `N=${num(p.n)}`, `RS=${num(zener && p.rzOhms !== undefined ? p.rzOhms : p.rsOhms)}`];
  if (zener) parts.push(`BV=${num(p.vbrVolts!)}`, `IBV=${num(p.isAmps)}`, `NBV=${num(p.n)}`);
  const card = `D(${parts.join(" ")})`;
  const known = [...deck.models].find(([, text]) => text === card);
  if (known) return known[0];
  const name = `${zener ? "DZ" : "DX"}${deck.models.size + 1}`;
  deck.models.set(name, card);
  return name;
}

function series(deck: Deck, label: string, suffix: string, ohms: number, a: number, inner: string): void {
  if (ohms > 0) deck.lines.push(`${label}_${suffix} ${deck.node(a)} ${inner} ${num(Math.max(ohms, MIN_OHMS))}`);
}

function emit(deck: Deck, el: Element): boolean {
  const n = deck.node;
  const name = (letter: string) => deck.label(el.id, letter);
  switch (el.kind) {
    case "R":
      deck.lines.push(`${name("R")} ${n(el.a)} ${n(el.b)} ${num(Math.max(el.ohms, MIN_OHMS))}`);
      return true;
    case "POT": {
      const x = Math.max(0, Math.min(1, el.position));
      deck.lines.push(
        `${name("R")}_1 ${n(el.a)} ${n(el.wiper)} ${num(Math.max(el.ohms * x, PWL_COMPAT.potMinOhms))}`,
        `${name("R")}_2 ${n(el.wiper)} ${n(el.b)} ${num(Math.max(el.ohms * (1 - x), PWL_COMPAT.potMinOhms))}`,
      );
      return true;
    }
    case "V":
    case "VW": {
      const inner = deck.internal(el.id);
      const source = el.kind === "V" ? `DC ${num(el.volts)}` : waveCard(el);
      if (el.kind === "VW" && el.shape !== "sine" && el.phaseDeg !== 0) deck.phased.push(el.id);
      deck.lines.push(`${name("V")} ${inner} ${n(el.b)} ${source}`, `${name("R")}_s ${inner} ${n(el.a)} ${num(Math.max(el.rSeriesOhms, MIN_OHMS))}`);
      return true;
    }
    case "D": {
      const shaped = forNewton(el, true);
      const model = diodeModel(deck, (shaped as typeof el).junction!);
      deck.lines.push(`${name("D")} ${n(el.a)} ${n(el.b)} ${model}`);
      return true;
    }
    case "C": {
      const inner = el.esrOhms > 0 ? deck.internal(el.id) : n(el.a);
      deck.lines.push(`${name("C")} ${inner} ${n(el.b)} ${num(el.farads)}${el.v0 === undefined ? "" : ` IC=${num(el.v0)}`}`);
      if (el.esrOhms > 0) series(deck, name("R"), "esr", el.esrOhms, el.a, inner);
      return true;
    }
    case "L": {
      const inner = el.dcrOhms > 0 ? deck.internal(el.id) : n(el.b);
      deck.lines.push(`${name("L")} ${n(el.a)} ${inner} ${num(el.henries)}${el.i0 === undefined ? "" : ` IC=${num(el.i0)}`}`);
      if (el.dcrOhms > 0) series(deck, name("R"), "dcr", el.dcrOhms, el.b, inner);
      return true;
    }
    case "OA": {
      deck.uses.opamp = true;
      deck.lines.push(opampCard(deck, el));
      return true;
    }
    case "TMR": {
      deck.uses.timer = true;
      deck.lines.push(timerCard(deck, el));
      return true;
    }
    case "PIN":
      return el.level !== "Z";
    default:
      return false;
  }
}

function opampCard(deck: Deck, e: ElementOa): string {
  const n = deck.node;
  const low = e.headroomLowVolts ?? e.headroomVolts;
  return `${deck.label(e.id, "X")} ${n(e.inP)} ${n(e.inN)} ${n(e.out)} ${n(e.vcc)} ${n(e.vee)} IYNK_OPAMP gain=${num(e.openLoopGain)} gbw=${num(e.gbwHz)} rout=${num(Math.max(e.rOutOhms, MIN_OHMS))} hr=${num(e.headroomVolts)} hrl=${num(low)}`;
}

function timerCard(deck: Deck, e: ElementTmr): string {
  const n = deck.node;
  return `${deck.label(e.id, "X")} ${n(e.gnd)} ${n(e.trig)} ${n(e.out)} ${n(e.reset)} ${n(e.ctrl)} ${n(e.thr)} ${n(e.dis)} ${n(e.vcc)} IYNK_555 rout=${num(Math.max(e.rOutOhms, MIN_OHMS))} drop=${num(e.highDropVolts)} disr=${num(Math.max(e.disOnOhms, MIN_OHMS))} iq=${num(e.quiescentAmps)}`;
}

/**
 * The analog circuit of a project as a SPICE deck that ngspice runs: the elements the live solver builds, with their values,
 * an LED, diode or Zener as a `.model` of the same Shockley figures the solver uses, and the LM358 and the 555 as the
 * subcircuits above. Board pins the firmware drives are left open; the deck holds the circuit as it stands at the start of a run.
 */
export function exportSpice(project: Project, registry: Pick<PartRegistry, "get">, opts: SpiceOptions): SpiceExport {
  const { net } = buildSimNetlist(project, registry);
  const env = makeModelEnv((ref, version) => registry.get(ref, version));
  const layers = new Map<string, PartLayers>();
  for (const part of net.parts) {
    if (part.kind === "board") continue;
    const at = part.descriptor.lastIndexOf("@");
    const descriptor = registry.get(part.descriptor.slice(0, at), part.descriptor.slice(at + 1));
    if (!descriptor) continue;
    const elements = resolveLayers(descriptor, part.params, env).layers.filter((l) => l.kind === "element");
    if (elements.length > 0) layers.set(part.id, { elements, drives: [] });
  }
  const built = buildElements(
    net,
    (part) => {
      const profile = profileOf(part);
      return profile ? { ...pinElectrical(profile), logicVolts: profile.logicV } : null;
    },
    layers,
  );

  const refdes = new Map([...project.boards, ...project.components].map((p) => [p.id, p.refdes]));
  const names = new Map<number, string>([[0, "0"]]);
  const taken = new Set<string>(["0"]);
  const netNames = new Map(net.nets.map((n) => [n.id, n.name]));
  for (const [netId, node] of built.nodeOf) {
    if (node === 0) continue;
    const wanted = clean(netNames.get(netId) ?? "").toLowerCase();
    const name = wanted !== "" && /^[a-z]/.test(wanted) && !taken.has(wanted) ? wanted : `n${node}`;
    taken.add(name);
    names.set(node, name);
  }

  const labels = new Set<string>();
  const deck: Deck = {
    lines: [],
    models: new Map(),
    uses: { opamp: false, timer: false },
    phased: [],
    node: (k) => {
      let name = names.get(k);
      if (name === undefined) {
        name = `n${k}`;
        names.set(k, name);
      }
      return name;
    },
    label(id, letter) {
      const [first, ...rest] = id.split(":");
      const owner = first === "rail" ? rest[0]! : first!;
      const base = clean([refdes.get(owner) ?? owner, ...(first === "rail" ? rest.slice(1) : rest)].join("_"));
      let label = base.toUpperCase().startsWith(letter) ? base : `${letter}_${base}`;
      for (let k = 2; labels.has(label); k++) label = `${label}_${k}`;
      labels.add(label);
      return label;
    },
    internal: (base) => `x_${clean(base)}`,
  };

  const loss: SpiceLoss[] = [];
  const floating = new Set<string>();
  const body: string[] = [];
  for (const el of built.elements) {
    deck.lines = [];
    if (el.kind === "PIN") {
      floating.add(refdes.get(el.id.split(":")[1] ?? "") ?? "board");
      continue;
    }
    if (!emit(deck, el)) {
      loss.push({ code: SPICE_LOSS.notModelled, severity: "warning", path: el.id, message: `${el.id} (${el.kind}) has no SPICE model here and was left out`, args: { id: el.id, kind: el.kind } });
      continue;
    }
    if (el.kind === "V" && el.limit) {
      loss.push({ code: SPICE_LOSS.limit, severity: "info", path: el.id, message: `${el.id}: the ${el.limit.amps} A limit of the source is not in the deck`, args: { id: el.id, amps: el.limit.amps } });
    }
    body.push(...deck.lines);
  }
  for (const unmodelled of built.unmodelled) {
    loss.push({ code: SPICE_LOSS.notModelled, severity: "warning", path: unmodelled.part, message: `${unmodelled.part}: ${unmodelled.reason}`, args: { id: refdes.get(unmodelled.part) ?? unmodelled.part, kind: unmodelled.reason } });
  }
  for (const id of deck.phased) loss.push({ code: SPICE_LOSS.phase, severity: "warning", path: id, message: `${id}: the start phase of this waveform is not in the deck`, args: { id } });
  if (built.elements.some((e) => e.kind === "OA")) loss.push({ code: SPICE_LOSS.slew, severity: "info", message: "The op amp slew limit is not in the deck", args: {} });
  if (floating.size > 0) loss.push({ code: SPICE_LOSS.floating, severity: "info", message: "Board pins that firmware drives are left open", args: { count: floating.size } });
  if (project.simulation.instruments?.some((i) => i.kind === "function-generator" || i.kind === "power-supply")) {
    loss.push({ code: SPICE_LOSS.instruments, severity: "info", message: "Bench instruments are not part of the circuit and are left out", args: {} });
  }
  if (body.length === 0) loss.push({ code: SPICE_LOSS.nothing, severity: "error", message: "The project has no analog part to export", args: {} });

  const stop = opts.stopSeconds ?? project.simulation.duration_ms / 1000;
  const step = opts.stepSeconds ?? Math.min(1e-3, stop / 2000);
  const tran = `.tran ${num(step)} ${num(stop)} 0 ${num(step)} uic`;
  const text =
    [
      `* ${project.meta.title.replace(/[\r\n]+/g, " ")}`,
      `* Written by iynk ${opts.appVersion} on ${opts.exportedAt}. The solver's own element values; run it with ngspice.`,
      "* Nodes: 0 is ground" + [...built.nodeOf].filter(([id, k]) => k !== 0 && netNames.get(id)).map(([id, k]) => `, ${deck.node(k)} is ${netNames.get(id)}`).join(""),
      ...body,
      ...[...deck.models].map(([name, card]) => `.model ${name} ${card}`),
      ...(deck.uses.opamp ? OPAMP_SUBCKT : []),
      ...(deck.uses.timer ? TIMER_SUBCKT : []),
      ".options reltol=1e-4 abstol=1e-12 vntol=1e-6 gmin=1e-12",
      tran,
      ".end",
    ].join("\n") + "\n";

  return { text, nodes: new Map([...built.nodeOf].map(([id, k]) => [id, deck.node(k)])), loss };
}
