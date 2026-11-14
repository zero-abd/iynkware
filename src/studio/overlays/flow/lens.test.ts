import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../../project/generated/types.ts";
import type { AnalogWatch } from "../../../sim-host/analog-protocol.ts";
import type { EditorEngine } from "../../engine/engine.ts";
import { createRunStore } from "../../stores/run.ts";
import { createSessionStore } from "../../stores/session.ts";
import { createUiStore } from "../../stores/ui.ts";
import { createFlowLens } from "./lens.ts";
import type { FlowLabels } from "./health.ts";

const project = { views: [{ id: "vw_bb", kind: "breadboard", wires: [], placements: [] }], nets: [], boards: [], components: [], dependencies: { components: [] } } as unknown as Project;

function rig() {
  const run = createRunStore();
  const ui = createUiStore("prj_lens", { getItem: () => null, setItem: () => undefined }, {});
  const session = createSessionStore("vw_bb");
  const watches: AnalogWatch[] = [];
  const engine = { scene: () => ({ items: [], targets: [] }), viewport: () => ({ cx_mm: 0, cy_mm: 0, k: 4, w: 100, h: 100, dpr: 1 }) } as unknown as EditorEngine;
  const lens = createFlowLens({
    doc: { getState: () => ({ state: project }), onChange: () => () => undefined } as never,
    session,
    run,
    ui,
    engine,
    registry: { get: () => undefined } as never,
    host: { watchAnalog: async (w) => void watches.push(w) },
    labels: { state: { hot: "hot", reversed: "reversed", burnt: "burnt" } } as unknown as FlowLabels,
    reduceMotion: () => true,
  });
  const host = document.createElement("div");
  const off = lens.mount(host);
  return { run, ui, watches, lens, host, off };
}

describe("the flow lens", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("puts a canvas over the host and takes it off again", () => {
    const { host, off } = rig();
    expect(host.querySelector("canvas[data-flow-layer]")).not.toBeNull();
    off();
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("asks the run for every voltage, pin current and part state once a run is going, and stops asking when it is switched off", () => {
    const { run, ui, watches } = rig();
    expect(watches).toEqual([]);
    run.apply({ t: "phase", phase: "running" });
    expect(watches).toHaveLength(1);
    expect(watches[0]).toMatchObject({ volts: "all", pinAmps: true });
    run.apply({ t: "phase", phase: "paused" });
    expect(watches).toHaveLength(1);
    ui.set("flowLens", false);
    expect(watches).toHaveLength(2);
    expect(watches[1]).toMatchObject({ volts: [], pinAmps: false });
  });

  it("asks again for the next run, and stops asking on teardown", () => {
    const { run, watches, off } = rig();
    run.apply({ t: "phase", phase: "running" });
    run.apply({ t: "phase", phase: "idle" });
    run.apply({ t: "phase", phase: "running" });
    expect(watches.filter((w) => w.volts === "all")).toHaveLength(2);
    off();
    expect(watches.at(-1)).toMatchObject({ volts: [] });
  });

  it("has no range and no reading until the run has reported", () => {
    const { lens, run } = rig();
    expect(lens.range()).toBeNull();
    run.apply({ t: "analog", frame: { full: true, volts: { a: 3.3, b: -1 } } });
    expect(lens.range()).toEqual({ max: 5, low: -1, high: 3.3 });
    expect(lens.reading()).toBeNull();
  });

  it("shows nothing when it is off, whatever the run has reported", () => {
    const { lens, run, ui } = rig();
    run.apply({ t: "analog", frame: { full: true, volts: { a: 3.3 } } });
    ui.set("flowLens", false);
    expect(lens.range()).toBeNull();
  });
});
