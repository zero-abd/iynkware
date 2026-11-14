// @vitest-environment node
import * as lib from "rp2040js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BusOp, BusPort } from "../../bus/index.ts";
import type { EventSink, SimEvent, SliceBudget } from "../../engine.ts";
import { BOOTROM_B1 } from "./bootrom.ts";
import { createRp2040Engine, type Rp2040Engine, type Rp2040Wiring } from "./engine.ts";
import { handleFlashBreak } from "./flash-rom.ts";
import { buildUf2, FLASH_BASE } from "./uf2.ts";

const budget: SliceBudget = { shouldYield: () => false, work: { statements: 0, events: 0, outputBytes: 0 } };
const NS_PER_MS = 1_000_000;

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(process.cwd(), "src/sim/mcu/rp2040/fixtures", name)));

const noBus: Rp2040Wiring = { volts: () => null, i2c: () => null };

function setup(name: string, wiring: Rp2040Wiring = noBus) {
  const engine = createRp2040Engine({ lib, bootrom: BOOTROM_B1, wiring });
  const events: SimEvent[] = [];
  const sink: EventSink = { emit: (e) => events.push({ ...e, seq: events.length }) };
  engine.attach(sink);
  const loaded = engine.load({ kind: "uf2", bytes: fixture(name) });
  expect(loaded.diagnostics).toEqual([]);
  expect(loaded.ok).toBe(true);
  return { engine, events };
}

/** Runs the engine the way the orchestrator does: a millisecond slice at a time, coming back whenever it stops early. */
function runMs(engine: Rp2040Engine, ms: number): void {
  const end = engine.nowNs + ms * NS_PER_MS;
  for (let t = engine.nowNs; t < end; ) {
    t = Math.min(end, t + NS_PER_MS);
    for (let again = 0; again < 1000; again++) if (!engine.advanceTo(t, budget).stoppedEarly) break;
  }
}

const pinEvents = (events: SimEvent[], pin: string) =>
  events.flatMap((e) => {
    const p = e.payload as { pin: string; level: number | "Z"; duty?: number; hz?: number };
    return e.kind === "pin" && p.pin === pin ? [{ at: e.at, level: p.level, duty: p.duty, hz: p.hz }] : [];
  });

const text = (engine: Rp2040Engine): string => engine.serialLog.map((l) => l.text).join("");

describe("GPIO", () => {
  it("drives GP15 and GP25 from firmware that waits on the timer, one edge every 250 ms", () => {
    const { engine, events } = setup("blink-poll.uf2");
    runMs(engine, 1100);
    const edges = pinEvents(events, "GP15");
    expect(edges.map((e) => e.level)).toEqual([0, 1, 0, 1, 0, 1]);
    const gaps = edges.slice(1).map((e, i) => e.at - edges[i].at);
    // The first gap is the setup between the pin going to an output and the first toggle.
    for (const gap of gaps.slice(1)) expect(Math.abs(gap - 250 * NS_PER_MS)).toBeLessThan(60_000);
    expect(pinEvents(events, "GP25").map((e) => e.level)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(events.every((e) => e.phase === 2 && e.kind === "pin")).toBe(true);
  });

  it("skips most of a long timer wait and leaves under one instruction in fifty to run", () => {
    const { engine } = setup("blink-poll.uf2");
    runMs(engine, 1000);
    expect(engine.stats.skippedNs).toBeGreaterThan(900 * NS_PER_MS);
    // Four waits of 250 ms are 125 million cycles; the skip leaves under one in fifty of them to run.
    expect(engine.stats.instructions).toBeLessThan(1_500_000);
  });

  it("sleeps through WFI until the alarm interrupt, and the edges land on the alarm", () => {
    const { engine, events } = setup("blink-wfi.uf2");
    runMs(engine, 1100);
    const edges = pinEvents(events, "GP15");
    expect(edges.map((e) => e.level)).toEqual([0, 1, 0, 1, 0]);
    expect(Math.abs(edges[1].at - 250 * NS_PER_MS)).toBeLessThan(2000);
    expect(engine.stats.instructions).toBeLessThan(200);
    expect(engine.stats.sleptNs).toBeGreaterThan(1000 * NS_PER_MS);
  });

  it("reads a pin the circuit drives, and a pin nothing drives reads the pull-down every pad starts with", () => {
    const { engine } = setup("say-hi.uf2");
    engine.pins.drive(3, 1);
    expect(engine.pins.read(3)).toEqual({ mode: "input_pulldown", level: 1 });
    engine.pins.drive(3, null);
    expect(engine.pins.read(3)).toEqual({ mode: "input_pulldown", level: 0 });
  });

  it("reports a PWM pin by its duty and frequency instead of every edge", () => {
    const { engine, events } = setup("pwm.uf2");
    runMs(engine, 5);
    expect(pinEvents(events, "GP14")).toEqual([{ at: expect.any(Number), level: 0, duty: 0.25, hz: 125000 }]);
    expect(engine.pins.read(14)).toMatchObject({ mode: "pwm", duty: 0.25 });
  });
});

describe("ADC", () => {
  it("converts the volts the circuit puts on GP26 and turns GP15 on from 1.65 V up", () => {
    let volts: number | null = 0.8;
    const { engine, events } = setup("adc-uart.uf2", { volts: (pin) => (pin === "GP26" ? volts : null), i2c: () => null });
    runMs(engine, 25);
    volts = 2.5;
    runMs(engine, 25);
    volts = 3.3;
    runMs(engine, 25);
    const lines = text(engine).split("\n").filter(Boolean);
    expect(lines.slice(0, 2)).toEqual([`adc ${String(Math.round((0.8 / 3.3) * 4095)).padStart(4, "0")}`, `adc ${String(Math.round((0.8 / 3.3) * 4095)).padStart(4, "0")}`]);
    expect(lines.at(-1)).toBe("adc 4095");
    expect(lines).toContain(`adc ${Math.round((2.5 / 3.3) * 4095)}`);
    expect(pinEvents(events, "GP15").map((e) => e.level)).toEqual([0, 1]);
  });

  it("takes the analog value a host input gives when the circuit has none", () => {
    const { engine } = setup("adc-uart.uf2");
    engine.onEvent({ at: 0, phase: 0, rank: 0, seq: 0, src: "host", kind: "analog", payload: { target: "GP26", value: 1.65 } });
    runMs(engine, 15);
    expect(text(engine)).toContain("adc 2048");
  });
});

describe("UART", () => {
  it("sends what the firmware writes to UART0 to the serial log with the time of the write", () => {
    const { engine } = setup("say-hi.uf2");
    runMs(engine, 2);
    expect(engine.serialLog).toEqual([{ at: expect.any(Number), text: "hi\n" }]);
    expect(engine.serialLog[0].at).toBeLessThan(NS_PER_MS);
  });
});

describe("I2C", () => {
  it("runs a register read through the bus port the circuit gives, on the pins the firmware chose", () => {
    const ops: BusOp[] = [];
    const pins: string[] = [];
    const port: BusPort = {
      transact(_bus, op) {
        ops.push(op);
        if (op.kind === "i2c-start") return { ack: op.addr7 === 0x48, costNs: 90_000 };
        if (op.kind === "i2c-write") return { ack: true, costNs: 90_000 };
        if (op.kind === "i2c-read") return { byte: 104, costNs: 90_000 };
        return { costNs: 10_000 };
      },
    };
    const { engine } = setup("i2c-read.uf2", { volts: () => null, i2c: (sda, scl) => (pins.push(sda, scl), port) });
    runMs(engine, 5);
    expect(pins).toEqual(["GP4", "GP5"]);
    expect(ops).toEqual([
      { kind: "i2c-start", addr7: 0x48, read: false },
      { kind: "i2c-write", byte: 0x75 },
      { kind: "i2c-start", addr7: 0x48, read: true },
      { kind: "i2c-read", last: true },
      { kind: "i2c-stop" },
    ]);
    expect(text(engine)).toBe("i2c 104\n");
  });

  it("answers every address with a nack when the pins are not wired to a bus", () => {
    const { engine } = setup("i2c-read.uf2");
    runMs(engine, 5);
    expect(text(engine)).not.toContain("i2c 104");
  });
});

describe("the engine as a whole", () => {
  it("has no member called run, which is how the worker tells an interpreter engine from a firmware engine", () => {
    expect("run" in createRp2040Engine({ lib, bootrom: BOOTROM_B1, wiring: noBus })).toBe(false);
  });

  it("refuses an image that is not a UF2 file, and a file without a program", () => {
    const engine = createRp2040Engine({ lib, bootrom: BOOTROM_B1, wiring: noBus });
    expect(engine.load({ kind: "hex", hex: ":00000001FF" })).toMatchObject({ ok: false, diagnostics: [{ id: "unsupported-image" }] });
    expect(engine.load({ kind: "uf2", bytes: new Uint8Array(100) })).toMatchObject({ ok: false, diagnostics: [{ id: "uf2-bad-block" }] });
    const nothing = buildUf2([{ address: FLASH_BASE + 0x2000, data: new Uint8Array(16) }]);
    expect(engine.load({ kind: "uf2", bytes: nothing })).toMatchObject({ ok: false, diagnostics: [{ id: "uf2-no-vectors" }] });
    expect(engine.nextDue()).toBeNull();
  });

  it("starts the same run again after a reset, and hashes equal states equally", () => {
    const a = setup("blink-poll.uf2");
    const b = setup("blink-poll.uf2");
    runMs(a.engine, 300);
    runMs(b.engine, 300);
    expect(a.engine.stateHash()).toBe(b.engine.stateHash());
    a.engine.reset("button");
    expect(a.engine.nowNs).toBe(0);
    runMs(a.engine, 300);
    expect(pinEvents(a.events, "GP15").length).toBeGreaterThan(pinEvents(b.events, "GP15").length);
    expect(a.engine.stateHash()).toBe(b.engine.stateHash());
  });

  it("stops the run with an error when the firmware executes a breakpoint", () => {
    const { engine } = setup("breakpoint.uf2");
    runMs(engine, 2);
    expect(engine.diagnostics).toMatchObject([{ id: "runtime-error", severity: "error" }]);
    expect(engine.nextDue()).toBeNull();
  });
});

describe("the flash routines of the boot ROM", () => {
  it("erase and program the flash array and return to the caller", () => {
    const flash = new Uint8Array(64).fill(0xff);
    const ram = new Map<number, number>([[0x20000000, 0xa5], [0x20000001, 0x0f]]);
    const registers = new Uint32Array(16);
    const mcu = { core: { registers, PC: 0 }, flash, readUint8: (address: number) => ram.get(address) ?? 0xff };
    registers[14] = 0x10000101;
    registers[0] = 8;
    registers[1] = 0x20000000;
    registers[2] = 2;
    expect(handleFlashBreak(mcu as never, 2)).toBe(true);
    expect(Array.from(flash.subarray(8, 10))).toEqual([0xa5, 0x0f]);
    expect(mcu.core.PC).toBe(0x10000100);
    registers[0] = 8;
    registers[1] = 4;
    expect(handleFlashBreak(mcu as never, 1)).toBe(true);
    expect(Array.from(flash.subarray(6, 13))).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(handleFlashBreak(mcu as never, 0)).toBe(false);
  });
});
