import { describe, expect, it } from "vitest";
import { z } from "./index.ts";

describe("lib/zod", () => {
  it("turns zod's code generation off", () => {
    expect(z.config().jitless).toBe(true);
  });
});
