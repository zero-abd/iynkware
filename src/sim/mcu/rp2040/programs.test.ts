// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixtures } from "./programs.testing.ts";

describe("the committed UF2 fixtures", () => {
  it("are what scripts/gen-rp2040-fixtures.mjs builds from the Thumb programs", () => {
    for (const [name, bytes] of Object.entries(fixtures())) {
      const committed = readFileSync(join(process.cwd(), "src/sim/mcu/rp2040/fixtures", name));
      expect(Buffer.compare(committed, bytes), name).toBe(0);
    }
  });
});
