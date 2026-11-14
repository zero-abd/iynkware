// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkAll } from "../../project/semantic.ts";
import { createSession } from "../../project/session.ts";
import { seededRandom, steppingClock, USER } from "../../project/session.testing.ts";
import { blinkCircuit } from "../testing/blink-circuit.ts";
import { builtinRegistry } from "../../parts/builtin.ts";
import type { Project } from "../../project/generated/types.ts";
import basys3 from "../starters/basys3.project.json" with { type: "json" };
import { buildPinMap, ensureBoardView, livePins } from "./board.ts";

describe("ensureBoardView", () => {
  const { project, uno } = blinkCircuit();

  it("adds a board view that places the board, and the document stays valid", () => {
    const ops = ensureBoardView(project);
    expect(ops).toHaveLength(1);
    const session = createSession({ state: project, clock: steppingClock(), rnd: seededRandom() });
    const done = session.apply(ops, USER);
    expect(done.ok).toBe(true);
    const view = session.state.views.find((v) => v.kind === "board");
    expect(view?.placements).toEqual([{ c: uno, x_mm: 0, y_mm: 0 }]);
    expect(checkAll(session.state)).toEqual([]);
  });

  it("adds nothing when the document has a board view already or no board", () => {
    const session = createSession({ state: project, clock: steppingClock(), rnd: seededRandom() });
    session.apply(ensureBoardView(project), USER);
    expect(ensureBoardView(session.state)).toEqual([]);
    expect(ensureBoardView({ ...project, boards: [] })).toEqual([]);
  });
});

describe("a board-only Verilog design", () => {
  const state = basys3 as unknown as Project;

  it("lists the mapped port bits and reads each from the name the run reports", () => {
    const model = buildPinMap(state, "brd_main", builtinRegistry());
    const led = model.ports.find((p) => p.port === "led");
    expect(led?.bits).toHaveLength(16);
    expect(led?.bits[3]?.signal).toBe("LD3");
    const live = livePins(state, { tNs: 0, pins: { LD3: 1, LD4: 0, LD5: "Z" }, parts: [] }, "brd_main");
    expect(live.LD3).toEqual({ level: 1 });
    expect(live.LD4).toEqual({ level: 0 });
    expect(live.LD5).toBeUndefined();
  });
});
