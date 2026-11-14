import { describe, expect, it } from "vitest";
import { STARTERS } from "@/studio/starters";
import { DEFAULT_BOARD, projectFromIno } from "./Home";

const sketch = { title: "sketch", sources: [{ path: "main.ino", text: "void setup() {}\nvoid loop() {}\n", role: "firmware" as const }], entry: "main.ino", loss: [] };
const NOW = "2026-11-11T00:00:00.000Z";

describe("a sketch imported onto a board", () => {
  for (const { board } of STARTERS) {
    it(`opens the ${board} starter with the sketch in its firmware`, async () => {
      const project = await projectFromIno({ ...sketch, board }, "en", NOW);
      const firmware = project.boards[0]!.firmware!;
      const entry = project.sources.find((source) => source.id === firmware.entry)!;
      expect(entry.content).toBe(sketch.sources[0]!.text);
      expect(project.meta.title).toBe("sketch");
    });
  }

  it("opens the Uno on a blank project", async () => {
    const project = await projectFromIno({ ...sketch, board: DEFAULT_BOARD }, "en", NOW);
    expect(project.boards).toHaveLength(1);
  });
});
