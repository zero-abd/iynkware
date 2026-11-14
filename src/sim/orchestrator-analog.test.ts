// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { AnalogBackend } from "./analog/backend.ts";
import type { AnalogStepResult, Change, LiveAnalog } from "./analog/live.ts";
import { createOrchestrator } from "./orchestrator.ts";
import type { DigitalLayer, SimNetlist, SimRunOptions, SliceBudget } from "./engine.ts";
import { StateHasher } from "./core/hash.ts";
import { createRunAnalog } from "./analog/run.ts";
import { builtinRegistry } from "../parts/builtin.ts";

const BUDGET: SliceBudget = { shouldYield: () => false, work: { statements: Infinity, events: Infinity, outputBytes: Infinity } };
const OPTS: SimRunOptions = { seed: 1, speed: 1, limits: { statements: 1e6, events: 1e5, outputBytes: 1e5 }, tier: "T1" };
const DIGITAL: DigitalLayer = { load: () => [], onPin: () => undefined, partStates: () => [], stateHash: () => new StateHasher().hex() };
const NET: SimNetlist = { version: 1, docHash: "0", nets: [{ id: "gnd" }], ground: "gnd", parts: [], settings: { seed: 1, toleranceMode: "nominal", analog: { mode: "dc-event", stepNs: 1000 }, speed: 1 } };

function fakeBackend(transient: boolean) {
  const calls: { at: number; changes: Change[] }[] = [];
  const prepared: SimNetlist[] = [];
  const backend: AnalogBackend = {
    kind: "mna-inhouse",
    capabilities: { transient, coSimulate: true, interactive: true },
    prepare(net) {
      prepared.push(net);
      const { mode, stepNs } = net.settings.analog;
      return { ok: true, stepNs: mode === "transient" ? (stepNs ?? null) : null, components: 0, nodes: 0, elements: 0, unmodelled: [], diagnostics: [], modelIds: [] };
    },
    advanceTo(at, changes): AnalogStepResult {
      calls.push({ at, changes });
      return { at, converged: true, solves: 0, skippedClean: 0, events: [], diagnostics: [], worstKclAmps: 0 };
    },
  };
  return { backend, calls, prepared };
}

const live = (): LiveAnalog => createRunAnalog(builtinRegistry());

describe("the orchestrator and its analog backend", () => {
  it("solves on a grid of stepNs when the backend steps and the project asks for transient", () => {
    const { backend, calls, prepared } = fakeBackend(true);
    const orch = createOrchestrator({ engines: [], digital: DIGITAL, analog: live(), backend });
    orch.load({ ...NET, settings: { ...NET.settings, analog: { mode: "transient", stepNs: 1000 } } }, OPTS);
    orch.runUntil(3500, BUDGET);
    expect(prepared[0].settings.analog.mode).toBe("transient");
    expect(calls.map((c) => c.at)).toEqual([0, 1000, 2000, 3000]);
  });

  it("does not tick when the backend cannot step", () => {
    const { backend, calls, prepared } = fakeBackend(false);
    const orch = createOrchestrator({ engines: [], digital: DIGITAL, analog: live(), backend });
    orch.load({ ...NET, settings: { ...NET.settings, analog: { mode: "transient", stepNs: 1000 } } }, OPTS);
    orch.runUntil(3500, BUDGET);
    expect(prepared[0].settings.analog.mode).toBe("dc-event");
    expect(calls.map((c) => c.at)).toEqual([0]);
  });

  it("hands an instrument set by the page to the backend with the solve at that instant", () => {
    const { backend, calls } = fakeBackend(false);
    const orch = createOrchestrator({ engines: [], digital: DIGITAL, analog: live(), backend });
    orch.load(NET, OPTS);
    const source = { kind: "psu", pos: "gnd", neg: "gnd", volts: 5, limitAmps: 0.1 } as const;
    orch.inject({ kind: "param", target: "inst:psu1", value: { source } });
    orch.runUntil(10, BUDGET);
    expect(calls.at(-1)?.changes).toEqual([{ kind: "instrument", element: "psu1", source }]);
    expect(orch.inputs).toHaveLength(1);
  });
});
