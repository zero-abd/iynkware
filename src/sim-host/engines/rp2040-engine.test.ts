// @vitest-environment node
import * as lib from "rp2040js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "@/parts/builtin";
import type { Project } from "@/project/generated/types";
import { type LiveAnalog, modelIdsOf, pinElementId } from "@/sim/analog/live";
import { createRunAnalog } from "@/sim/analog/run";
import { createDigitalNets } from "@/sim/digital/nets";
import { buildSimNetlist } from "@/sim/netlist";
import { BOOTROM_B1 } from "@/sim/mcu/rp2040/bootrom";
import { createRp2040Engine } from "@/sim/mcu/rp2040/engine";
import { createProbeTap } from "@/sim/probe/tap";
import { loadRegistry } from "@/sim/registry/entries";
import pico from "@/studio/starters/pico.project.json";
import { createSimHandler } from "../handler";
import type { SimEv, SimReq } from "../protocol";

const parts = builtinRegistry();
const fidelity = loadRegistry();
const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "src/sim/mcu/rp2040/fixtures", name)));
const OPTS = (endNs: number) => ({ seed: 1, speed: 0, limits: { statements: Infinity, events: Infinity, outputBytes: Infinity }, tier: "T1" as const, endNs });

function rig(project: unknown) {
  const { net } = buildSimNetlist(project as Project, parts);
  const tasks: Array<() => void> = [];
  const events: SimEv[] = [];
  let volts: ((pin: string) => number | null) | null = null;
  let wall = 0;
  const handler = createSimHandler({
    diag: false,
    wallMs: () => (wall += 1),
    schedule: (fn) => void tasks.push(fn),
    makeEngine: () => createRp2040Engine({ lib, bootrom: BOOTROM_B1, wiring: { volts: (pin) => volts?.(pin) ?? null, i2c: () => null } }),
    makeDigital: createDigitalNets,
    analog: {
      create: () => createRunAnalog(parts, fidelity),
      bind: (_engine, live: LiveAnalog, n) => {
        const board = n.parts.find((p) => p.kind === "board")!.id;
        volts = (pin) => live.pinVolts(pinElementId(board, pin));
      },
    },
    makeTap: (n, _e, live) => createProbeTap({ analog: live!, registry: fidelity, modelOf: (id) => [...modelIdsOf(n.parts.find((p) => p.id === id)?.descriptor ?? "")] }),
  });
  const send = async (msg: SimReq) => handler(msg, (ev) => events.push(ev));
  const drain = () => {
    for (let task = tasks.shift(); task; task = tasks.shift()) task();
  };
  return { net, send, drain, events };
}

/** The Pico starter with its LED and resistor taken out and two 10 kohm resistors between 3V3 and GND, their middle on GP26. */
function divider(): unknown {
  const project = structuredClone(pico) as unknown as Project;
  const resistor = project.components.find((c) => c.id === "cmp_r1")!;
  project.components = [{ ...resistor, params: { ohms: 10000 } }, { ...resistor, id: "cmp_r2", refdes: "R2", params: { ohms: 10000 } }];
  project.nets = [
    { id: "net_gnd", name: "GND", class: "ground", connections: [{ c: "brd_main", p: "GND" }, { c: "cmp_r2", p: "P2" }] },
    { id: "net_3v3", name: "3V3", class: "power", connections: [{ c: "brd_main", p: "P3V3" }, { c: "cmp_r1", p: "P1" }] },
    { id: "net_mid", class: "signal", connections: [{ c: "brd_main", p: "GP26" }, { c: "cmp_r1", p: "P2" }, { c: "cmp_r2", p: "P1" }] },
  ];
  project.views = [];
  return project;
}

const frames = (events: SimEv[]) => events.flatMap((e) => (e.t === "frame" ? [e] : []));
const serialText = (events: SimEv[]) => frames(events).flatMap((f) => f.serial.map((s) => s.text)).join("");

describe("a Pico running a UF2 file in the circuit", () => {
  it("lights the LED on GP15 through its resistor while the firmware holds the pin high", async () => {
    const r = rig(pico);
    const loaded = (await r.send({ t: "load", run: 1, net: r.net, opts: OPTS(1_100_000_000), program: { kind: "uf2", bytes: fixture("blink-poll.uf2") } })) as { diagnostics: unknown[] };
    expect(loaded.diagnostics).toEqual([]);
    await r.send({ t: "control", run: 1, op: "run" });
    r.drain();
    const levels = frames(r.events).map((f) => f.pins.GP15).filter((level, i, all) => level !== undefined && level !== all[i - 1]);
    // The pin goes low and high again within 8 ns of the start, and a frame is at most one in a thirtieth of a second.
    expect(levels).toEqual([1, 0, 1, 0, 1]);
    const led = frames(r.events).flatMap((f) => f.parts.flatMap((p) => (p.kind === "led" ? [p.lit] : [])));
    expect(new Set(led)).toEqual(new Set([true, false]));
    const lastLed = frames(r.events).at(-1)!.parts.find((p) => p.kind === "led");
    expect(lastLed).toMatchObject({ lit: true });
  });

  it("reads the middle of a divider with the ADC, from what the solver finds on GP26, and shows it on the serial monitor", async () => {
    const r = rig(divider());
    await r.send({ t: "load", run: 1, net: r.net, opts: OPTS(60_000_000), program: { kind: "uf2", bytes: fixture("adc-uart.uf2") } });
    await r.send({ t: "control", run: 1, op: "run" });
    r.drain();
    const values = serialText(r.events).split("\n").filter(Boolean).map((line) => Number(line.replace("adc ", "")));
    expect(values.length).toBeGreaterThan(4);
    for (const value of values) expect(Math.abs(value - 2048)).toBeLessThanOrEqual(2);
    const gp15 = frames(r.events).map((f) => f.pins.GP15).filter((level) => level !== undefined);
    expect(gp15.at(-1)).toBe(1);
  });

  it("sends a line typed in the serial monitor to UART0 of the firmware", async () => {
    const r = rig(pico);
    await r.send({ t: "load", run: 1, net: r.net, opts: OPTS(5_000_000), program: { kind: "uf2", bytes: fixture("say-hi.uf2") } });
    await r.send({ t: "control", run: 1, op: "run" });
    r.drain();
    expect(serialText(r.events)).toBe("hi\n");
  });

  it("refuses the load with a named reason when the file is not a UF2 file", async () => {
    const r = rig(pico);
    const loaded = (await r.send({ t: "load", run: 1, net: r.net, opts: OPTS(1_000_000), program: { kind: "uf2", bytes: new Uint8Array(10) } })) as { diagnostics: Array<{ id: string }> };
    expect(loaded.diagnostics.map((d) => d.id)).toEqual(["uf2-bad-block"]);
  });
});

describe("parse-uf2", () => {
  it("answers with the size or the reason", async () => {
    const r = rig(pico);
    expect(await r.send({ t: "parse-uf2", bytes: fixture("blink-poll.uf2") })).toMatchObject({ ok: true });
    expect(await r.send({ t: "parse-uf2", bytes: new Uint8Array(512) })).toMatchObject({ ok: false, error: { kind: "uf2-bad-block" } });
  });
});
