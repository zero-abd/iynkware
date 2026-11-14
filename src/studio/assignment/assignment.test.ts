// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateValue } from "@/project/validate";
import { assignmentId, checkAssignment, lockedViolations, parseInfo, readAssignment, resolvePart, runMsFor, startAssignment } from "./assignment";
import { BLINK_CHECKS, IDS, blinkAssignment, teacherBlink } from "./fixture.testing";
import { STARTER_MODES } from "./starter";
import { ASSIGNMENT_EXT, type AssignmentInfo } from "./types";

describe("an assignment built from a project", () => {
  it("is a valid project that carries its checks and nothing of the teacher's guide or tests", () => {
    const a = blinkAssignment();
    expect(validateValue(a).ok).toBe(true);
    expect(checkAssignment(a).ok).toBe(true);
    expect(a.tests).toEqual([]);
    expect(a.guide).toBeUndefined();
    expect(a.meta.title).toBe("Blink an LED");
    expect(a.ext[ASSIGNMENT_EXT].checks).toEqual(BLINK_CHECKS);
  });

  it.each(STARTER_MODES)("hands the student a valid starter in the %s form", (mode) => {
    const a = blinkAssignment({ mode });
    expect(checkAssignment(a).ok).toBe(true);
    if (mode === "board-only") expect(a.components.map((c) => c.id)).toEqual(["cmp_bb"]);
    if (mode !== "as-is") expect(a.nets.filter((n) => n.connections.some((c) => c.c === "brd_main") && n.connections.length > 1)).toEqual([]);
    expect(a.views.flatMap((v) => v.wires)).toEqual(mode === "as-is" ? teacherBlink().views.flatMap((v) => v.wires) : []);
  });

  it("locks the parts the teacher names and ignores an id that is not there", () => {
    const a = blinkAssignment({ locked: ["cmp_led1", "cmp_missing"] });
    expect(a.components.filter((c) => c.locked).map((c) => c.id)).toEqual(["cmp_led1"]);
  });

  it("blanks the code of the firmware and leaves the rest of the project alone", () => {
    const a = blinkAssignment({ blankCode: true });
    expect(a.sources[0]!.content).toBe("void setup() {\n}\n\nvoid loop() {\n}\n");
    expect(a.sources[0]!.id).toBe(teacherBlink().sources[0]!.id);
  });

  it("does not touch the teacher's project", () => {
    const source = teacherBlink();
    const before = JSON.stringify(source);
    blinkAssignment({ mode: "board-only", locked: ["cmp_bb"], blankCode: true });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("names itself by what grades it: the same title, instructions and checks give the same id", () => {
    const info = blinkAssignment().ext[ASSIGNMENT_EXT];
    expect(assignmentId(info)).toBe(info.id);
    expect(assignmentId({ ...info, instructions: "Something else." })).not.toBe(info.id);
    expect(blinkAssignment({ mode: "board-only" }).ext[ASSIGNMENT_EXT].id).toBe(info.id);
  });
});

describe("the student's copy", () => {
  it("is a new project of its own that keeps the assignment and the locks", () => {
    const a = blinkAssignment({ locked: ["cmp_led1"] });
    const mine = startAssignment(a, { ...IDS, id: "prj_student" });
    expect(mine.id).toBe("prj_student");
    expect(readAssignment(mine)).toEqual(a.ext[ASSIGNMENT_EXT]);
    expect(mine.components.find((c) => c.id === "cmp_led1")?.locked).toBe(true);
    expect(mine.history.ops).toEqual([]);
  });
});

describe("reading an assignment", () => {
  const info = (): AssignmentInfo => structuredClone(blinkAssignment().ext[ASSIGNMENT_EXT]);

  it("finds none in a project without one", () => {
    expect(readAssignment(teacherBlink())).toBeNull();
  });

  it.each([
    ["an unknown kind of check", (i: AssignmentInfo) => (i.checks[0] = { id: "x", kind: "mystery" } as never)],
    ["two checks with one id", (i: AssignmentInfo) => (i.checks[1]!.id = i.checks[0]!.id)],
    ["a range that runs backwards", (i: AssignmentInfo) => ((i.checks[1] as { amps: number[] }).amps = [1, 0])],
    ["a frequency window longer than the time before it", (i: AssignmentInfo) => ((i.checks[3] as { windowMs: number }).windowMs = 9000)],
    ["a part with no name", (i: AssignmentInfo) => ((i.checks[2] as { part: string }).part = "")],
    ["a hint that is far too long", (i: AssignmentInfo) => (i.checks[0]!.hint = "x".repeat(301))],
    ["a part reference that is not one", (i: AssignmentInfo) => ((i.checks[1] as { refdes: string }).refdes = "1 bad")],
    ["a definition that is not one", (i: AssignmentInfo) => ((i.checks[1] as { ref: string }).ref = "Not A Ref")],
    ["an empty title", (i: AssignmentInfo) => (i.title = "  ")],
    ["more than forty checks", (i: AssignmentInfo) => (i.checks = Array.from({ length: 41 }, (_, n) => ({ id: `n${n}`, kind: "no-errors" as const })))],
  ])("refuses %s", (_name, damage) => {
    const bad = info();
    damage(bad);
    expect(parseInfo(bad).ok).toBe(false);
  });

  it("refuses a project whose id does not match what it holds, so a hand edited check is caught", () => {
    const a = blinkAssignment();
    a.ext[ASSIGNMENT_EXT].checks[1] = { ...BLINK_CHECKS[1]!, atMs: 300 } as never;
    expect(checkAssignment(a).ok).toBe(false);
  });

  it("hands the project's own kinds of check to the schema", () => {
    const a = blinkAssignment();
    const info = a.ext[ASSIGNMENT_EXT];
    info.checks[0] = { ...info.checks[0]!, minCycles: -1 } as never;
    info.id = assignmentId(info);
    expect(checkAssignment(a).ok).toBe(false);
  });
});

describe("what a submission may not change", () => {
  it("lists a locked part that was removed, unlocked or swapped", () => {
    const a = blinkAssignment({ locked: ["cmp_led1", "cmp_res1"] });
    const mine = startAssignment(a, IDS);
    expect(lockedViolations(a, mine)).toEqual([]);
    const lost = { ...mine, components: mine.components.filter((c) => c.id !== "cmp_led1").map((c) => (c.id === "cmp_res1" ? { ...c, locked: undefined } : c)) };
    expect(lockedViolations(a, lost)).toEqual(["cmp_led1", "cmp_res1"]);
  });
});

describe("how long a run has to be", () => {
  it("covers the latest instant a check reads, and never more than a minute", () => {
    expect(runMsFor(BLINK_CHECKS, 1000)).toBe(8000);
    expect(runMsFor([], 8500)).toBe(8500);
    expect(runMsFor([{ id: "a", kind: "part-amps", part: "p", amps: [0, 1], atMs: 59_000 }], 1000)).toBe(59_000);
    expect(runMsFor([{ id: "a", kind: "runs", label: "", minMs: 120_000 }], 1000)).toBe(60_000);
  });
});

describe("finding the part a check reads", () => {
  const project = teacherBlink();

  it("takes the part with the id, and otherwise the only part of the definition", () => {
    expect(resolvePart(project, { part: "cmp_led1" })).toBe("cmp_led1");
    expect(resolvePart(project, { part: "cmp_new", ref: "core.led-5mm" })).toBe("cmp_led1");
    expect(resolvePart(project, { part: "cmp_led1", ref: "core.resistor" })).toBe("cmp_led1");
  });

  it("finds nothing when the id is gone and the definition is missing, unnamed or on two parts", () => {
    expect(resolvePart(project, { part: "cmp_new" })).toBeNull();
    expect(resolvePart(project, { part: "cmp_new", ref: "core.buzzer" })).toBeNull();
    const two = { ...project, components: [...project.components, { ...project.components.find((c) => c.id === "cmp_led1")!, id: "cmp_led2" }] };
    expect(resolvePart(two, { part: "cmp_new", ref: "core.led-5mm" })).toBeNull();
  });
});
