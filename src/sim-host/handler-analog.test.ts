// @vitest-environment node
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "@/parts/builtin";
import type { Project } from "@/project/generated/types";
import { getProfile } from "@/sim/boards/profiles";
import { modelIdsOf } from "@/sim/analog/live";
import { createRunAnalog } from "@/sim/analog/run";
import { createDigitalNets } from "@/sim/digital/nets";
import type { ProgramImage } from "@/sim/engine";
import { buildSimNetlist } from "@/sim/netlist";
import { loadRegistry } from "@/sim/registry/entries";
import { createProbeTap } from "@/sim/probe/tap";
import blink from "@/studio/starters/blink.project.json";
import knob from "@/studio/starters/knob.project.json";
import rcLed from "@/studio/starters/rc-led.project.json";
import { bindAnalog } from "./engines/bind";
import { createInterpEngine, type InterpEngine } from "./engines/interp-engine";
import { createSimHandler } from "./handler";
import type { SimEv, SimReq } from "./protocol";
import { inputDrives } from "./world-drive";

const parts = builtinRegistry();
const fidelity = loadRegistry();
const SKETCH = `void setup() { pinMode(13, OUTPUT); digitalWrite(13, HIGH); }
void loop() { delay(10); }
`;
const READ = `void setup() { pinMode(A0, INPUT); Serial.begin(9600); }
void loop() { Serial.println(analogRead(A0)); delay(10); }
`;
const image = (text: string): ProgramImage => ({ kind: "source", language: "arduino-cpp", files: [{ path: "main.ino", text }], entry: "main.ino" });
const program: ProgramImage = { kind: "source", language: "arduino-cpp", files: [{ path: "main.ino", text: SKETCH }], entry: "main.ino" };
const OPTS = { seed: 1, speed: 0, limits: { statements: Infinity, events: Infinity, outputBytes: Infinity }, tier: "T1" as const, endNs: 100_000_000 };

function rig(project: unknown) {
  const { net } = buildSimNetlist(project as Project, parts);
  const tasks: Array<() => void> = [];
  const events: SimEv[] = [];
  let wall = 0;
  const handler = createSimHandler({
    diag: false,
    wallMs: () => (wall += 1),
    schedule: (fn) => void tasks.push(fn),
    makeEngine: (_p, _n, o) => createInterpEngine({ id: "brd_main", board: "uno-r3", language: "arduino", seed: o.seed }),
    makeDigital: createDigitalNets,
    analog: {
      create: () => createRunAnalog(parts, fidelity),
      bind: (engine, live, n) => bindAnalog(engine as InterpEngine, live, n.parts.find((p) => p.kind === "board")!.id, getProfile("uno-r3")),
    },
    makeTap: (_n, _e, live) => createProbeTap({ analog: live!, registry: fidelity, modelOf: (id) => [...modelIdsOf(_n.parts.find((p) => p.id === id)?.descriptor ?? "")] }),
  });
  const send = async (msg: SimReq) => handler(msg, (ev) => events.push(ev));
  const drain = () => {
    for (let task = tasks.shift(); task; task = tasks.shift()) task();
  };
  return { net, send, drain, events };
}

const frames = (events: SimEv[]) => events.flatMap((e) => (e.t === "frame" && e.analog ? [e.analog] : []));

describe("a run with the live solver", () => {
  it("answers a meter read with the LED current and a probe with the net voltage", async () => {
    const r = rig(blink);
    await r.send({ t: "load", run: 1, net: r.net, opts: OPTS, program });
    await r.send({ t: "control", run: 1, op: "run" });
    r.drain();
    const led = r.net.parts.find((p) => p.id === "cmp_led1")!;
    const anode = Object.values(led.pins).find((n) => n !== null)!;
    const reading = (await r.send({ t: "meter.read", run: 1, meter: "m1", settings: { mode: "dc-amps" }, probes: { red: anode, black: null, element: "cmp_led1" } })) as { value: number };
    expect(reading.value).toBeCloseTo(3 / 245.5, 3);
    await r.send({ t: "probe.add", run: 1, spec: { id: "p1", kind: "voltage", target: anode, capacity: 8, envelope: false } });
    const volts = (await r.send({ t: "probe.read", run: 1, probe: "p1" })) as { value: number };
    expect(volts.value).toBeGreaterThan(2);
  });

  it("reports part health with no watch at all, so a burnt part shows with the flow lens off", async () => {
    const r = rig(blink);
    await r.send({ t: "load", run: 1, net: r.net, opts: OPTS, program });
    await r.send({ t: "control", run: 1, op: "run" });
    r.drain();
    const sent = frames(r.events);
    expect(sent.some((f) => f.parts?.cmp_led1)).toBe(true);
    expect(sent.every((f) => f.volts === undefined && f.amps === undefined)).toBe(true);
  });

  it("sends the watched values once the page watches, and only part health when the watch is empty", async () => {
    const r = rig(blink);
    await r.send({ t: "load", run: 1, net: r.net, opts: OPTS, program });
    await r.send({ t: "analog.watch", run: 1, watch: { volts: "all", amps: "all", pinAmps: false, waves: [] } });
    expect(frames(r.events)[0].full).toBe(true);
    await r.send({ t: "control", run: 1, op: "run" });
    r.drain();
    const last = frames(r.events).at(-1)!;
    expect(last.parts?.cmp_led1).toBeDefined();
    await r.send({ t: "analog.watch", run: 1, watch: { volts: [], amps: [], pinAmps: false, waves: [] } });
    const after = frames(r.events).at(-1)!;
    expect(after.parts?.cmp_led1).toBeDefined();
    expect(after.volts).toBeUndefined();
    expect(after.amps).toBeUndefined();
  });

  it("turns the potentiometer the knob drives, so a meter on the wiper reads the knob", async () => {
    const r = rig(knob);
    await r.send({ t: "load", run: 1, net: r.net, opts: OPTS, program: image(READ) });
    const doc = knob as unknown as Project;
    for (const drive of inputDrives(r.net, doc.simulation.world.inputs[0], 620)) await r.send({ t: "input", run: 1, input: drive });
    await r.send({ t: "control", run: 1, op: "run" });
    r.drain();
    const wiper = r.net.parts.find((p) => p.kind === "pot")!.pins.W!;
    await r.send({ t: "probe.add", run: 1, spec: { id: "w", kind: "voltage", target: wiper, capacity: 8, envelope: false } });
    const reading = (await r.send({ t: "probe.read", run: 1, probe: "w" })) as { value: number };
    expect(reading.value).toBeCloseTo((620 / 1023) * 5, 2);
    const serial = r.events.flatMap((e) => (e.t === "frame" ? e.serial.map((l) => l.text) : [])).join("").split("\n").map((l) => l.trim()).filter(Boolean);
    expect(new Set(serial)).toEqual(new Set(["620"]));
  });

  it("refuses a bench source on an unknown net and takes one between two known nets", async () => {
    const r = rig(blink);
    await r.send({ t: "load", run: 1, net: r.net, opts: OPTS, program });
    const [a, b] = r.net.nets.map((n) => n.id);
    const psu = (pos: string) => ({ t: "instrument.set", run: 1, instrument: "psu1", source: { kind: "psu", pos, neg: b, volts: 5, limitAmps: 0.1 } }) as const;
    expect(await r.send(psu("nowhere"))).toEqual({ ok: false, reason: "unknown-net" });
    expect(await r.send(psu(a))).toEqual({ ok: true });
  });

  it("samples a probe at every step of a transient run, so the trace is a waveform that follows the capacitor", async () => {
    const r = rig(rcLed);
    await r.send({ t: "load", run: 1, net: r.net, opts: { ...OPTS, endNs: 300_000_000 }, program: image("void setup() {}\nvoid loop() { delay(10); }\n") });
    const cap = r.net.parts.find((p) => p.id === "cmp_c1")!.pins.PLUS!;
    await r.send({ t: "probe.add", run: 1, spec: { id: "c", kind: "voltage", target: cap, capacity: 1024, envelope: false } });
    await r.send({ t: "probe.sub", run: 1, probe: "c", from: 0 });
    await r.send({ t: "control", run: 1, op: "run" });
    r.drain();
    const chunks = r.events.flatMap((e) => (e.t === "probe.chunk" && e.chunk.id === "c" ? [e.chunk] : []));
    const t = chunks.flatMap((c) => Array.from(c.t));
    const v = chunks.flatMap((c) => Array.from(c.v));
    expect(chunks.every((c) => !c.staircase)).toBe(true);
    expect(t.length).toBeGreaterThan(200);
    expect(t[2] - t[1]).toBe(1_000_000);
    expect(v.at(-1)!).toBeGreaterThan(v[10]!);
    expect(v.every((x, i) => i === 0 || x >= v[i - 1]! - 1e-9)).toBe(true);
  });
  it("samples a probe no more often than the page asked, in whole steps", async () => {
    const r = rig(rcLed);
    await r.send({ t: "load", run: 1, net: r.net, opts: { ...OPTS, endNs: 300_000_000 }, program: image("void setup() {}\nvoid loop() { delay(10); }\n") });
    const cap = r.net.parts.find((p) => p.id === "cmp_c1")!.pins.PLUS!;
    await r.send({ t: "probe.add", run: 1, spec: { id: "c", kind: "voltage", target: cap, capacity: 1024, envelope: false, sampleNs: 10_000_000 } });
    await r.send({ t: "probe.sub", run: 1, probe: "c", from: 0 });
    await r.send({ t: "control", run: 1, op: "run" });
    r.drain();
    const t = r.events.flatMap((e) => (e.t === "probe.chunk" && e.chunk.id === "c" ? Array.from(e.chunk.t) : []));
    expect(t.length).toBeGreaterThan(20);
    expect(t.length).toBeLessThan(40);
    expect(t[2] - t[1]).toBe(10_000_000);
  });

  it("keeps a probe event driven in a run that does not step, whatever interval was asked", async () => {
    const r = rig(blink);
    await r.send({ t: "load", run: 1, net: r.net, opts: OPTS, program });
    const node = r.net.nets[0].id;
    await r.send({ t: "probe.add", run: 1, spec: { id: "p", kind: "voltage", target: node, capacity: 64, envelope: false, sampleNs: 1_000_000 } });
    await r.send({ t: "probe.sub", run: 1, probe: "p", from: 0 });
    await r.send({ t: "control", run: 1, op: "run" });
    r.drain();
    const chunks = r.events.flatMap((e) => (e.t === "probe.chunk" && e.chunk.id === "p" ? [e.chunk] : []));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.staircase)).toBe(true);
  });
  it("turns a probe that was a staircase into a waveform once a function generator starts the stepping", async () => {
    const r = rig(blink);
    await r.send({ t: "load", run: 1, net: r.net, opts: OPTS, program });
    const [a, b] = r.net.nets.map((n) => n.id);
    await r.send({ t: "probe.add", run: 1, spec: { id: "p", kind: "voltage", target: a, capacity: 1024, envelope: false } });
    await r.send({ t: "probe.sub", run: 1, probe: "p", from: 0 });
    const wave = { shape: "sine", amplitudeV: 1, offsetV: 0, hz: 1000, duty: 0.5, phaseDeg: 0 } as const;
    expect(await r.send({ t: "instrument.set", run: 1, instrument: "fg1", source: { kind: "fgen", pos: a, neg: b, wave, rSeriesOhms: 50 } })).toEqual({ ok: true });
    await r.send({ t: "control", run: 1, op: "run" });
    r.drain();
    const chunks = r.events.flatMap((e) => (e.t === "probe.chunk" && e.chunk.id === "p" ? [e.chunk] : []));
    const late = chunks.filter((c) => c.from > 1_000_000);
    expect(late.length).toBeGreaterThan(0);
    expect(late.every((c) => !c.staircase)).toBe(true);
    expect(late.flatMap((c) => Array.from(c.v)).length).toBeGreaterThan(100);
  });
});
