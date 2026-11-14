import { describe, expect, it } from "vitest";
import assignment from "@/i18n/messages/en/assignment.json";
import { createTranslator } from "@/i18n/translate";
import { teacherBlink } from "@/studio/assignment/fixture.testing";
import type { AssignmentCheck } from "@/studio/assignment/types";
import { checkText, detailText, hintText, partNameIn } from "./describe";

const t = createTranslator("en", assignment);
const part = partNameIn(teacherBlink());

const volts: AssignmentCheck = { id: "v", kind: "pin-volts", part: "cmp_gone", refdes: "LED9", ref: "core.led-5mm", pin: "A", volts: [1.5, 3.5], atMs: 200 };

describe("what a check says", () => {
  it("names the part as this project calls it, the teacher's name when it is missing", () => {
    expect(checkText(t, volts, part)).toBe("LED1 pin A reads 1.5–3.5 V at 200 ms");
    expect(checkText(t, { ...volts, ref: undefined }, part)).toBe("LED9 pin A reads 1.5–3.5 V at 200 ms");
  });

  it("says only that a hidden check is hidden", () => {
    expect(checkText(t, { ...volts, visibility: "hidden" }, part)).toBe(assignment.describe.hidden);
  });

  it("gives the teacher's hint, else the one of its kind", () => {
    expect(hintText(t, { ...volts, hint: "Look at R1." })).toBe("Look at R1.");
    expect(hintText(t, volts)).toBe(assignment.hint["pin-volts"]);
  });

  it("turns a grader code or an error count into words and leaves a measurement alone", () => {
    expect(detailText(t, volts, "no-reading")).toBe(assignment.detail["no-reading"]);
    expect(detailText(t, volts, "2.01 V")).toBe("2.01 V");
    expect(detailText(t, { id: "n", kind: "no-errors" }, "3")).toBe("3 errors");
    expect(detailText(t, volts, undefined)).toBeUndefined();
  });
});
