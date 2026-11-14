import { describe, expect, it } from "vitest";
import { withUnit } from "./format.ts";

describe("withUnit", () => {
  it("keeps three significant digits and the prefix that puts the value between 1 and 999", () => {
    expect(withUnit(3.2123, "V")).toBe("3.21 V");
    expect(withUnit(0.0123456, "A")).toBe("12.3 mA");
    expect(withUnit(-0.00004, "A")).toBe("-40 µA");
  });

  it("writes a value that is zero for practical purposes as 0", () => {
    expect(withUnit(1e-12, "A")).toBe("0 A");
  });
});
