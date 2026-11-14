// @vitest-environment node
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { budgetMs } from "../core/perf.testing.ts";
import type { Io } from "./io";
import { main } from "./main";

const SECOND = 1000;

describe("iynk check speed", () => {
  it("checks every Studio starter in under 60 seconds", async () => {
    const lines: string[] = [];
    const io: Io = { out: (l) => void lines.push(l), err: (l) => void lines.push(l), cwd: process.cwd(), now: () => 0, env: { IYNK_LANG: "en" } };
    const start = performance.now();
    await main(["check", "src/studio/starters"], io);
    const took = performance.now() - start;
    const starters = readdirSync("src/studio/starters").filter((f) => f.endsWith(".project.json")).length;
    expect(lines.at(-1)).toContain(` of ${starters} projects passed`);
    expect(took).toBeLessThan(budgetMs(60 * SECOND));
  });
});
