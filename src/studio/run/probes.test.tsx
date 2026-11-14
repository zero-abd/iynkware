import { readFileSync } from "node:fs";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { linkSim } from "@/components/studio/wiring/simLink";
import { INTERP_LANGUAGE } from "@/lib/interp";
import { classifyImpact } from "@/project/opImpact";
import { createSession } from "@/project/session";
import { seededRandom, steppingClock } from "@/project/session.testing";
import { validateValue } from "@/project/validate";
import { boardNetVolts } from "@/sim-host/engines/board-volts";
import { createInterpEngine, type InterpEngine } from "@/sim-host/engines/interp-engine";
import { createSimHandler } from "@/sim-host/handler";
import { createSimHost } from "@/sim-host/host";
import { createInlinePort } from "@/protocol";
import { createDigitalNets } from "@/sim/digital/nets";
import { createProbeTap } from "@/sim/probe/tap";
import { loadRegistry } from "@/sim/registry/entries";
import { nodeIdOf } from "@/studio/instruments/placement";
import { createDocStore } from "@/studio/stores/doc";
import { createRunStore } from "@/studio/stores/run";
import { createProbeClient } from "./probes";

const hosts: Array<ReturnType<typeof createSimHost>> = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.kill()));
});

const noSolver = (netVolts: (net: string) => number | null) => ({
  netVolts,
  pinVolts: () => null,
  componentResult: () => null,
  nodeIndex: () => null,
  whatIf: (): never => {
    throw new Error("no solver");
  },
});

function knobRun() {
  const state = validateValue(JSON.parse(readFileSync("src/studio/starters/knob.project.json", "utf8"))).doc!;
  let wall = 0;
  const host = createSimHost({
    makePort: () =>
      createInlinePort(
        createSimHandler({
          diag: false,
          wallMs: () => (wall += 2000),
          schedule: (fn) => void setTimeout(fn, 0),
          makeEngine: (program, net, opts) =>
            createInterpEngine({
              id: net.parts.find((p) => p.kind === "board")!.id,
              board: "uno-r3",
              language: INTERP_LANGUAGE[(program.kind === "source" ? program.language : "arduino-cpp") as keyof typeof INTERP_LANGUAGE] ?? "arduino",
              seed: opts.seed,
            }),
          makeDigital: createDigitalNets,
          makeTap: (net, engine) => createProbeTap({ analog: noSolver(boardNetVolts(net, engine as InterpEngine)), registry: loadRegistry(), modelOf: () => [] }),
        }),
      ),
  });
  hosts.push(host);
  const doc = createDocStore(createSession({ state, clock: steppingClock(), rnd: seededRandom() }));
  const run = createRunStore();
  const link = linkSim({ doc, run, host, impact: classifyImpact });
  const started = async () => {
    await link.run();
    await waitFor(() => expect(run.getState().serial.length).toBeGreaterThan(0));
  };
  return { state, host, started };
}

describe("createProbeClient", () => {
  const reading = { value: 3.03, unit: "V", at: 0, provenance: "computed", tier: "T1", modelIds: [] } as const;

  function fakeHost(onAdd: (id: string, send: (r: typeof reading) => void) => void | Promise<void>) {
    const watchers = new Map<string, (r: typeof reading) => void>();
    return {
      watchers,
      probes: {
        watch: (id: string, fn: (r: typeof reading) => void) => (watchers.set(id, fn), () => void watchers.delete(id)),
        subscribe: () => () => undefined,
        remove: () => undefined,
        add: async (spec: { id: string }) => onAdd(spec.id, (r) => watchers.get(spec.id)?.(r)),
      },
    };
  }

  it("keeps the reading the host sends while the add is being answered, which a steady value never sends again", async () => {
    const host = fakeHost((_id, send) => send(reading));
    const client = createProbeClient(host as never);
    const { result } = renderHook(() => client.useReading("meter"));
    await client.add({ id: "meter", kind: "voltage", target: "n:x", capacity: 16, envelope: false });
    expect(result.current).toEqual(reading);
  });

  it("stops watching when the add is refused", async () => {
    const host = fakeHost(() => Promise.reject(new Error("unknown-target")));
    const client = createProbeClient(host as never);
    await expect(client.add({ id: "meter", kind: "voltage", target: "nope", capacity: 16, envelope: false })).rejects.toThrow("unknown-target");
    expect(host.watchers.size).toBe(0);
  });
});

describe("a probe on the knob's wiper, through the worker's handler", () => {
  it("shows its steady reading in the page, which arrives once", async () => {
    const { state, host, started } = knobRun();
    await started();
    const client = createProbeClient(host);
    const { result } = renderHook(() => client.useReading("meter"));
    await client.add({ id: "meter", kind: "voltage", target: nodeIdOf(state).ofNet("net_a0")!, capacity: 16, envelope: false });
    await waitFor(() => expect(result.current).toMatchObject({ unit: "V", provenance: "computed" }));
    expect(result.current!.value).toBeCloseTo((620 / 1023) * 5, 6);
  });

  it("is read, and removed, by its id", async () => {
    const { state, host, started } = knobRun();
    await started();
    const client = createProbeClient(host);
    await client.add({ id: "meter", kind: "voltage", target: nodeIdOf(state).ofNet("net_a0")!, capacity: 16, envelope: false });
    expect((await host.probes.read("meter")).value).toBeCloseTo((620 / 1023) * 5, 6);
    client.remove("meter");
    await expect(host.probes.read("meter")).rejects.toThrow(/no probe meter/);
  });
});
