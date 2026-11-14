// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Project } from "@/project/generated/types";
import { INTERP_LANGUAGE } from "@/lib/interp";
import { boardIdOf } from "@/sim/boards/profiles";
import type { EventSink, SimEvent, SliceBudget } from "@/sim/engine";
import { STARTERS } from "@/studio/starters";
import { createInterpEngine } from "./interp-engine";

const MS = 1_000_000;
const BUDGET: SliceBudget = { shouldYield: () => false, work: { statements: Infinity, events: Infinity, outputBytes: Infinity } };

const files = [["uno-r3", "src/studio/starters/blink.project.json"], ...STARTERS.map((s) => [s.board, `src/studio/starters/${s.board}.project.json`])];

// Every board's own starter runs on that board in the Studio's engine: it loads and it drives a pin or prints.
describe("a starter sketch on each board", () => {
  it.each(files)("%s runs its starter", (board, file) => {
    const doc = JSON.parse(readFileSync(file, "utf8")) as Project;
    expect(boardIdOf(doc.boards[0]!.definition.ref)).toBe(board);
    const source = doc.sources.find((s) => s.role === "firmware")!;
    const language = INTERP_LANGUAGE[source.language as keyof typeof INTERP_LANGUAGE];
    const engine = createInterpEngine({ id: "mcu", board: board as never, language: language ?? "arduino", seed: 1 });
    const events: Omit<SimEvent, "seq">[] = [];
    const sink: EventSink = { emit: (e) => events.push(e) };
    engine.attach(sink);
    const result = engine.load({ kind: "source", language: source.language as never, files: [{ path: source.path, text: source.content }], entry: source.path });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
    for (let t = 1; t <= 1200; t++) engine.advanceTo(t * MS, BUDGET);
    // A Verilog design answers on its ports; the sketches and scripts drive a pin or print.
    if (language === "verilog") expect(Object.keys(engine.run.snapshot().ports ?? {})).not.toHaveLength(0);
    else expect(events.length + engine.serialLog.length).toBeGreaterThan(0);
  });
});
