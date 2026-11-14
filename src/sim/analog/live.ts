import type { SimTime } from "../core/clock.ts";
import { type SimDiagnostic, simDiag } from "../core/diagnostic.ts";
import { RANK, type EngineSnapshot, type SimEvent, type SimNetlist, type SimPart } from "../engine.ts";
import type { PinElectrical } from "../boards/profiles.ts";
import type { LogicDrive } from "../digital/logic-part.ts";
import type { ResolvedLayer } from "../models/kinds.ts";
import { PWL_COMPAT } from "./elements.ts";
import { type BridgeChannel, type BridgeOutput, L298N, TB6612, l298nControl, tb6612Control } from "./devices/bridge.ts";
import type { Control, ControlIO } from "./devices/control.ts";
import { encoderControl } from "./devices/encoder.ts";
import { MOTORS, MOTOR_STEP_NS, stepRpm } from "./devices/motor.ts";
import { fsrOhms, ldrOhms, qtrVolts, soilVolts, tmp36Volts } from "../sensors/curves.ts";
import { BUCK_ILIM, buckControl, buckSetVolts, packControl, packOf, packOhms, packVolts } from "./devices/power.ts";
import type { Registry } from "../registry/types.ts";
import { UnionFind } from "./graph.ts";
import { ANALOG_LAYERS } from "./layers.ts";
import { NEWTON_OPTIONS, forNewton, needsNewton } from "./newton-bridge.ts";
import { type Brownout, type BoardPower, type RailState, createBrownout, droopSource, isLimited, USB_LIMIT } from "./rails.ts";
import { INSTRUMENT_PREFIX, type Readout, readoutOf } from "./readout.ts";
import { pwmSlices, solve } from "./solve.ts";
import { autoStepNs, clockStepNs } from "./step.ts";
import { SETTLE_SECONDS, TransientRun } from "./transient.ts";
import {
  type HonestState,
  type Solved,
  type StateTracker,
  brownOutState,
  brownOutUnknownState,
  createStateTracker,
  floatingInputState,
  noConvergenceState,
  notModelledState,
  partOf,
} from "./states.ts";
import type { Element, ElementId, ElementPin, ElementPwm, InstrumentReading, InstrumentSource, PartRating, SolveOptions, SolveResult, SourceLimit, TransientMemory, TransientStep } from "./types.ts";

export type NetId = string;
export type PartId = string;

/** A board pin's electrical model plus the supply its thresholds are fractions of. */
export interface BoardPin extends PinElectrical {
  logicVolts: number;
}

/** null: the part is not a board. Built from `pinElectrical(profile)` and `profile.logicV`. */
export type PinDirectory = (part: SimPart) => BoardPin | null;

export type Change =
  /** An input with `pull` set is held to the supply or to ground through the board's pull resistor. */
  | { kind: "pin"; element: ElementId; level: 0 | 1 | "Z"; pull?: "up" | "down" }
  | { kind: "pwm"; element: ElementId; duty: number; hz: number }
  | { kind: "source"; element: ElementId; volts: number }
  | { kind: "switch"; element: ElementId; closed: boolean }
  | { kind: "param"; element: ElementId; path: string; value: number }
  | { kind: "motor-speed"; element: ElementId; omegaRadPerS: number }
  /** `element` names the instrument, not a circuit element; null takes the source out. */
  | { kind: "instrument"; element: ElementId; source: InstrumentSource | null };

export interface AnalogStepResult {
  at: SimTime;
  converged: boolean;
  solves: number;
  skippedClean: number;
  events: SimEvent[];
  diagnostics: SimDiagnostic[];
  worstKclAmps: number;
  /** Present when this advance changed the step the solver takes (a generator put on a circuit with no time base): the new step, or null when it stopped stepping. */
  stepNs?: number | null;
}

export interface LoadReport {
  ok: boolean;
  /** The step the solver takes, in nanoseconds; null when the circuit is solved at its events only. */
  stepNs: number | null;
  components: number;
  nodes: number;
  elements: number;
  unmodelled: { part: PartId; reason: string }[];
  diagnostics: SimDiagnostic[];
  modelIds: string[];
}

/** The solver element of a bench instrument; it exists only while the instrument is set. */
export const instrumentElementId = (instrument: string): ElementId => `${INSTRUMENT_PREFIX}${instrument}`;

const PSU_SERIES_OHMS = 0.01;
/** A source that carries this share of its limit is holding it. */
const LIMIT_REACHED = 1 - 1e-3;

export type ElementLayer = Extract<ResolvedLayer, { kind: "element" }>;

/** What the orchestrator resolved for one placed part from its descriptor. */
export interface PartLayers {
  elements: readonly ElementLayer[];
  /** The output pins a logic layer drives. */
  drives: readonly LogicDrive[];
}

/** SIMULATION 7.2. */
export interface AnalogSolver {
  load(net: SimNetlist, o: SolveOptions, layers?: ReadonlyMap<PartId, PartLayers>): LoadReport;
  apply(changes: Change[]): void;
  advanceTo(t: SimTime): AnalogStepResult;
  snapshot(): EngineSnapshot;
  restore(s: EngineSnapshot): void;
}

export interface WhatIf {
  extra?: Element[];
  sources?: "live" | "off";
  params?: Record<ElementId, Partial<Element>>;
}

export interface LiveAnalog extends AnalogSolver {
  netVolts(net: NetId): number | null;
  pinVolts(element: ElementId): number | null;
  /** The node a net has in a `whatIf` result, or null for an unknown net. */
  nodeIndex(net: NetId): number | null;
  componentResult(net: NetId): SolveResult | null;
  /** Volts across a set instrument, amps out of its positive point and whether it holds its current limit; null when it is not set or its circuit did not solve. */
  instrumentReading(instrument: string): InstrumentReading | null;
  /** Clears the burnt latch of a part and puts its elements back. */
  repair(partId: PartId): void;
  /** Everything a frame carries, read from the last solve. */
  readout(): Readout;
  /** A pure re-solve of the whole circuit. Node numbers in `extra` and `params` are the ones `buildElements` gave. */
  whatIf(o: WhatIf): SolveResult;
}

const MODEL = {
  resistor: "model:resistor.linear@1",
  led: "model:led.pwl@1",
  diode: "model:diode.pwl@1",
  npn: "model:npn.pwl@1",
  source: "model:source.thevenin@1",
  button: "model:button.switch@1",
  pot: "model:pot.linear@1",
  motor: "model:motor.steady@1",
  servo: "model:servo.rule@1",
  coil: "model:stepper-coil.resistive@1",
  buzzer: "model:buzzer.rule@1",
  tmp36: "model:tmp36.rule@1",
} as const;

const ENGINE_ID = "engine:analog-live";
const NEWTON_ENGINE = "engine:mna-newton@1.0.0";
const GROUND = 0;
const JOIN_OHMS = 1e-3;
const OPEN_OHMS = 1e12;
/** The internal pull-up or pull-down of a microcontroller input; AVR datasheets give 20 to 50 kilohms. */
const PULL_OHMS = 35_000;
const USB_VOLTS = 5;
const LED_VF: Record<string, number> = { red: 2.0, yellow: 2.1, green: 2.2, blue: 3.0, white: 3.1 };
const RGB_CHANNELS = [["R", 0, 2.0], ["G", 2, 3.1], ["B", 3, 3.1]] as const;
const TRAFFIC_OHMS = 330;
const TRAFFIC_LEDS = [["R", 1, LED_VF.red], ["Y", 2, LED_VF.yellow], ["G", 3, LED_VF.green]] as const;
const BJT_ORDER: Record<string, { c: number; b: number; e: number }> = { EBC: { e: 0, b: 1, c: 2 }, CBE: { c: 0, b: 1, e: 2 } };

/** The 5 V pin is the USB port's, which sags past its current limit. */
const RAIL_VOLTS: [RegExp, number, SourceLimit?][] = [[/^P?5V$/, 5, USB_LIMIT], [/^P?3V3$/, 3.3], [/^VIN$/, USB_VOLTS]];
const NOT_SIGNAL = /^(GND\w*|POWER_\d+|NC|IOREF|AREF|RESET\d?|ICSP\w*|MISO2|MOSI2|SCK2|VBUS|EN)$/;

const NODE_FIELDS = {
  R: ["a", "b"], M: ["a", "b"], V: ["a", "b"], D: ["a", "b"], BZ: ["a", "b"],
  POT: ["a", "wiper", "b"], PIN: ["a"], PWM: ["a"], Q: ["c", "b", "e"], MOS: ["d", "g", "s"],
  SV: ["gnd", "vplus", "sig"], TS: ["supplyPos", "supplyNeg", "out"],
  C: ["a", "b"], L: ["a", "b"], VW: ["a", "b"],
  OA: ["inP", "inN", "out", "vcc", "vee"],
  TMR: ["gnd", "trig", "out", "reset", "ctrl", "thr", "dis", "vcc"],
} as const satisfies Record<Element["kind"], readonly string[]>;

type NodeFields = Record<string, number>;

const nodesOf = (el: Element): number[] => NODE_FIELDS[el.kind].map((f) => (el as unknown as NodeFields)[f]);

function mapNodes(el: Element, f: (node: number) => number): Element {
  const copy = { ...el } as unknown as NodeFields;
  for (const field of NODE_FIELDS[el.kind]) copy[field] = f(copy[field]);
  return copy as unknown as Element;
}

const num = (p: SimPart, key: string, fallback: number): number => {
  const v = p.params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};

const text = (p: SimPart, key: string, fallback: string): string => {
  const v = p.params[key];
  return typeof v === "string" ? v : fallback;
};

class Builder {
  readonly elements: Element[] = [];
  readonly controls: Control[] = [];
  readonly nodeOf = new Map<NetId, number>();
  nodes: number;

  constructor(net: SimNetlist) {
    this.nodeOf.set(net.ground, GROUND);
    this.nodes = 1;
    for (const n of net.nets) if (!this.nodeOf.has(n.id)) this.nodeOf.set(n.id, this.nodes++);
  }

  /** The node on the part's pin by position, or a private node when the pin is unconnected. */
  leg(part: SimPart, index: number): number {
    const net = Object.values(part.pins)[index];
    return (net == null ? undefined : this.nodeOf.get(net)) ?? this.nodes++;
  }

  named(part: SimPart, pin: string): number {
    const net = part.pins[pin];
    return (net == null ? undefined : this.nodeOf.get(net)) ?? this.nodes++;
  }

  add(el: Element): void {
    this.elements.push(el);
  }

  resistor(id: ElementId, a: number, b: number, ohms: number): void {
    this.add({ id, kind: "R", a, b, ohms });
  }

  /** The node on a named pin, or null when the pin is not wired. */
  wired(part: SimPart, pin: string): number | null {
    const net = part.pins[pin];
    return net == null ? null : (this.nodeOf.get(net) ?? null);
  }

  /** A driven output a control sets: a source from `gnd` behind the switch resistance, and a switch to the pin, open at first. */
  output(id: ElementId, gnd: number, pin: number, ohms: number): BridgeOutput {
    const inside = this.nodes++;
    this.add({ id, kind: "V", a: inside, b: gnd, volts: 0, rSeriesOhms: ohms });
    this.resistor(`${id}:sw`, inside, pin, OPEN_OHMS);
    return { id, switchId: `${id}:sw` };
  }

  led(id: ElementId, a: number, b: number, vf: number, maxAmps: number, rdOhms = 0.5): void {
    this.add({ id, kind: "D", a, b, modelId: MODEL.led, vf, rdOhms, maxAmps });
  }

  npn(id: ElementId, c: number, base: number, e: number, hfe: number, vbe: number, vcesat: number, rating: PartRating): void {
    this.add({ id, kind: "Q", c, b: base, e, polarity: "npn", modelId: MODEL.npn, hfe, hfr: 5, vbe, vcesat, rating });
  }
}

interface PartSpec {
  models: readonly string[];
  /** Adds the part's elements, or returns why it cannot be modelled and adds none. */
  build?: (b: Builder, p: SimPart) => string | void;
}

const noElement: PartSpec = { models: [] };

/** A two-lead sensor whose resistance follows what it senses: `curve` turns the part's setting into ohms. */
const sensorResistor = (param: string, fallback: number, curve: (value: number) => number): PartSpec => ({
  models: [MODEL.resistor],
  // a project made before the sensors had a curve gives the ohms itself
  build: (b, p) => b.resistor(p.id, b.leg(p, 0), b.leg(p, 1), typeof p.params.ohms === "number" ? p.params.ohms : curve(num(p, param, fallback))),
});

/**
 * A battery pack: its open-circuit volts from the state of charge, behind its internal resistance, drained by what the
 * circuit takes. A `volts` setting (benches and tests) pins it as a stiff source instead.
 */
const battery = (name: "aa-holder-4" | "lipo-2s"): PartSpec => ({
  models: [MODEL.source],
  build: (b, p) => {
    const [plus, minus] = [b.named(p, "PLUS"), b.named(p, "MINUS")];
    if (typeof p.params.volts === "number") {
      b.add({ id: p.id, kind: "V", a: plus, b: minus, volts: p.params.volts, rSeriesOhms: PWL_COMPAT.railOhms });
      return;
    }
    const pack = packOf(name, p.params.demo);
    b.add({ id: p.id, kind: "V", a: plus, b: minus, volts: packVolts(pack, pack.soc0), rSeriesOhms: packOhms(pack) });
    b.controls.push(packControl(p.id, plus, minus, pack));
  },
});

/** A motor with back-EMF and a turning shaft, from the ratings in `MOTORS`; `load` free takes the propeller off and stalled holds the shaft. */
const motor = (name: keyof typeof MOTORS): PartSpec => ({
  models: [MODEL.motor],
  build: (b, p) => {
    const { ohms, model } = MOTORS[name];
    const load = text(p, "load", "prop");
    b.add({
      id: p.id, kind: "M", a: b.leg(p, 0), b: b.leg(p, 1), ohms: num(p, "ohms", ohms), form: "emf", emfV: 0, rpm: 0,
      model: load === "free" ? { ...model, iLoadAmps: 0 } : model, ...(load === "stalled" ? { held: true } : {}),
    });
  },
});

function transistor(
  models: readonly string[],
  hfe: number,
  vbe: number,
  vcesat: number,
  rating: PartRating,
  order: (p: SimPart) => { c: number; b: number; e: number },
): PartSpec {
  return {
    models,
    build: (b, p) => {
      const at = order(p);
      b.npn(p.id, b.leg(p, at.c), b.leg(p, at.b), b.leg(p, at.e), num(p, "hfe", hfe), vbe, vcesat, rating);
    },
  };
}

const LOGIC_MAX_AMPS = 1;
/** The encoder's push-pull Hall outputs. */
const ENCODER_OUT_OHMS = 100;
/** 11 pulses a channel per motor turn through the 1:48 gearbox, per turn of the output shaft the rpm is of. */
const ENCODER_PULSES_PER_REV = 11 * 48;
/** A QTR node's 10 nF charged through the phototransistor, as a soft source. */
const QTR_OUT_OHMS = 10_000;
/** The capacitive soil probe's output resistance. */
const SOIL_OUT_OHMS = 10_000;
/** The PCA9685's logic draw, about 5 mA at 5 V. */
const PCA9685_VCC_OHMS = 1000;
/** The 78M05's output, as a stiff source. */
const REGULATOR_OHMS = 0.5;
/** The LM2596 module's output, stiff up to its current limit. */
const BUCK_OUT_OHMS = 0.05;
/** A multimeter on volts loads the circuit with 10 megohm. */
const METER_INPUT_OHMS = 1e7;
/** A bridge settles in a few passes: the regulator wakes the logic, the logic sets the outputs, the outputs load the supply. */
const CONTROL_PASSES = 4;
/** A control's change smaller than this share of the value is not solved for. */
const CONTROL_EPS = 1e-3;
/** A back-EMF that moves less than this does not make the circuit worth solving again. */
const MOTOR_EMF_EPS_VOLTS = 1e-3;

const layerNum = (layer: ElementLayer, key: string): number | undefined => {
  const v = layer.params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};

interface LayerSpec {
  terminals: readonly string[];
  model: string;
  /** Adds the layer's elements from the nodes of its terminals, or returns why it cannot. `id` is the part's, or the part's and the layer's when it has several. */
  build: (b: Builder, p: SimPart, layer: ElementLayer, nodes: readonly number[], id: ElementId) => string | void;
}

const diodeLayer = (model: string, stamp: (b: Builder, id: string, a: number, k: number, vf: number, rd: number, imax: number) => void): LayerSpec => ({
  terminals: ["anode", "cathode"],
  model,
  build: (b, p, layer, [a, k]) => {
    const vf = layerNum(layer, "vf");
    if (vf === undefined) return "the layer has no forward voltage";
    stamp(b, p.id, a, k, vf, layerNum(layer, "rd") ?? 0.5, layerNum(layer, "imax") ?? 0.02);
  },
});

const OPTIONAL_PARAMS: ReadonlySet<string> = new Set(["v0_volts", "rated_volts", "i0_amps", "rated_amps", "limit_amps", "pmax_watts", "polarized", "supply_max_volts", "output_max_amps"]);

/** Sets `path` ("junction.n") on `target`, making the objects on the way. */
function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  const last = keys.pop()!;
  let at = target;
  for (const key of keys) at = (at[key] ??= {}) as Record<string, unknown>;
  at[last] = value;
}

/**
 * An element made from its descriptor layer by the table in `layers.ts`. A value the placed part carries under the
 * layer's own key (a capacitor's `farads`) wins over the descriptor's.
 */
const analogLayer = (layerKind: keyof typeof ANALOG_LAYERS): LayerSpec => {
  const contract: { element: Element["kind"]; terminals: Record<string, string>; params: Record<string, string> } = ANALOG_LAYERS[layerKind];
  return {
    terminals: Object.keys(contract.terminals),
    model: NEWTON_ENGINE,
    build: (b, p, layer, nodes, id) => {
      const el: Record<string, unknown> = { id, kind: contract.element };
      Object.values(contract.terminals).forEach((field, i) => (el[field] = nodes[i]));
      for (const [key, path] of Object.entries(contract.params)) {
        const value = p.params[key] ?? layer.params[key];
        if (value === undefined) {
          if (OPTIONAL_PARAMS.has(key)) continue;
          return `the layer has no ${key}`;
        }
        setPath(el, path, value);
      }
      // A part from the drawer starts empty. A descriptor or a placed part can say otherwise with `v0_volts` and `i0_amps`.
      if (contract.element === "C") (el.polarized ??= false), (el.v0 ??= 0);
      if (contract.element === "L") el.i0 ??= 0;
      if (contract.element === "D") {
        const junction = el.junction as { kind?: string; rsOhms?: number; rzOhms?: number };
        junction.kind = "shockley";
        // The sheet gives a Zener's slope in breakdown only; the forward branch is the junction's own curve
        junction.rsOhms ??= 0;
        Object.assign(el, { modelId: MODEL.diode, vf: 0.7, rdOhms: junction.rzOhms ?? junction.rsOhms });
      }
      b.add(el as unknown as Element);
    },
  };
};

/** The generic path for a part with no hand-written spec: element layers of the kinds listed here. */
const LAYER_SPECS: Record<string, LayerSpec> = {
  res: {
    terminals: ["a", "b"],
    model: MODEL.resistor,
    build: (b, p, layer, [a, c]) => {
      const ohms = typeof p.params.ohms === "number" ? p.params.ohms : layerNum(layer, "ohms");
      if (ohms === undefined) return "the part has no resistance value yet";
      b.resistor(p.id, a, c, ohms);
    },
  },
  led: diodeLayer(MODEL.led, (b, id, a, k, vf, rd, imax) => b.led(id, a, k, vf, imax, rd)),
  diode: diodeLayer(MODEL.diode, (b, id, a, k, vf, rd, imax) => b.add({ id, kind: "D", a, b: k, modelId: MODEL.diode, vf, rdOhms: rd, maxAmps: imax })),
  motor: {
    terminals: ["a", "b"],
    model: MODEL.motor,
    build: (b, p, layer, [a, c]) => {
      const ohms = layerNum(layer, "ohms");
      if (ohms === undefined) return "the layer has no winding resistance";
      b.add({ id: p.id, kind: "M", a, b: c, ohms });
    },
  },
  capacitor: analogLayer("capacitor"),
  inductor: analogLayer("inductor"),
  waveform_source: analogLayer("waveform_source"),
  zener: analogLayer("zener"),
  opamp: analogLayer("opamp"),
  timer_555: analogLayer("timer_555"),
};

function buildLayers(b: Builder, p: SimPart, layers: PartLayers, modelIds: Set<string>): string | void {
  for (const layer of layers.elements) {
    const spec = LAYER_SPECS[layer.element];
    if (!spec) return `the live solver cannot build a ${layer.element} from a descriptor yet`;
    const pins = spec.terminals.map((t) => layer.terminals[t]);
    if (pins.some((pin) => pin === undefined)) return `the ${layer.element} layer needs terminals ${spec.terminals.join(" and ")}`;
    const id = layers.elements.length > 1 ? `${p.id}:${layer.layerId}` : p.id;
    const why = spec.build(b, p, layer, pins.map((pin) => b.named(p, pin!)), id);
    if (why) return why;
    modelIds.add(spec.model);
  }
  for (const drive of layers.drives) {
    b.add({ id: logicElementId(p.id, drive.pinId), kind: "PIN", a: b.named(p, drive.pinId), level: "Z", vHighVolts: drive.vHighVolts, rOutOhms: drive.rOutOhms, maxAmps: LOGIC_MAX_AMPS });
    modelIds.add(MODEL.source);
  }
}

const flip = (p: SimPart, i: number): number => (p.params.reversed === true ? 2 - i : i);

const SPECS: Record<string, PartSpec> = {
  resistor: { models: [MODEL.resistor], build: (b, p) => b.resistor(p.id, b.leg(p, 0), b.leg(p, 1), num(p, "ohms", 220)) },
  wire: noElement,
  breadboard: noElement,
  led: {
    models: [MODEL.led],
    build: (b, p) => b.led(p.id, b.leg(p, 0), b.leg(p, 1), num(p, "vf", LED_VF[text(p, "color", "red")] ?? LED_VF.red), num(p, "imax", 0.02)),
  },
  "rgb-led": {
    models: [MODEL.led],
    build: (b, p) => {
      const common = b.leg(p, 1);
      const anode = text(p, "common", "cathode") === "anode";
      for (const [channel, leg, vf] of RGB_CHANNELS) {
        const lead = b.leg(p, leg);
        b.led(`${p.id}:${channel}`, anode ? common : lead, anode ? lead : common, vf, 0.02);
      }
    },
  },
  "traffic-light": {
    models: [MODEL.led],
    build: (b, p) => {
      const ground = b.leg(p, 0);
      // each lamp has its own 330 ohm resistor on the board (figures/modules/traffic-light.js)
      for (const [channel, leg, vf] of TRAFFIC_LEDS) {
        const anode = b.nodes++;
        b.resistor(`${p.id}:${channel}R`, b.leg(p, leg), anode, TRAFFIC_OHMS);
        b.led(`${p.id}:${channel}`, anode, ground, vf, 0.02);
      }
    },
  },
  "diode-1n4007": {
    models: [MODEL.diode],
    build: (b, p) => b.add({ id: p.id, kind: "D", a: b.leg(p, 0), b: b.leg(p, 1), modelId: MODEL.diode, vf: 0.7, rdOhms: 0.2, maxAmps: 1 }),
  },
  "npn-2n2222": transistor([MODEL.npn], 100, 0.7, 0.2, { icmaxAmps: 0.6, thetaCPerW: 200, tjmaxC: 150 }, (p) => {
    const order = BJT_ORDER[text(p, "pinout", "EBC")] ?? BJT_ORDER.EBC;
    return { c: flip(p, order.c), b: flip(p, order.b), e: flip(p, order.e) };
  }),
  tip120: transistor([MODEL.npn], 1000, 1.3, 0.9, { icmaxAmps: 5, thetaCPerW: 62.5, tjmaxC: 150 }, (p) => ({ b: flip(p, 0), c: 1, e: flip(p, 2) })),
  "lipo-2s": battery("lipo-2s"),
  "aa-holder-4": battery("aa-holder-4"),
  "lm2596-module": {
    models: [MODEL.source, MODEL.resistor],
    build: (b, p) => {
      const [vin, gnd, vout, gndOut] = ["VIN", "GND_IN", "VOUT", "GND_OUT"].map((pin) => b.named(p, pin));
      // the two ground terminals are one track on the board
      b.resistor(`${p.id}:gnd`, gnd, gndOut, JOIN_OHMS);
      b.add({ id: p.id, kind: "V", a: vout, b: gndOut, volts: 0, rSeriesOhms: BUCK_OUT_OHMS, limit: { amps: BUCK_ILIM, mode: "droop" } });
      b.resistor(`${p.id}:in`, vin, gnd, 1e9);
      b.controls.push(buckControl({ out: p.id, outOhms: BUCK_OUT_OHMS, load: `${p.id}:in`, vin, gnd, vout, gndOut, vset: buckSetVolts(num(p, "trimmer_turns", 2.53)) }));
    },
  },
  "push-button": {
    models: [MODEL.button],
    build: (b, p) => {
      const [a1, a2, b1, b2] = [0, 1, 2, 3].map((i) => b.leg(p, i));
      b.resistor(`${p.id}:1-2`, a1, a2, JOIN_OHMS);
      b.resistor(`${p.id}:3-4`, b1, b2, JOIN_OHMS);
      b.resistor(p.id, a1, b1, num(p, "pressed", 0) > 0 ? JOIN_OHMS : OPEN_OHMS);
    },
  },
  "slide-switch": {
    models: [MODEL.button],
    build: (b, p) => {
      const [a, com, end] = [0, 1, 2].map((i) => b.leg(p, i));
      const onEnd = num(p, "closed", 0) > 0;
      b.resistor(`${p.id}:A`, com, a, onEnd ? OPEN_OHMS : JOIN_OHMS);
      b.resistor(`${p.id}:B`, com, end, onEnd ? JOIN_OHMS : OPEN_OHMS);
    },
  },
  potentiometer: {
    models: [MODEL.pot],
    build: (b, p) =>
      b.add({ id: p.id, kind: "POT", a: b.leg(p, 0), wiper: b.leg(p, 1), b: b.leg(p, 2), ohms: num(p, "ohms", 10000), position: num(p, "pos", 0.5), rating: { pmaxWatts: 0.05 } }),
  },
  ldr: sensorResistor("lux", 300, ldrOhms),
  fsr402: sensorResistor("force", 0, fsrOhms),
  "qtr-8rc": {
    models: [MODEL.source],
    // each RC node as the level the sketch reads, from where the line is; the IR LEDs are not drawn current from
    build: (b, p) => {
      const gnd = b.named(p, "GND");
      qtrVolts(num(p, "line", 3.5)).forEach((volts, i) => {
        const pin = `OUT${i + 1}`;
        if (b.wired(p, pin) !== null) b.add({ id: `${p.id}:${pin}`, kind: "V", a: b.named(p, pin), b: gnd, volts, rSeriesOhms: QTR_OUT_OHMS });
      });
    },
  },
  "soil-moisture": {
    models: [MODEL.source],
    // the probe's peak detector behind its output resistance; AOUT falls as the soil gets wetter
    build: (b, p) => b.add({ id: p.id, kind: "V", a: b.named(p, "AOUT"), b: b.named(p, "GND"), volts: soilVolts(num(p, "moisture", 40)), rSeriesOhms: SOIL_OUT_OHMS }),
  },
  "dc-motor": motor("dc-motor"),
  "tt-motor": motor("tt-motor"),
  fan: motor("fan"),
  "tt-motor-encoder": {
    models: [MODEL.motor, MODEL.source],
    build: (b, p) => {
      motor("tt-motor").build!(b, p);
      const gnd = b.named(p, "GND");
      const a = `${p.id}:A`;
      const c = `${p.id}:B`;
      b.add({ id: a, kind: "V", a: b.named(p, "A"), b: gnd, volts: 0, rSeriesOhms: ENCODER_OUT_OHMS });
      b.add({ id: c, kind: "V", a: b.named(p, "B"), b: gnd, volts: 0, rSeriesOhms: ENCODER_OUT_OHMS });
      b.controls.push(encoderControl({ motor: p.id, vcc: b.named(p, "VCC"), gnd, a, b: c, pulsesPerRev: ENCODER_PULSES_PER_REV }));
    },
  },
  "l298n-module": {
    models: [MODEL.source],
    build: (b, p) => {
      const gnd = b.named(p, "GND");
      const vs = b.named(p, "VS");
      const p5v = b.named(p, "P5V");
      const channel = (en: string, in1: string, in2: string, out1: string, out2: string): BridgeChannel => ({
        enable: b.wired(p, en),
        in1: b.wired(p, in1),
        in2: b.wired(p, in2),
        out1: b.output(`${p.id}:${out1}`, gnd, b.named(p, out1), L298N.ronOhms),
        out2: b.output(`${p.id}:${out2}`, gnd, b.named(p, out2), L298N.ronOhms),
      });
      const channels = [channel("ENA", "IN1", "IN2", "OUT1", "OUT2"), channel("ENB", "IN3", "IN4", "OUT3", "OUT4")];
      const regulator = b.output(`${p.id}:P5V`, gnd, p5v, REGULATOR_OHMS);
      b.resistor(`${p.id}:VS`, vs, gnd, 1e9);
      b.controls.push(l298nControl({ vs, gnd, p5v, regin: b.wired(p, "REGIN"), regulator, load: `${p.id}:VS`, channels }, { closed: JOIN_OHMS, open: OPEN_OHMS }));
    },
  },
  "pca9685-module": {
    models: [MODEL.resistor],
    build: (b, p) => {
      // the servo headers share the V+ and ground rails with the terminal block; the outputs are set by the chip over I2C
      const vplus = b.named(p, "VPLUS");
      const gnd = b.named(p, "GND");
      const join = (pin: string, rail: number) => {
        if (b.wired(p, pin) !== null) b.resistor(`${p.id}:${pin}`, b.named(p, pin), rail, JOIN_OHMS);
      };
      join("VIN", vplus);
      join("TGND", gnd);
      for (let n = 0; n < 16; n++) {
        join(`SV${n}`, vplus);
        join(`SG${n}`, gnd);
      }
      b.resistor(`${p.id}:VCC`, b.named(p, "VCC"), gnd, PCA9685_VCC_OHMS);
    },
  },
  "tb6612fng-module": {
    models: [MODEL.source],
    build: (b, p) => {
      const gnd = b.named(p, "GND");
      const vm = b.named(p, "VM");
      const channel = (pwm: string, in1: string, in2: string, out1: string, out2: string): BridgeChannel => ({
        enable: b.wired(p, pwm),
        in1: b.wired(p, in1),
        in2: b.wired(p, in2),
        out1: b.output(`${p.id}:${out1}`, gnd, b.named(p, out1), TB6612.ronOhms),
        out2: b.output(`${p.id}:${out2}`, gnd, b.named(p, out2), TB6612.ronOhms),
      });
      const channels = [channel("PWMA", "AIN1", "AIN2", "A01", "A02"), channel("PWMB", "BIN1", "BIN2", "B01", "B02")];
      // the three ground pins are one copper pour
      for (const other of ["GND2", "GND3"]) if (b.wired(p, other) !== null) b.resistor(`${p.id}:${other}`, b.named(p, other), gnd, JOIN_OHMS);
      b.resistor(`${p.id}:VM`, vm, gnd, 1e9);
      b.controls.push(tb6612Control({ vm, vcc: b.named(p, "VCC"), gnd, stby: b.wired(p, "STBY"), load: `${p.id}:VM`, channels }, { closed: JOIN_OHMS, open: OPEN_OHMS }));
    },
  },
  nema17: {
    models: [MODEL.motor],
    build: (b, p) => {
      const ohms = num(p, "ohms", 1.65);
      b.add({ id: `${p.id}:A`, kind: "M", a: b.leg(p, 0), b: b.leg(p, 1), ohms });
      b.add({ id: `${p.id}:B`, kind: "M", a: b.leg(p, 2), b: b.leg(p, 3), ohms });
    },
  },
  "servo-sg90": {
    models: [MODEL.servo],
    build: (b, p) => b.add({ id: p.id, kind: "SV", gnd: b.leg(p, 0), vplus: b.leg(p, 1), sig: b.leg(p, 2) }),
  },
  "stepper-28byj48": {
    models: [MODEL.coil],
    build: (b, p) => {
      const common = b.leg(p, 4);
      const ohms = num(p, "ohms", 50);
      for (const [i, coil] of ["B", "P", "Y", "O"].entries()) b.resistor(`${p.id}:${coil}`, common, b.leg(p, i), ohms);
    },
  },
  uln2003: {
    models: [MODEL.npn],
    build: (b, p) => {
      const ground = b.named(p, "GND");
      const vcc = b.named(p, "VCC");
      // the motor socket's red pin is the board's VCC
      if (b.wired(p, "MOTOR_V") !== null) b.resistor(`${p.id}:MOTOR_V`, b.named(p, "MOTOR_V"), vcc, JOIN_OHMS);
      for (const n of [1, 2, 3, 4]) {
        const base = b.nodes++;
        const out = b.named(p, `OUT${n}`);
        b.resistor(`${p.id}:R${n}`, b.named(p, `IN${n}`), base, 2700);
        b.npn(`${p.id}:Q${n}`, out, base, ground, 1000, 1.4, 1, { icmaxAmps: 0.5, thetaCPerW: 70, tjmaxC: 150 });
        b.add({ id: `${p.id}:D${n}`, kind: "D", a: out, b: vcc, modelId: MODEL.diode, vf: 0.7, rdOhms: 0.2, maxAmps: 0.5 });
      }
    },
  },
  "piezo-buzzer": {
    models: [MODEL.buzzer],
    build: (b, p) =>
      b.add({ id: p.id, kind: "BZ", a: b.leg(p, 0), b: b.leg(p, 1), active: text(p, "kind", "passive") === "active", vf: 0.05, rdOhms: 3 / 0.03 }),
  },
  tmp36: {
    models: [MODEL.tmp36],
    // VS and tempC are the names the part had before its descriptor
    build: (b, p) =>
      b.add({ id: p.id, kind: "TS", supplyPos: b.named(p, "VS" in p.pins ? "VS" : "PLUS_VS"), out: b.named(p, "VOUT"), supplyNeg: b.named(p, "GND"), outVolts: tmp36Volts(num(p, "temp_c", num(p, "tempC", 22))), rating: { vabsVolts: 7 } }),
  },
  // the stepper reads STEP and DIR from the pins; the chopper's coil current is not solved
  "a4988-module": noElement,
  "hc-sr04": noElement,
  mpu6050: noElement,
  // I2C parts answer on the bus in the interpreter; their supply current is not solved
  "bme280-module": noElement,
  ssd1306: noElement,
  "chassis-2wd": noElement,
  "wheel-65": noElement,
  "caster-ball": noElement,
  multimeter: { models: [MODEL.resistor], build: (b, p) => b.resistor(p.id, b.named(p, "V"), b.named(p, "COM"), METER_INPUT_OHMS) },
};

/** Descriptors converted to B2 carry their own name; the catalogue file they replaced is the key of `SPECS`. */
const CATALOGUE_NAME: Record<string, string> = {
  "led-5mm": "led",
  "potentiometer-10k": "potentiometer",
  "push-button-6mm": "push-button",
  "buzzer-piezo": "piezo-buzzer",
  "uln2003-module": "uln2003",
  "gy521-mpu6050": "mpu6050",
  "breadboard-half": "breadboard",
};

export function catalogueName(descriptorId: string): string {
  const name = descriptorId.replace(/^(part:|core\.)/, "").replace(/@.*$/, "");
  return CATALOGUE_NAME[name] ?? name;
}

/** Descriptor (catalogue file name) to registry model ids. */
export const MODEL_TABLE: Readonly<Record<string, readonly string[]>> = Object.fromEntries(Object.entries(SPECS).map(([name, spec]) => [name, spec.models]));

export function modelIdsOf(descriptorId: string): readonly string[] {
  return MODEL_TABLE[catalogueName(descriptorId)] ?? [];
}

export function pinElementId(boardPartId: string, pinName: string): ElementId {
  return `pin:${boardPartId}:${pinName}`;
}

export function logicElementId(partId: string, pinName: string): ElementId {
  return `logic:${partId}:${pinName}`;
}

export interface BoardInput {
  net: NetId;
  vilVolts: number;
  vihVolts: number;
}

export interface BuiltElements {
  elements: Element[];
  nodeOf: ReadonlyMap<NetId, number>;
  nodes: number;
  unmodelled: LoadReport["unmodelled"];
  modelIds: string[];
  /** Every PIN element, by id. */
  boardPins: ReadonlyMap<ElementId, BoardInput>;
  controls: readonly Control[];
}

export function buildElements(net: SimNetlist, pins: PinDirectory, layers: ReadonlyMap<PartId, PartLayers> = new Map()): BuiltElements {
  const b = new Builder(net);
  const unmodelled: LoadReport["unmodelled"] = [];
  const modelIds = new Set<string>();
  const boardPins = new Map<ElementId, BoardInput>();

  for (const part of net.parts) {
    const board = pins(part);
    if (board) {
      modelIds.add(MODEL.source);
      for (const [pin, netId] of Object.entries(part.pins)) {
        const node = netId == null ? undefined : b.nodeOf.get(netId);
        if (netId == null || node === undefined || node === GROUND) continue;
        const rail = RAIL_VOLTS.find(([pattern]) => pattern.test(pin));
        if (rail) {
          b.add({
            id: `rail:${part.id}:${pin}`,
            kind: "V",
            a: node,
            b: GROUND,
            volts: rail[1],
            rSeriesOhms: PWL_COMPAT.railOhms,
            ...(rail[2] ? { limit: rail[2] } : {}),
          });
        } else if (!NOT_SIGNAL.test(pin)) {
          const id = pinElementId(part.id, pin);
          b.add({ id, kind: "PIN", a: node, level: "Z", vHighVolts: board.logicVolts, rOutOhms: board.rOutOhms, maxAmps: board.maxAmps });
          boardPins.set(id, { net: netId, vilVolts: board.vilFrac * board.logicVolts, vihVolts: board.vihFrac * board.logicVolts });
        }
      }
      continue;
    }
    // a part with no pin wired is not in the circuit yet; solving it alone would only float
    if (Object.values(part.pins).every((netId) => netId == null)) continue;
    const spec = SPECS[catalogueName(part.descriptor)];
    const resolved = layers.get(part.id);
    if (!spec && !resolved) {
      unmodelled.push({ part: part.id, reason: `no analog model for ${part.descriptor}` });
      continue;
    }
    const before = b.elements.length;
    const controlsBefore = b.controls.length;
    const added = new Set<string>(spec?.models);
    const why = spec ? spec.build?.(b, part) : buildLayers(b, part, resolved!, added);
    if (why) {
      b.elements.length = before;
      b.controls.length = controlsBefore;
      unmodelled.push({ part: part.id, reason: why });
    } else {
      for (const id of added) modelIds.add(id);
    }
  }
  return { elements: b.elements, nodeOf: b.nodeOf, nodes: b.nodes, unmodelled, modelIds: [...modelIds].sort(), boardPins, controls: b.controls };
}

/** Each part's pin names by the net they sit on, in pin order. */
function pinsByNet(net: SimNetlist): Map<PartId, Map<NetId, string[]>> {
  const out = new Map<PartId, Map<NetId, string[]>>();
  for (const part of net.parts) {
    const byNet = new Map<NetId, string[]>();
    for (const [pin, netId] of Object.entries(part.pins)) if (netId !== null) byNet.set(netId, [...(byNet.get(netId) ?? []), pin]);
    out.set(part.id, byNet);
  }
  return out;
}

interface Component {
  /** Global node of each local node 1..n; local node 0 is ground. */
  nodes: number[];
  elements: Element[];
  /** Solved by the Newton solver: it holds a capacitor, a source with a waveform, an amplifier, a timer or a Zener. */
  newton: boolean;
  /** The time stepping of a Newton component in a transient run; made when the component is first solved. */
  run: TransientRun | null;
  /** The diagnostics the last solve raised, so a step that raises the same ones again says nothing. */
  said: string;
  dirty: boolean;
  ok: boolean;
  last: SolveResult | null;
}

interface RunData {
  seconds: number;
  backward: boolean;
  quiet?: number;
  memory: TransientMemory;
  result: NonNullable<ComponentData["last"]>;
}

interface ComponentData {
  elements: Element[];
  dirty: boolean;
  ok: boolean;
  last: (Omit<SolveResult, "v"> & { v: number[] }) | null;
  run: RunData | null;
  said: string;
}

const stateOf = (run: TransientRun): RunData => {
  const { seconds, backward, quiet, memory, result } = run.state();
  return { seconds, backward, quiet, memory: Object.fromEntries(Object.entries(memory).map(([id, kept]) => [id, { ...kept }])), result: freeze(result)! };
};

const freeze = ({ v, ...rest }: SolveResult): ComponentData["last"] => ({ ...rest, v: Array.from(v) });
const thaw = ({ v, ...rest }: NonNullable<ComponentData["last"]>): SolveResult => ({ ...rest, v: Float64Array.from(v) });

interface SnapshotData {
  at: SimTime;
  stepNs: number | null;
  components: ComponentData[];
  held: [NetId, 0 | 1][];
  tracker: unknown;
  damaged: [ElementId, Element][];
  floating: ElementId[];
  instruments: [string, InstrumentSource][];
}

interface BoardRail {
  part: PartId;
  net: NetId;
  power: BoardPower;
  detector: Brownout;
  state: RailState;
}

export interface LiveDeps {
  solve: typeof solve;
  pins: PinDirectory;
  registry: Registry;
  /** null: the part is not a board. */
  power: (part: SimPart) => BoardPower | null;
}

/** The element with its sources taken off: a supply or generator at zero volts and a pin released. */
function unpowered(el: Element): Element {
  if (el.kind === "PIN") return { ...el, level: "Z", pull: undefined };
  if (el.kind === "V") return { ...el, volts: 0 };
  if (el.kind === "VW") return { ...el, amplitudeV: 0, offsetV: 0 };
  return el;
}

/** What a latched part becomes in later solves; null when only the latch and the message apply. */
function openCircuit(el: Element): Element | null {
  if (el.kind === "D") return { id: el.id, kind: "R", a: el.a, b: el.b, ohms: OPEN_OHMS };
  if (el.kind === "Q") return { id: el.id, kind: "R", a: el.c, b: el.e, ohms: OPEN_OHMS };
  if (el.kind === "C" || el.kind === "L") return { id: el.id, kind: "R", a: el.a, b: el.b, ohms: OPEN_OHMS };
  if (el.kind === "OA") return { id: el.id, kind: "R", a: el.out, b: GROUND, ohms: OPEN_OHMS };
  if (el.kind === "TMR") return { id: el.id, kind: "R", a: el.out, b: el.gnd, ohms: OPEN_OHMS };
  return null;
}

class Live implements LiveAnalog {
  private o: SolveOptions | null = null;
  private nodeOf: ReadonlyMap<NetId, number> = new Map();
  private netOf = new Map<number, NetId>();
  private nodeCount = 1;
  private boardPins: ReadonlyMap<ElementId, BoardInput> = new Map();
  private components: Component[] = [];
  private home = new Map<number, { comp: Component; local: number }>();
  private where = new Map<ElementId, { comp: Component; index: number }>();
  private pinBase = new Map<ElementId, ElementPin>();
  /** The elements as `load` built them, in global nodes and without instruments; a restore partitions from them. */
  private loaded: Element[] = [];
  private instruments = new Map<string, InstrumentSource>();
  private limiting = new Set<ElementId>();
  private held = new Map<NetId, 0 | 1>();
  /** The grid of a transient run in nanoseconds, or null when the circuit is solved only when something changes. */
  private stepNs: number | null = null;
  /** The project asked for a transient run, or the circuit has a part that needs one. A waveform source needs one too, whenever it is put in. */
  private timed = false;
  /** The step the project names, or null to size it from the circuit. */
  private namedStepNs: number | null = null;
  private stepChanged = false;
  /** Changes a transient run holds until the circuit has been stepped to the instant they were made at. */
  private deferred: Change[] = [];
  /** What the reactive parts held when the circuit was last partitioned again, for the runs that start from it in the same advance. */
  private carried: TransientMemory = {};
  private pending: SimDiagnostic[] = [];
  private queued: HonestState[] = [];
  private at: SimTime = 0;
  /** The time the motors' shafts were last turned to. */
  private motorAt: SimTime = 0;
  private controls: readonly Control[] = [];
  /** The time the controls last stepped to. */
  private controlAt: SimTime = 0;
  private tracker: StateTracker;
  private rails: BoardRail[] = [];
  private damaged = new Map<ElementId, Element>();
  private floating = new Set<ElementId>();
  private partNets = new Map<PartId, Map<NetId, string[]>>();

  private readonly d: LiveDeps;

  constructor(d: LiveDeps) {
    this.d = d;
    this.tracker = createStateTracker(d.registry);
  }

  load(net: SimNetlist, o: SolveOptions, layers?: ReadonlyMap<PartId, PartLayers>): LoadReport {
    const built = buildElements(net, this.d.pins, layers);
    this.o = o;
    this.controls = built.controls;
    this.controlAt = 0;
    this.timed = net.settings.analog.mode === "transient";
    this.namedStepNs = net.settings.analog.stepNs ?? null;
    this.stepChanged = false;
    this.stepNs = this.gridFor(built.elements, built.controls);
    this.deferred = [];
    this.nodeOf = built.nodeOf;
    this.netOf = new Map([...built.nodeOf].map(([id, node]) => [node, id]));
    this.nodeCount = built.nodes;
    this.boardPins = built.boardPins;
    this.held = new Map();
    this.pending = [];
    this.at = 0;
    this.motorAt = 0;
    this.tracker = createStateTracker(this.d.registry);
    this.damaged = new Map();
    this.floating = new Set();
    this.partNets = pinsByNet(net);
    this.loaded = built.elements;
    this.instruments = new Map();
    this.limiting = new Set();
    this.partition(built.elements);
    this.queued = built.unmodelled.map((u) => notModelledState(u.part, u.reason, 0));
    this.rails = this.railsOf(net);

    const diagnostics = built.unmodelled.map((u) => simDiag("not-modelled-yet", "warning", { part: u.part }, { reason: u.reason }));
    return {
      ok: !diagnostics.some((x) => x.severity === "error"),
      stepNs: this.stepNs,
      components: this.components.length,
      nodes: net.nets.length,
      elements: built.elements.length,
      unmodelled: built.unmodelled,
      diagnostics,
      modelIds: built.modelIds,
    };
  }

  /** The step a circuit is run at: none when nothing in it needs a time base. */
  private gridFor(elements: readonly Element[], controls: readonly Control[] = this.controls): number | null {
    const turns = elements.some((el) => el.kind === "M" && el.model);
    const waves = elements.some((el) => el.kind === "VW");
    const controlNs = Math.min(...controls.map((c) => c.maxStepNs ?? Infinity));
    if (!this.timed && !turns && !waves && controlNs === Infinity) return null;
    const grid = this.timed || waves ? (this.namedStepNs === null ? autoStepNs(elements) : Math.min(this.namedStepNs, clockStepNs(elements) ?? Infinity)) : Infinity;
    return Math.min(grid, turns ? MOTOR_STEP_NS : Infinity, controlNs);
  }

  apply(changes: Change[]): void {
    if (this.stepNs !== null) this.deferred.push(...changes);
    else for (const change of changes) this.applyOne(change);
  }

  advanceTo(t: SimTime): AnalogStepResult {
    const o = this.o;
    if (!o) throw new Error("LiveAnalog.advanceTo before load");
    const diagnostics = this.pending;
    this.pending = [];
    const states = this.queued;
    this.queued = [];
    let solves = 0;
    let worstKclAmps = 0;
    const record = (comp: Component, result: SolveResult) => {
      if (!result.converged && comp.ok) states.push(noConvergenceState(this.d.registry, result, this.localNet(comp, result.residual.worstNode), t));
      comp.ok = result.converged;
      if (result.converged) {
        comp.last = result;
        if (comp.newton) this.markLimits(comp, result);
      }
      solves++;
      worstKclAmps = Math.max(worstKclAmps, result.residual.maxKclAmps || 0);
      const said = result.diagnostics.map((x) => `${x.id}:${JSON.stringify(x.ref)}`).join("|");
      if (comp.newton && said === comp.said) return;
      comp.said = said;
      diagnostics.push(...result.diagnostics.map((x) => this.globalDiag(x, comp)));
    };
    if (this.stepNs !== null) {
      for (const comp of this.components) {
        if (!comp.run || comp.dirty) continue;
        const before = comp.run.state().seconds;
        if (before * 1e9 + 0.5 < t) record(comp, comp.run.advanceTo(t * 1e-9));
      }
      const changes = this.deferred;
      this.deferred = [];
      for (const change of changes) this.applyOne(change);
    }
    this.turnMotors(t);
    const controlDtS = Math.max(0, t - this.controlAt) * 1e-9;
    this.controlAt = t;
    for (let pass = 0; pass <= CONTROL_PASSES; pass++) {
      for (const comp of this.components) {
        if (!comp.dirty) continue;
        record(comp, this.solveComponent(comp, o, t));
        comp.dirty = false;
      }
      if (pass === CONTROL_PASSES || !this.stepControls(pass === 0 ? controlDtS : 0)) break;
    }
    this.carried = {};
    this.at = t;
    const events = this.crossings(t);
    const settled: Solved[] = this.components.flatMap((c) => (c.ok && c.last ? [{ result: c.last, elements: c.elements }] : []));
    states.push(...this.tracker.step(settled, t), ...this.floatingInputs(t));
    this.openBurnt(states);
    for (const rail of this.rails) this.stepRail(rail, t, states, events);
    for (const state of states) events.push({ at: t, phase: 3, rank: RANK.analog, seq: 0, src: ENGINE_ID, kind: "honest-state", payload: state });
    const stepped = this.stepChanged ? { stepNs: this.stepNs } : {};
    this.stepChanged = false;
    return {
      at: t,
      converged: this.components.every((c) => c.ok),
      solves,
      skippedClean: this.components.length - solves,
      events,
      diagnostics,
      worstKclAmps,
      ...stepped,
    };
  }

  /** Lets every control set its elements from the last solve; true when one changed something worth solving for. */
  private stepControls(dtS: number): boolean {
    if (this.controls.length === 0) return false;
    let changed = false;
    const io: ControlIO = {
      volts: (node) => {
        if (node === GROUND) return 0;
        const at = this.home.get(node);
        return at?.comp.ok && at.comp.last ? at.comp.last.v[at.local] : null;
      },
      pwm: (node) => {
        const at = this.home.get(node);
        const pwm = at?.comp.elements.find((el): el is ElementPwm => el.kind === "PWM" && el.mode === "averaged" && el.a === at.local);
        return pwm ? { duty: pwm.duty, vHighVolts: pwm.vHighVolts } : null;
      },
      amps: (id) => {
        const at = this.where.get(id);
        return (at?.comp.ok ? at.comp.last?.branch[id]?.amps : undefined) ?? null;
      },
      sourceVolts: (id) => {
        const at = this.where.get(id);
        const el = at?.comp.elements[at.index];
        return el?.kind === "V" ? el.volts : null;
      },
      rpm: (id) => {
        const el = this.where.get(id);
        const m = el?.comp.elements[el.index];
        return m?.kind === "M" ? (m.rpm ?? 0) : null;
      },
      set: (id, fields) => {
        const at = this.where.get(id);
        if (!at) return;
        const el = at.comp.elements[at.index] as unknown as Record<string, unknown>;
        const moved = Object.entries(fields).some(([key, value]) => {
          const was = el[key];
          return typeof was !== "number" || Math.abs(value - was) > CONTROL_EPS * Math.max(1, Math.abs(was));
        });
        if (!moved) return;
        at.comp.elements[at.index] = { ...el, ...fields } as unknown as Element;
        this.touch(at.comp);
        changed = true;
      },
    };
    for (const control of this.controls) control.step(io, dtS);
    return changed;
  }

  /** Turns every motor's shaft on from the last solve to `t`; a motor whose back-EMF moved has its circuit solved again. */
  private turnMotors(t: SimTime): void {
    const dtS = Math.max(0, t - this.motorAt) * 1e-9;
    this.motorAt = t;
    if (dtS === 0) return;
    for (const comp of this.components) {
      const result = comp.ok ? comp.last : null;
      if (!result) continue;
      comp.elements.forEach((el, i) => {
        if (el.kind !== "M" || !el.model) return;
        const m = result.branch[el.id];
        if (!m) return;
        const rpm = stepRpm(el, m.volts, m.amps, dtS);
        const emfV = rpm * el.model.keVPerRpm;
        const moved = Math.abs(emfV - (el.emfV ?? 0)) >= MOTOR_EMF_EPS_VOLTS;
        comp.elements[i] = { ...el, rpm, ...(moved ? { emfV } : {}) };
        if (moved) this.touch(comp);
      });
    }
  }

  repair(partId: PartId): void {
    this.tracker.repair(partId);
    for (const [id, original] of [...this.damaged]) {
      if (partOf(id) !== partId) continue;
      const at = this.where.get(id);
      if (at) {
        at.comp.elements[at.index] = original;
        this.touch(at.comp);
      }
      this.damaged.delete(id);
    }
  }

  readout(): Readout {
    return readoutOf({ components: this.components, netOf: this.netOf, partNets: this.partNets, burnt: this.tracker.reasons() });
  }

  snapshot(): EngineSnapshot {
    const data: SnapshotData = {
      at: this.at,
      stepNs: this.stepNs,
      components: this.components.map((c) => ({
        elements: c.elements.map((el) => ({ ...el })),
        dirty: c.dirty,
        ok: c.ok,
        last: c.last && freeze(c.last),
        said: c.said,
        run: c.run && { ...stateOf(c.run) },
      })),
      held: [...this.held],
      tracker: this.tracker.snapshot(),
      damaged: [...this.damaged].map(([id, el]) => [id, { ...el }]),
      floating: [...this.floating],
      instruments: [...this.instruments],
    };
    return { engine: ENGINE_ID, engineVersion: "1", schema: 1, data };
  }

  restore(s: EngineSnapshot): void {
    if (s.engine !== ENGINE_ID || s.schema !== 1) throw new RangeError(`not a ${ENGINE_ID} snapshot: ${s.engine} schema ${s.schema}`);
    const data = s.data as SnapshotData;
    this.instruments = new Map(data.instruments);
    this.stepNs = data.stepNs;
    this.stepChanged = false;
    this.limiting = new Set();
    this.partition([...this.loaded, ...[...this.instruments].map(([key, src]) => this.instrumentElement(key, src))]);
    if (data.components.length !== this.components.length) throw new RangeError("the snapshot is of a different circuit");
    this.at = data.at;
    this.motorAt = data.at;
    this.controlAt = data.at;
    this.held = new Map(data.held);
    this.pending = [];
    this.queued = [];
    this.tracker.restore(data.tracker);
    this.damaged = new Map(data.damaged.map(([id, el]) => [id, { ...el }]));
    this.floating = new Set(data.floating);
    this.rails = this.rails.map((r) => ({ ...r, detector: this.detectorOf(r.power), state: "ok" }));
    data.components.forEach((saved, i) => {
      const comp = this.components[i];
      comp.elements = saved.elements.map((el) => ({ ...el }));
      comp.dirty = saved.dirty;
      comp.ok = saved.ok;
      comp.last = saved.last && thaw(saved.last);
      if (comp.newton && comp.last) this.markLimits(comp, comp.last);
      comp.said = saved.said;
      comp.run = saved.run && this.stepNs !== null ? new TransientRun({ nodes: comp.nodes.length + 1, ground: GROUND, elements: comp.elements }, NEWTON_OPTIONS, this.stepNs * 1e-9, { seconds: saved.run.seconds, backward: saved.run.backward, quiet: saved.run.quiet, memory: saved.run.memory, result: thaw(saved.run.result) }) : null;
    });
    this.index();
  }

  netVolts(net: NetId): number | null {
    const node = this.nodeOf.get(net);
    if (node === undefined) return null;
    if (node === GROUND) return 0;
    const at = this.home.get(node);
    return at?.comp.ok && at.comp.last ? at.comp.last.v[at.local] : null;
  }

  /** Null for a pin that nothing else touches: it reads noise, not the 0 V the matrix settles on. */
  pinVolts(element: ElementId): number | null {
    const input = this.boardPins.get(element);
    return input && !this.isFloating(element) ? this.netVolts(input.net) : null;
  }

  nodeIndex(net: NetId): number | null {
    return this.nodeOf.get(net) ?? null;
  }

  componentResult(net: NetId): SolveResult | null {
    const node = this.nodeOf.get(net);
    return (node === undefined ? undefined : this.home.get(node)?.comp.last) ?? null;
  }

  whatIf(o: WhatIf): SolveResult {
    if (!this.o) throw new Error("LiveAnalog.whatIf before load");
    const off = o.sources === "off";
    const elements: Element[] = [];
    for (const comp of this.components) {
      for (const el of comp.elements) {
        const global = mapNodes(el, (n) => (n === GROUND ? GROUND : comp.nodes[n - 1]));
        if (off && global.kind === "PWM") continue;
        elements.push(off ? unpowered(global) : global);
      }
    }
    const merged = [...elements, ...(o.extra ?? [])].map((el) => (o.params?.[el.id] ? ({ ...el, ...o.params[el.id] } as Element) : el));
    const nodes = this.nodeCount;
    if (!this.components.some((c) => c.newton)) return this.solveDrooping(nodes, merged, this.o, null);
    // A reading of the live circuit holds the charge and flux the run has built up, with no time passing; with the sources off
    // it is a direct current reading: capacitors open, inductors shorted. A PWM pin reads as its average, as it does on a meter.
    const circuit = { nodes, ground: GROUND, elements: merged.map((el) => forNewton(el, false)) };
    return this.d.solve(!off && this.stepNs !== null ? { ...circuit, transient: this.heldStep() } : circuit, NEWTON_OPTIONS);
  }

  /** The state every reactive part of the run is in now, as a step of no length that starts from it. */
  private heldStep(): TransientStep {
    const prev: TransientMemory = { ...this.carried };
    for (const comp of this.components) if (comp.run) Object.assign(prev, comp.run.state().memory);
    return { tSeconds: this.at * 1e-9, hSeconds: SETTLE_SECONDS, method: "backward-euler", prev };
  }

  private detectorOf(power: BoardPower): Brownout {
    return createBrownout({
      thresholdVolts: power.vccMinVolts ?? 0,
      hysteresisVolts: power.hysteresisVolts,
      minDwellNs: power.minDwellNs,
      resetNs: power.resetNs,
    });
  }

  /** One detector per board that states a minimum; a board that does not is said so once. */
  private railsOf(net: SimNetlist): BoardRail[] {
    const rails: BoardRail[] = [];
    for (const part of net.parts) {
      const power = this.d.power(part);
      if (!power) continue;
      const railNet = power.vccMinVolts === null ? null : part.pins[power.mcuRail];
      if (power.vccMinVolts === null) this.queued.push(brownOutUnknownState(part.id, 0));
      else if (railNet) rails.push({ part: part.id, net: railNet, power, detector: this.detectorOf(power), state: "ok" });
    }
    return rails;
  }

  private stepRail(rail: BoardRail, t: SimTime, states: HonestState[], events: SimEvent[]): void {
    const volts = this.netVolts(rail.net);
    if (volts === null) return;
    const next = rail.detector.step(volts, t);
    const entered = next === "reset" && rail.state !== "reset";
    rail.state = next;
    if (!entered) return;
    states.push(brownOutState(this.d.registry, rail.power, { net: rail.net, volts }, t));
    const payload = { part: rail.part, net: rail.net, volts };
    events.push({ at: t, phase: 4, rank: RANK.analog, seq: 0, src: ENGINE_ID, kind: "brownout", payload });
    events.push({ at: t, phase: 4, rank: RANK.analog, seq: 0, src: ENGINE_ID, kind: "reset", payload: { ...payload, reason: "brownout" } });
  }

  /** Solves one component. A source past its current limit sags until it carries exactly the limit. */
  private solveComponent(comp: Component, o: SolveOptions, t: SimTime): SolveResult {
    if (comp.newton) return this.solveNewton(comp, t);
    return this.solveDrooping(comp.nodes.length + 1, comp.elements, o, this.limiting);
  }

  /** The piecewise linear solve of a circuit in which a source past its limit sags until it carries exactly the limit; `limiting` is told which ones do. */
  private solveDrooping(nodes: number, circuit: Element[], o: SolveOptions, limiting: Set<ElementId> | null): SolveResult {
    const run = (elements: Element[]) => this.d.solve({ nodes, ground: GROUND, elements, pwmSlices: pwmSlices(elements) }, o);
    let elements = circuit;
    let result = run(elements);
    for (const el of circuit) {
      if (el.kind !== "V" || !isLimited(el)) continue;
      limiting?.delete(el.id);
      if (!result.converged || (result.branch[el.id]?.amps ?? 0) <= el.limit.amps) continue;
      limiting?.add(el.id);
      const withSeries = (ohms: number) => elements.map((x) => (x.id === el.id ? { ...el, rSeriesOhms: ohms } : x));
      const ohms = droopSource(el, (r) => run(withSeries(r)).branch[el.id]?.amps ?? 0);
      elements = withSeries(ohms);
      result = run(elements);
    }
    return result;
  }

  /** A Newton component's source that carries exactly its limit is holding it: the solver clamped its current. */
  private markLimits(comp: Component, result: SolveResult): void {
    for (const el of comp.elements) {
      if ((el.kind !== "V" && el.kind !== "VW") || !el.limit) continue;
      if ((result.branch[el.id]?.amps ?? 0) >= el.limit.amps * LIMIT_REACHED) this.limiting.add(el.id);
      else this.limiting.delete(el.id);
    }
  }

  /** A Newton component is solved from its operating point, and in a transient run it is then stepped; a change at the same instant keeps what its capacitors hold. */
  private solveNewton(comp: Component, t: SimTime): SolveResult {
    const circuit = { nodes: comp.nodes.length + 1, ground: GROUND, elements: comp.elements };
    if (this.stepNs === null) return this.d.solve(circuit, NEWTON_OPTIONS);
    if (comp.run) return comp.run.settle();
    comp.run = new TransientRun(circuit, NEWTON_OPTIONS, this.stepNs * 1e-9, undefined, t * 1e-9, this.carried);
    return comp.run.settle();
  }

  private localNet(comp: Component, node: number): NetId | undefined {
    const global = comp.nodes[node - 1];
    return global === undefined ? undefined : this.netOf.get(global);
  }

  /** The element of a burn-out record is the one its evidence points at; it stays open in later solves. */
  private openBurnt(states: HonestState[]): void {
    for (const state of states) {
      const id = state.kind === "burn-out" ? state.evidence[0]?.ref : undefined;
      const at = id === undefined ? undefined : this.where.get(id);
      const open = at && openCircuit(at.comp.elements[at.index]);
      if (!at || !open) continue;
      this.damaged.set(at.comp.elements[at.index].id, at.comp.elements[at.index]);
      at.comp.elements[at.index] = open;
      this.touch(at.comp);
    }
  }

  /** A board pin that is not driven and shares its node with no other element. */
  private isFloating(id: ElementId): boolean {
    const at = this.where.get(id);
    const pin = at?.comp.elements[at.index];
    return pin?.kind === "PIN" && pin.level === "Z" && !at!.comp.elements.some((el) => el.id !== id && nodesOf(el).includes(pin.a));
  }

  /** A board input on a net that nothing else touches reads noise. Said once per pin. */
  private floatingInputs(t: SimTime): HonestState[] {
    const out: HonestState[] = [];
    for (const [id, input] of this.boardPins) {
      if (this.floating.has(id) || !this.isFloating(id)) continue;
      this.floating.add(id);
      const [, board, name] = id.split(":");
      out.push(floatingInputState(this.d.registry, board, name, input.net, t));
    }
    return out;
  }

  /** Splits the circuit into parts that share no node but ground; each is solved on its own. */
  private partition(elements: Element[]): void {
    const groups = new UnionFind();
    const used = elements.map((el) => nodesOf(el).filter((n) => n !== GROUND));
    for (const nodes of used) for (const n of nodes) groups.union(String(nodes[0]), String(n));
    const byRoot = new Map<string, Component>();
    this.components = [];
    elements.forEach((el, i) => {
      if (used[i].length === 0) return;
      const root = groups.find(String(used[i][0]));
      let comp = byRoot.get(root);
      if (!comp) {
        comp = { nodes: [], elements: [], newton: false, run: null, said: "", dirty: true, ok: true, last: null };
        byRoot.set(root, comp);
        this.components.push(comp);
      }
      for (const n of used[i]) if (!comp.nodes.includes(n)) comp.nodes.push(n);
    });
    elements.forEach((el, i) => {
      if (used[i].length === 0) return;
      const comp = byRoot.get(groups.find(String(used[i][0])))!;
      const local = mapNodes(el, (n) => (n === GROUND ? GROUND : comp.nodes.indexOf(n) + 1));
      comp.elements.push(local);
    });
    for (const comp of this.components) {
      comp.newton = needsNewton(comp.elements);
      if (comp.newton) comp.elements = comp.elements.map((el) => forNewton(el, this.stepNs !== null));
    }
    this.index();
    this.pinBase = new Map();
    for (const el of this.loaded) {
      const at = el.kind === "PIN" ? this.where.get(el.id) : undefined;
      if (at) this.pinBase.set(el.id, mapNodes(el, (n) => (n === GROUND ? GROUND : at.comp.nodes.indexOf(n) + 1)) as ElementPin);
    }
  }

  private instrumentElement(id: string, source: InstrumentSource): Element {
    const a = this.nodeOf.get(source.pos)!;
    const b = this.nodeOf.get(source.neg)!;
    const elementId = instrumentElementId(id);
    if (source.kind === "psu") return { id: elementId, kind: "V", a, b, volts: source.volts, rSeriesOhms: PSU_SERIES_OHMS, limit: { amps: source.limitAmps, mode: "droop" } };
    const { wave } = source;
    return {
      id: elementId, kind: "VW", a, b, ...wave,
      rSeriesOhms: source.rSeriesOhms,
      ...(source.limitAmps !== undefined ? { limit: { amps: source.limitAmps, mode: "droop" as const } } : {}),
    };
  }

  /** The circuit as it is now in global nodes, which is what a new partition starts from. */
  private currentElements(): Element[] {
    return this.components.flatMap((comp) => comp.elements.map((el) => mapNodes(el, (n) => (n === GROUND ? GROUND : comp.nodes[n - 1]))));
  }

  /** A source between two nets can join circuits that were solved apart, so the circuit is partitioned again; every part is solved afresh. */
  private setInstrument(id: string, source: InstrumentSource | null): void {
    if (source === null) {
      if (!this.instruments.delete(id)) return;
    } else {
      if (!this.nodeOf.has(source.pos) || !this.nodeOf.has(source.neg) || source.pos === source.neg) {
        this.pending.push(simDiag("unknown-pin", "warning", {}, { element: instrumentElementId(id) }));
        return;
      }
      this.instruments.set(id, source);
    }
    for (const comp of this.components) if (comp.run) Object.assign(this.carried, comp.run.state().memory);
    const mine = new Set([...this.instruments.keys()].map(instrumentElementId));
    const wasMine = (el: Element) => el.id.startsWith(INSTRUMENT_PREFIX);
    const kept = this.currentElements().filter((el) => !wasMine(el));
    this.limiting = new Set([...this.limiting].filter((e) => mine.has(e)));
    const elements = [...kept, ...[...this.instruments].map(([key, src]) => this.instrumentElement(key, src))];
    const grid = this.gridFor(elements);
    this.stepChanged ||= grid !== this.stepNs;
    this.stepNs = grid;
    this.partition(elements);
  }

  instrumentReading(id: string): InstrumentReading | null {
    const source = this.instruments.get(id);
    const elementId = instrumentElementId(id);
    const measured = this.where.get(elementId)?.comp.last?.branch[elementId];
    const pos = source ? this.netVolts(source.pos) : null;
    const neg = source ? this.netVolts(source.neg) : null;
    if (!measured || pos === null || neg === null) return null;
    return { volts: pos - neg, amps: measured.amps, limiting: this.limiting.has(elementId) };
  }

  private index(): void {
    this.home = new Map();
    this.where = new Map();
    for (const comp of this.components) {
      comp.nodes.forEach((node, i) => this.home.set(node, { comp, local: i + 1 }));
      comp.elements.forEach((el, index) => this.where.set(el.id, { comp, index }));
    }
  }

  private applyOne(change: Change): void {
    if (change.kind === "instrument") {
      this.setInstrument(change.element, change.source);
      return;
    }
    const at = this.where.get(change.element);
    if (!at) {
      this.pending.push(simDiag("unknown-pin", "warning", {}, { element: change.element }));
      return;
    }
    const { comp, index } = at;
    const el = comp.elements[index];
    switch (change.kind) {
      case "pin": {
        const base = this.pinBase.get(change.element);
        if (!base) break;
        comp.elements[index] =
          change.level === "Z" && change.pull
            ? { ...base, level: change.pull === "up" ? 1 : 0, rOutOhms: PULL_OHMS, pull: change.pull }
            : { ...base, level: change.level };
        break;
      }
      case "pwm": {
        const base = this.pinBase.get(change.element);
        if (!(change.duty >= 0 && change.duty <= 1) || !(change.hz > 0)) throw new RangeError(`pwm needs a duty in 0 to 1 and hz above 0, got ${change.duty} and ${change.hz}`);
        if (base) {
          const mode = comp.newton && this.stepNs !== null ? "edge" : "averaged";
          comp.elements[index] = { id: base.id, kind: "PWM", a: base.a, duty: change.duty, hz: change.hz, vHighVolts: base.vHighVolts, rOutOhms: base.rOutOhms, mode, maxAmps: base.maxAmps };
        }
        break;
      }
      case "source":
        if (el.kind === "V") comp.elements[index] = { ...el, volts: change.volts };
        break;
      case "switch":
        if (el.kind === "R") comp.elements[index] = { ...el, ohms: change.closed ? JOIN_OHMS : OPEN_OHMS };
        break;
      case "param": {
        const path = change.path === "pos" ? "position" : change.path;
        if (typeof (el as unknown as Record<string, unknown>)[path] === "number") comp.elements[index] = { ...el, [path]: change.value } as Element;
        break;
      }
      case "motor-speed":
        return;
    }
    this.touch(comp);
  }

  /** The component must be solved again, and a run of it steps on from the change with a short backward Euler step. */
  private touch(comp: Component): void {
    comp.dirty = true;
    comp.run?.disturb();
  }

  private globalDiag(x: SimDiagnostic, comp: Component): SimDiagnostic {
    if (x.ref.net === undefined) return x;
    const node = comp.nodes[Number(x.ref.net) - 1];
    const net = node === undefined ? undefined : this.netOf.get(node);
    const ref = { ...x.ref };
    if (net === undefined) delete ref.net;
    else ref.net = net;
    return { ...x, ref };
  }

  /** A digital input whose net moves past a threshold; between the two thresholds it keeps its level. */
  private crossings(time: SimTime): SimEvent[] {
    const events: SimEvent[] = [];
    const seen = new Set<NetId>();
    for (const [id, input] of this.boardPins) {
      const at = this.where.get(id);
      const pin = at?.comp.elements[at.index];
      if (seen.has(input.net) || pin?.kind !== "PIN" || !(pin.level === "Z" || pin.pull)) continue;
      const volts = this.netVolts(input.net);
      if (volts === null) continue;
      seen.add(input.net);
      const level = this.held.get(input.net) ?? 0;
      const next = level === 0 && volts >= input.vihVolts ? 1 : level === 1 && volts <= input.vilVolts ? 0 : level;
      if (next === level) continue;
      this.held.set(input.net, next);
      events.push({ at: time, phase: 3, rank: RANK.analog, seq: 0, src: ENGINE_ID, kind: "net-threshold", payload: { net: input.net, level: next, volts } });
    }
    return events;
  }
}

export function createLiveAnalog(d: LiveDeps): LiveAnalog {
  return new Live(d);
}
