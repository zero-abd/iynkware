// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { NetEdge } from "../engine.ts";
import { createDigitalNets } from "../digital/nets.ts";
import type { SimNetlist } from "../engine.ts";
import { createPartStates } from "./hub.ts";
import { nema17, stepper28byj48 } from "./stepper.ts";
import { ctxOf } from "./testing.ts";
import type { PartPeer } from "./types.ts";

/** Level changes on named pins from a list of states, one state a millisecond, numbered across all pins. */
function edgesOf(pins: string[], states: number[][], seq = { n: 0 }, start = 0): Record<string, NetEdge[]> {
  const out: Record<string, NetEdge[]> = Object.fromEntries(pins.map((p) => [p, []]));
  const now = pins.map(() => 0);
  states.forEach((state, t) => {
    pins.forEach((pin, i) => {
      if (state[i] === now[i]) return;
      now[i] = state[i];
      out[pin].push({ seq: ++seq.n, at: (start + t) * 1e6, level: state[i] as 0 | 1 });
    });
  });
  return out;
}

/** `n` full steps of a four-phase wave, forward or back. */
const wave = (n: number, back = false): number[][] =>
  Array.from({ length: n }, (_, i) => {
    const k = (((back ? -i : i) % 4) + 4) % 4;
    return [0, 1, 2, 3].map((j) => (j === k ? 1 : 0));
  });

const peer = (name: string, pin: string, ctx: PartPeer["ctx"]): PartPeer => ({ name, pin, ctx });

function byjOnUln(states: number[][]) {
  const uln = ctxOf("core.uln2003-module@1.0.0", { edges: edgesOf(["IN1", "IN2", "IN3", "IN4"], states) });
  const peers = { B: [peer("uln2003", "OUT1", uln)], P: [peer("uln2003", "OUT2", uln)], Y: [peer("uln2003", "OUT3", uln)], O: [peer("uln2003", "OUT4", uln)] };
  return stepper28byj48(ctxOf("core.stepper-28byj48@1.0.0", { peers, volts: { R: 5 } }));
}

describe("28BYJ-48 on a ULN2003", () => {
  it("turns a quarter for 512 full steps and once round for 2048", () => {
    expect(byjOnUln(wave(513))).toMatchObject({ kind: "stepper", steps: 512, angle: 90, powered: true });
    expect(byjOnUln(wave(2049))).toMatchObject({ steps: 2048, angle: 0 });
  });

  it("counts half steps and turns back with the sequence reversed", () => {
    const half = Array.from({ length: 9 }, (_, i) => [0, 1, 2, 3].map((j) => (j === Math.floor(i / 2) % 4 || (i % 2 === 1 && j === (Math.floor(i / 2) + 1) % 4) ? 1 : 0)));
    expect(byjOnUln(half)).toMatchObject({ steps: 4 });
    expect(byjOnUln(wave(513, true))).toMatchObject({ steps: -512, angle: 270 });
  });

  it("keeps its place from frame to frame and loses no step between frames", () => {
    const seq = { n: 0 };
    const uln = (states: number[][], start: number) => ctxOf("core.uln2003-module@1.0.0", { edges: edgesOf(["IN1", "IN2", "IN3", "IN4"], states, seq, start) });
    const all = wave(201);
    const first = uln(all.slice(0, 101), 0);
    const memory = {};
    const peersOf = (ctx: PartPeer["ctx"]) => Object.fromEntries(["B", "P", "Y", "O"].map((lead, i) => [lead, [peer("uln2003", `OUT${i + 1}`, ctx)]]));
    stepper28byj48(ctxOf("core.stepper-28byj48@1.0.0", { peers: peersOf(first), memory }));
    // the second frame's log holds every edge so far; the provider reads on from where it stopped
    const whole = ctxOf("core.uln2003-module@1.0.0", { edges: edgesOf(["IN1", "IN2", "IN3", "IN4"], all) });
    expect(stepper28byj48(ctxOf("core.stepper-28byj48@1.0.0", { peers: peersOf(whole), memory }))).toMatchObject({ steps: 200 });
  });

  it("is unpowered with the common under 4 V and with a lead unwired", () => {
    const uln = ctxOf("core.uln2003-module@1.0.0", { edges: edgesOf(["IN1", "IN2", "IN3", "IN4"], wave(10)) });
    const peers = { B: [peer("uln2003", "OUT1", uln)], P: [peer("uln2003", "OUT2", uln)], Y: [peer("uln2003", "OUT3", uln)], O: [peer("uln2003", "OUT4", uln)] };
    expect(stepper28byj48(ctxOf("core.stepper-28byj48@1.0.0", { peers, volts: { R: 0 } }))).toMatchObject({ powered: false });
  });
});

function nemaOnA4988(pins: { step: number; dir: 0 | 1; ms?: [0 | 1, 0 | 1, 0 | 1]; en?: 0 | 1; vmot?: number }) {
  const states = Array.from({ length: pins.step * 2 }, (_, i) => [i % 2 === 0 ? 1 : 0, pins.dir]);
  const ms = pins.ms ?? [0, 0, 0];
  const signals = { MS1: { level: ms[0] }, MS2: { level: ms[1] }, MS3: { level: ms[2] }, EN: { level: pins.en ?? 0 }, DIR: { level: pins.dir } } as const;
  const driver = ctxOf("core.a4988-module@1.0.0", { edges: edgesOf(["STEP", "DIR"], states), signals, volts: { VMOT: pins.vmot ?? 12, GND2: 0, VDD: 5, GND: 0 } });
  return nema17(ctxOf("core.nema17@1.0.0", { peers: { BLK: [peer("a4988-module", "OUT1A", driver)] } }));
}

describe("NEMA 17 on an A4988", () => {
  it("moves a full step for each STEP pulse, 200 a turn, the way DIR says", () => {
    expect(nemaOnA4988({ step: 50, dir: 1 })).toMatchObject({ kind: "stepper", steps: 50, angle: 90, powered: true });
    expect(nemaOnA4988({ step: 50, dir: 0 })).toMatchObject({ steps: -50, angle: 270 });
  });

  it("moves a sixteenth step a pulse with MS1 to MS3 high", () => {
    expect(nemaOnA4988({ step: 160, dir: 1, ms: [1, 1, 1] })).toMatchObject({ steps: 10 });
  });

  it("does not move while disabled or with no motor supply", () => {
    expect(nemaOnA4988({ step: 50, dir: 1, en: 1 })).toMatchObject({ steps: 0 });
    expect(nemaOnA4988({ step: 50, dir: 1, vmot: 0 })).toMatchObject({ steps: 0, powered: false });
  });
});

describe("NEMA 17 on an L298N", () => {
  it("follows the full-step sequence on IN1 to IN4", () => {
    const seq = [
      [1, 0, 1, 0],
      [0, 1, 1, 0],
      [0, 1, 0, 1],
      [1, 0, 0, 1],
    ];
    const states = Array.from({ length: 51 }, (_, i) => seq[i % 4]);
    const bridge = ctxOf("core.l298n-module@1.0.0", { edges: edgesOf(["IN1", "IN2", "IN3", "IN4"], states) });
    const peers = {
      BLK: [peer("l298n-module", "OUT1", bridge)],
      GRN: [peer("l298n-module", "OUT2", bridge)],
      RED: [peer("l298n-module", "OUT3", bridge)],
      BLU: [peer("l298n-module", "OUT4", bridge)],
    };
    expect(nema17(ctxOf("core.nema17@1.0.0", { peers }))).toMatchObject({ steps: 50, angle: 90 });
  });
});

describe("28BYJ-48 through the hub", () => {
  it("finds its ULN2003 by the driver's catalogue name and turns with the board's writes", () => {
    const net: SimNetlist = {
      version: 1,
      docHash: "x",
      nets: ["d8", "d9", "d10", "d11", "b", "p", "y", "o", "v5", "gnd"].map((id) => ({ id })),
      ground: "gnd",
      parts: [
        { id: "brd", descriptor: "core.uno-r3@1.0.0", params: {}, pins: { D8: "d8", D9: "d9", D10: "d10", D11: "d11", P5V: "v5", GND: "gnd" }, kind: "board" },
        {
          id: "d1",
          descriptor: "core.uln2003-module@1.0.0",
          params: {},
          pins: { IN1: "d8", IN2: "d9", IN3: "d10", IN4: "d11", VCC: "v5", GND: "gnd", OUT1: "b", OUT2: "p", OUT3: "y", OUT4: "o", MOTOR_V: null },
          kind: "other",
        },
        { id: "s1", descriptor: "core.stepper-28byj48@1.0.0", params: {}, pins: { B: "b", P: "p", Y: "y", O: "o", R: "v5" }, kind: "other" },
      ],
      settings: { seed: 1, toleranceMode: "nominal", analog: {} as never, speed: 1 },
    };
    const digital = createDigitalNets();
    digital.load(net);
    const hub = createPartStates(net, { digital, live: null });
    let t = 0;
    for (let k = 0; k <= 40; k++) {
      for (let i = 0; i < 4; i++) digital.onPin(`D${8 + i}`, i === k % 4 ? 1 : 0, undefined, (t += 2000));
      t += 3_000_000;
    }
    expect(hub.states(t)).toEqual([expect.objectContaining({ part: "s1", kind: "stepper", steps: 40 })]);
  });
});
