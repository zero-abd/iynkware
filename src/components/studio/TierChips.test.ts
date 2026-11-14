import { describe, expect, it } from "vitest";
import messages from "@/i18n/messages/en/fidelity.json";
import { createTranslator } from "@/i18n/translate";
import { findBanned } from "@/sim/registry/tiers";
import type { ValidationRecord } from "@/sim/registry/types";
import { pickValidation, validationLine } from "./TierChips";

const t = createTranslator("en", messages);

function record(over: Partial<ValidationRecord>): ValidationRecord {
  return {
    id: "v",
    kind: "oracle",
    oracle: { name: "ngspice", version: "42" },
    dataset: "d",
    result: { n: 12, passed: 12, metric: "volts", worst: 2, unit: "%" },
    date: "2026-10-01",
    engineVersion: "1.0.0",
    status: "pass",
    ...over,
  };
}

describe("validationLine", () => {
  it("says so when there is no record", () => {
    expect(validationLine(undefined, t)).toBe("Not checked against a reference.");
  });

  it("reports the oracle result", () => {
    expect(validationLine(record({}), t)).toBe("Within 2 percent of ngspice on 12 circuits (2026-10-01)");
  });

  it("reports a bench run", () => {
    expect(validationLine(record({ kind: "bench" }), t)).toBe("Measured on hardware: 12 circuits, error table");
  });

  it("picks the newest passing record and skips the rest", () => {
    const older = record({ id: "a", date: "2026-01-01" });
    const newer = record({ id: "b", kind: "analytic", date: "2026-09-01" });
    const failed = record({ id: "c", date: "2026-10-20", status: "fail" });
    const selfCheck = record({ id: "d", kind: "self-consistency", date: "2026-10-25" });
    expect(pickValidation([older, failed, newer, selfCheck])?.id).toBe("b");
    expect(pickValidation([failed, selfCheck])).toBeUndefined();
  });
});

describe("fidelity copy", () => {
  it("has no banned word in the English text", () => {
    expect(findBanned(JSON.stringify(messages))).toEqual([]);
  });
});
