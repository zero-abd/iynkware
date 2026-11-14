// @vitest-environment node
import * as avr from "avr8js";
import { describe, expect, it } from "vitest";
import { clockRate, cyclesToNs } from "../core/clock.ts";
import { RANK, type EventSink, type SimEvent, type SliceBudget } from "../engine.ts";
import { rangerEcho } from "../devices/hc-sr04.ts";
import { createAvrEngine, type AvrEngine } from "./avr8js.ts";
import { createRangerAdapter } from "./avr8js-ranger.ts";

const RATE = clockRate(125, 2);
const CYCLES_PER_US = 16;
const budget: SliceBudget = { shouldYield: () => false, work: { statements: 0, events: 0, outputBytes: 0 } };
const PIND_BIT = 1 << 1;
const PINB = 0x23;

/** The flash holds 16384 words; this much nop slide leaves room for the pulse code. */
const TAIL = 16_000;
const NOP = 0x0000;
const RJMP_SELF = 0xcfff;

/** TRIG is D8 (PB0), ECHO is D9 (PB1). TRIG goes high at cycle 3 and low again `high` cycles later. */
function trigPulse(high: number, tail: number[]): number[] {
  return [
    0xe001, // ldi r16, 1
    0xe010, // ldi r17, 0
    0xb904, // out DDRB, r16
    0xb905, // out PORTB, r16: TRIG high
    ...Array<number>(high - 1).fill(NOP),
    0xb915, // out PORTB, r17: TRIG low
    ...tail,
  ];
}

function hexOf(words: number[]) {
  const bytes = words.flatMap((w) => [w & 0xff, w >> 8]);
  const record = (addr: number, type: number, data: number[]) => {
    const body = [data.length, addr >> 8, addr & 0xff, type, ...data];
    const sum = (256 - (body.reduce((a, b) => a + b, 0) % 256)) % 256;
    return ":" + [...body, sum].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  };
  const lines: string[] = [];
  for (let at = 0; at < bytes.length; at += 32) lines.push(record(at, 0, bytes.slice(at, at + 32)));
  return { kind: "hex" as const, hex: [...lines, record(0, 1, [])].join("\n") };
}

function boot(words: number[]): { engine: AvrEngine; deliver(e: Partial<SimEvent>): void } {
  const engine = createAvrEngine(avr, { board: "uno-r3" });
  engine.attach({ emit: () => undefined } satisfies EventSink);
  engine.addAdapter(createRangerAdapter([{ part: "us1", trig: "D8", echo: "D9" }]));
  expect(engine.load(hexOf(words)).ok).toBe(true);
  const deliver = (e: Partial<SimEvent>) => engine.onEvent({ at: 0, phase: 0, rank: RANK.mech, seq: 0, src: "mech", kind: "distance", payload: {}, ...e });
  return { engine, deliver };
}

/** Runs one cycle at a time and returns when ECHO rose and how many cycles it stayed up; null when it never rose. */
function measureEcho(engine: AvrEngine, cycles: number): { rose: number; width: number } | null {
  const data = (engine as unknown as { m: { ctx: { cpu: { data: Uint8Array } } } }).m.ctx.cpu.data;
  let rose: number | null = null;
  for (let c = 1; c <= cycles; c++) {
    engine.advanceTo(cyclesToNs(c, RATE), budget);
    const high = (data[PINB] & PIND_BIT) !== 0;
    if (high && rose === null) rose = engine.cycles;
    else if (!high && rose !== null) return { rose, width: engine.cycles - rose };
  }
  return null;
}

const echoCycles = (cm: number) => Math.round(rangerEcho(10, cm)!.widthUs * CYCLES_PER_US);

describe("AVR HC-SR04", () => {
  it.each([3, 8, 12])("holds ECHO for the round trip of %i cm, within a cycle, after the 200 us burst", (cm) => {
    const { engine, deliver } = boot(trigPulse(CYCLES_PER_US * 10, Array<number>(TAIL).fill(NOP)));
    deliver({ payload: { target: "us1", value: cm } });
    const echo = measureEcho(engine, TAIL);
    expect(echo).not.toBeNull();
    expect(Math.abs(echo!.width - echoCycles(cm))).toBeLessThanOrEqual(1);
    // TRIG falls at cycle 3 + 160; ECHO rises 200 us later.
    expect(Math.abs(echo!.rose - (3 + CYCLES_PER_US * 10 + 200 * CYCLES_PER_US))).toBeLessThanOrEqual(1);
  });

  it("answers at 25 cm until a distance event moves the obstacle", () => {
    const { engine } = boot(trigPulse(CYCLES_PER_US * 10, [RJMP_SELF]));
    const echo = measureEcho(engine, 40_000);
    expect(Math.abs(echo!.width - echoCycles(25))).toBeLessThanOrEqual(2);
  });

  it("starts no ping from a TRIG pulse shorter than 10 us", () => {
    const { engine } = boot(trigPulse(CYCLES_PER_US * 10 - 1, Array<number>(8000).fill(NOP)));
    expect(measureEcho(engine, 8000)).toBeNull();
  });

  it("holds ECHO for the 38 ms timeout when the obstacle is out of range", () => {
    const { engine, deliver } = boot(trigPulse(CYCLES_PER_US * 10, [RJMP_SELF]));
    deliver({ payload: { target: "us1", value: 450 } });
    const echo = measureEcho(engine, 700_000);
    // The program ends in a two-cycle loop, which can only be observed every other cycle.
    expect(Math.abs(echo!.width - 38_000 * CYCLES_PER_US)).toBeLessThanOrEqual(2);
  });

  it("ignores a distance for another part and keeps the distance across a reset", () => {
    const { engine, deliver } = boot(trigPulse(CYCLES_PER_US * 10, Array<number>(TAIL).fill(NOP)));
    deliver({ payload: { target: "other", value: 5 } });
    deliver({ payload: { target: "us1", value: 10 } });
    engine.reset("button");
    const echo = measureEcho(engine, TAIL);
    expect(Math.abs(echo!.width - echoCycles(10))).toBeLessThanOrEqual(1);
  });
});
