// @vitest-environment node
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "@/parts/builtin";
import { getProfile } from "@/sim/boards/profiles";
import { modelIdsOf } from "@/sim/analog/live";
import { createRunAnalog } from "@/sim/analog/run";
import { createDigitalNets } from "@/sim/digital/nets";
import type { ProgramImage } from "@/sim/engine";
import { defaultRules } from "@/sim/faults/rules";
import { buildSimNetlist } from "@/sim/netlist";
import { loadRegistry } from "@/sim/registry/entries";
import { createProbeTap } from "@/sim/probe/tap";
import { ledOnD13 } from "@/studio/fixes.testing";
import { bindAnalog } from "./engines/bind";
import { createInterpEngine, type InterpEngine } from "./engines/interp-engine";
import { createSimHandler } from "./handler";
import type { SimEv } from "./protocol";

const parts = builtinRegistry();
const fidelity = loadRegistry();
const SKETCH = `void setup() { pinMode(13, OUTPUT); digitalWrite(13, HIGH); }
void loop() { delay(10); }
`;
const program: ProgramImage = { kind: "source", language: "arduino-cpp", files: [{ path: "main.ino", text: SKETCH }], entry: "main.ino" };
const OPTS = { seed: 1, speed: 0, limits: { statements: Infinity, events: Infinity, outputBytes: Infinity }, tier: "T1" as const, endNs: 100_000_000 };

describe("the findings a finished run posts", () => {
  it("name an LED that burnt on D13, with the resistor that would have saved it", async () => {
    const { net } = buildSimNetlist(ledOnD13(), parts);
    const tasks: Array<() => void> = [];
    const events: SimEv[] = [];
    let wall = 0;
    const handler = createSimHandler({
      diag: false,
      wallMs: () => (wall += 1),
      schedule: (fn) => void tasks.push(fn),
      makeEngine: (_p, _n, o) => createInterpEngine({ id: "brd_uno", board: "uno-r3", language: "arduino", seed: o.seed }),
      makeDigital: createDigitalNets,
      analog: {
        create: () => createRunAnalog(parts, fidelity),
        bind: (engine, live, n) => bindAnalog(engine as InterpEngine, live, n.parts.find((p) => p.kind === "board")!.id, getProfile("uno-r3")),
      },
      makeTap: (_n, _e, live) => createProbeTap({ analog: live!, registry: fidelity, modelOf: (id) => [...modelIdsOf(_n.parts.find((p) => p.id === id)?.descriptor ?? "")] }),
      faults: {
        describe: (id) => {
          const [ref = "", version = ""] = id.split("@");
          return parts.get(ref, version);
        },
        rules: defaultRules,
      },
    });
    const send = (msg: Parameters<typeof handler>[0]) => handler(msg, (ev) => events.push(ev));
    await send({ t: "load", run: 1, net, opts: OPTS, program });
    await send({ t: "control", run: 1, op: "run" });
    for (let task = tasks.shift(); task; task = tasks.shift()) task();

    const posted = events.flatMap((e) => (e.t === "event" && e.event.kind === "findings" ? [e.event.findings] : []));
    const rules = (posted.at(-1) ?? []).map((f) => f.ruleId);
    expect(rules).toContain("solve:led-overcurrent@1");
    expect(rules).toContain("solve:pin-overcurrent@1");
    const burnt = posted.at(-1)!.find((f) => f.ruleId === "solve:led-overcurrent@1")!;
    expect(burnt.fixes?.[0]).toMatchObject({ messageKey: "fix.led-series", plan: { t: "series", at: { part: "cmp_led", pin: "A" }, ohms: 330 } });
  });
});
