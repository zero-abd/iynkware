// @vitest-environment node
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "@/parts/builtin";
import { getProfile } from "@/sim/boards/profiles";
import { modelIdsOf } from "@/sim/analog/live";
import { createRunAnalog } from "@/sim/analog/run";
import { createDigitalNets } from "@/sim/digital/nets";
import type { PartState, ProgramImage } from "@/sim/engine";
import { buildSimNetlist } from "@/sim/netlist";
import { loadRegistry } from "@/sim/registry/entries";
import { createProbeTap } from "@/sim/probe/tap";
import { ACTUATOR_SKETCH, actuatorCircuit } from "@/studio/testing/actuator-circuit";
import { bindAnalog } from "./engines/bind";
import { createInterpEngine, type InterpEngine } from "./engines/interp-engine";
import { createSimHandler } from "./handler";
import type { SimEv, SimReq } from "./protocol";

const parts = builtinRegistry();
const fidelity = loadRegistry();
const OPTS = { seed: 1, speed: 0, limits: { statements: Infinity, events: Infinity, outputBytes: Infinity }, tier: "T1" as const, endNs: 1_000_000_000 };
const image = (text: string): ProgramImage => ({ kind: "source", language: "arduino-cpp", files: [{ path: "main.ino", text }], entry: "main.ino" });

async function lastStates(sketch: string): Promise<{ states: PartState[]; circuit: ReturnType<typeof actuatorCircuit> }> {
  const circuit = actuatorCircuit(sketch);
  const { net } = buildSimNetlist(circuit.project, parts);
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
  await send({ t: "load", run: 1, net, opts: OPTS, program: image(sketch) });
  await send({ t: "control", run: 1, op: "run" });
  for (let task = tasks.shift(); task; task = tasks.shift()) task();
  const frames = events.flatMap((e) => (e.t === "frame" ? [e.parts] : []));
  return { states: frames[frames.length - 1] as PartState[], circuit };
}

describe("a run with a servo and a motor", () => {
  it("shows the servo angle and the motor speed", async () => {
    const { states, circuit } = await lastStates(ACTUATOR_SKETCH);
    console.log(JSON.stringify(states));
    
  });
});
