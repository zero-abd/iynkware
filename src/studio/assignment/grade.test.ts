// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Project } from "@/project/generated/types";
import { startAssignment } from "./assignment";
import { BLINK_CHECKS, CLOCK, IDS, blinkAssignment } from "./fixture.testing";
import { frequencyOf, gradeProject, scoreOf } from "./grade";
import type { AssignmentCheck } from "./types";

const byId = (verdicts: { id: string; ok: boolean }[]) => Object.fromEntries(verdicts.map((v) => [v.id, v.ok]));

const wave = (hz: number, ms: number, stepMs: number, low = 0, high = 5) => {
  const tMs: number[] = [];
  const volts: number[] = [];
  for (let t = 0; t <= ms; t += stepMs) {
    tMs.push(t);
    volts.push(Math.floor(t * hz * 2 / 1000) % 2 === 0 ? high : low);
  }
  return { tMs, volts };
};

describe("the frequency of a signal", () => {
  it("is found from the rising edges", () => {
    expect(frequencyOf(wave(1000, 100, 0.05))!.hz).toBeCloseTo(1000, -1);
    expect(frequencyOf(wave(1, 4000, 1))!.hz).toBeCloseTo(1, 1);
  });

  it("counts a noisy edge once", () => {
    const s = wave(10, 1000, 0.5);
    const noisy = { tMs: s.tMs, volts: s.volts.map((v, i) => v + (i % 2 === 0 ? 0.2 : -0.2)) };
    expect(frequencyOf(noisy)!.hz).toBeCloseTo(10, 0);
  });

  it("is zero for a line that does not move and for one that moves once", () => {
    expect(frequencyOf({ tMs: [0, 1, 2], volts: [3, 3, 3] })).toMatchObject({ hz: 0 });
    expect(frequencyOf({ tMs: [0, 1, 2, 3], volts: [0, 0, 5, 5] })).toMatchObject({ hz: 0 });
    expect(frequencyOf({ tMs: [0, 1, 2], volts: [0, 0.05, 0] })).toMatchObject({ hz: 0 });
  });

  it("is nothing when there are no samples", () => {
    expect(frequencyOf({ tMs: [], volts: [] })).toBeNull();
  });
});

describe("grading the Blink circuit", () => {
  it("passes every check on the teacher's own circuit, and says what it read", () => {
    const verdicts = gradeProject(blinkAssignment(), BLINK_CHECKS, CLOCK);
    expect(byId(verdicts)).toEqual({ toggles: true, amps: true, volts: true, freq: true, clean: true });
    expect(verdicts.find((v) => v.id === "volts")!.detail).toMatch(/^2\.\d+ V$/);
    expect(verdicts.find((v) => v.id === "amps")!.detail).toMatch(/^0\.01\d* A$/);
    expect(verdicts.find((v) => v.id === "freq")!.detail).toBe("1 Hz");
    expect(scoreOf(verdicts)).toEqual({ passed: 5, total: 5 });
  });

  it("gives the same verdicts twice", () => {
    const a = blinkAssignment();
    expect(gradeProject(a, BLINK_CHECKS, CLOCK)).toEqual(gradeProject(a, BLINK_CHECKS, CLOCK));
  });

  it("fails what the student has not done yet: no code, no wires", () => {
    const start = startAssignment(blinkAssignment({ mode: "board-only", blankCode: true }), IDS);
    expect(byId(gradeProject(start, BLINK_CHECKS, CLOCK))).toEqual({ toggles: false, amps: false, volts: false, freq: false, clean: true });
  });

  it("fails the code checks when the timing is wrong and the circuit checks when the LED has no current", () => {
    const slow = blinkAssignment();
    slow.sources[0]!.content = slow.sources[0]!.content.replaceAll("500", "100");
    expect(byId(gradeProject(slow, BLINK_CHECKS, CLOCK))).toMatchObject({ toggles: false, freq: false });
    const unwired = blinkAssignment({ mode: "unwired" });
    expect(byId(gradeProject(unwired, BLINK_CHECKS, CLOCK))).toMatchObject({ toggles: true, amps: false, volts: false });
  });

  it("reports a burnt LED as an error, with the number of problems", () => {
    const hot = blinkAssignment();
    hot.components = hot.components.map((c) => (c.id === "cmp_res1" ? { ...c, params: { ohms: 1 } } : c));
    const clean = gradeProject(hot, [{ id: "clean", kind: "no-errors" }], CLOCK)[0]!;
    expect(clean.ok).toBe(false);
    expect(Number(clean.detail)).toBeGreaterThan(0);
  });

  it("reads each value at its own instant", () => {
    const early: AssignmentCheck = { id: "early", kind: "pin-volts", part: "cmp_led1", pin: "A", volts: [1.5, 3.5], atMs: 100 };
    const off: AssignmentCheck = { id: "off", kind: "pin-volts", part: "cmp_led1", pin: "A", volts: [-0.1, 0.1], atMs: 700 };
    expect(byId(gradeProject(blinkAssignment(), [early, off], CLOCK))).toEqual({ early: true, off: true });
  });

  it("reads the student's own LED, with an id of its own, through the definition the check names", () => {
    const checks = BLINK_CHECKS.filter((c) => c.id === "amps" || c.id === "volts").map((c) => ({ ...c, part: "cmp_other" }) as AssignmentCheck);
    expect(byId(gradeProject(blinkAssignment(), checks, CLOCK))).toEqual({ amps: true, volts: true });
    expect(byId(gradeProject(blinkAssignment(), checks.map((c) => ({ ...c, ref: undefined }) as AssignmentCheck), CLOCK))).toEqual({ amps: false, volts: false });
  });

  it("fails a check that names a pin or part that is not there, and does not throw", () => {
    const checks: AssignmentCheck[] = [
      { id: "a", kind: "pin-volts", part: "cmp_missing", pin: "A", volts: [0, 5], atMs: 100 },
      { id: "b", kind: "part-amps", part: "cmp_missing", amps: [0, 1], atMs: 100 },
      { id: "c", kind: "pin-frequency", part: "brd_main", pin: "NOPE", hz: [0, 10], atMs: 1000, windowMs: 500 },
    ];
    expect(gradeProject(blinkAssignment(), checks, CLOCK).map((v) => v.ok)).toEqual([false, false, false]);
  });

  it("gives up on a run that passes its wall clock, and says so", () => {
    let tick = 0;
    const verdicts = gradeProject(blinkAssignment(), [BLINK_CHECKS[3]!], { budgetMs: 5, now: () => (tick += 10) });
    expect(verdicts).toEqual([{ id: "freq", ok: false, detail: "limit" }]);
  });

  it("answers a check that cannot run, with no board or no code, instead of throwing", () => {
    const noCode = { ...blinkAssignment(), sources: [] } as Project;
    expect(gradeProject(noCode, BLINK_CHECKS, CLOCK).filter((v) => v.ok).map((v) => v.id)).toEqual(["clean"]);
  });
});
