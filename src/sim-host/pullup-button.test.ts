// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importWokwi } from "@/export/wokwi/import";
import { builtinRegistry } from "@/parts/builtin";
import { getProfile } from "@/sim/boards/profiles";
import { modelIdsOf } from "@/sim/analog/live";
import { createRunAnalog } from "@/sim/analog/run";
import { createDigitalNets } from "@/sim/digital/nets";
import type { ProgramImage } from "@/sim/engine";
import { buildSimNetlist } from "@/sim/netlist";
import { loadRegistry } from "@/sim/registry/entries";
import { createProbeTap } from "@/sim/probe/tap";
import { bindAnalog } from "./engines/bind";
import { createInterpEngine, type InterpEngine } from "./engines/interp-engine";
import { createSimHandler } from "./handler";
import type { SimEv, SimReq } from "./protocol";

const parts = builtinRegistry();
const fidelity = loadRegistry();
const FIXTURE = join(import.meta.dirname, "../export/wokwi/fixtures/button-led");
const OPTS = { seed: 1, speed: 0, limits: { statements: Infinity, events: Infinity, outputBytes: Infinity }, tier: "T1" as const, endNs: 600_000_000 };
const SKETCH = (mode: string) => `void setup() { pinMode(2, ${mode}); Serial.begin(9600); }
void loop() { Serial.println(digitalRead(2)); delay(20); }
`;
const program = (text: string): ProgramImage => ({ kind: "source", language: "arduino-cpp", files: [{ path: "main.ino", text }], entry: "main.ino" });

function wokwiProject() {
  const files = readdirSync(FIXTURE).map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(FIXTURE, name))) }));
  const env = { id: "prj_00000000000000000000000000", now: "2026-11-10T10:00:00.000Z", locale: "en", actor: "usr_tester", registry: parts };
  const result = importWokwi(files, env);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.project;
}

function rig() {
  const { net } = buildSimNetlist(wokwiProject(), parts);
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
  const drain = (slices = Infinity) => {
    for (let i = 0; i < slices; i++) {
      const task = tasks.shift();
      if (!task) return;
      task();
    }
  };
  const reads = () => events.flatMap((e) => (e.t === "frame" ? e.serial.map((l) => l.text) : [])).join("").split("\n").map((l) => l.trim()).filter(Boolean);
  return { net, send, drain, reads };
}

describe("a pushbutton wired between a pin and ground", () => {
  it("reads LOW while held with INPUT_PULLUP and HIGH when released", async () => {
    const r = rig();
    const button = r.net.parts.find((p) => p.kind === "button")!;
    await r.send({ t: "load", run: 1, net: r.net, opts: OPTS, program: program(SKETCH("INPUT_PULLUP")) });
    await r.send({ t: "control", run: 1, op: "run" });
    r.drain(3);
    expect(new Set(r.reads())).toEqual(new Set(["1"]));
    const press = (value: number) => r.send({ t: "input", run: 1, input: { kind: "param", target: button.id, value: { path: "pressed", value } } });
    await press(1);
    r.drain(3);
    expect(r.reads().at(-1)).toBe("0");
    await press(0);
    r.drain(3);
    expect(r.reads().at(-1)).toBe("1");
  });
});
