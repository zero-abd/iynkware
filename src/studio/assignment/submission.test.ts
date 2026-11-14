// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Project } from "@/project/generated/types";
import { applyDetached } from "@/project/session";
import { startAssignment } from "./assignment";
import { BLINK_CHECKS, CLOCK, IDS, blinkAssignment, parts } from "./fixture.testing";
import { gradeProject } from "./grade";
import { buildSubmission, readSubmission, submissionCode, submissionFile } from "./submission";
import type { Submission } from "./types";
import { gradeSubmission, type Grader } from "./verify";

const grader: Grader = async (project, checks) => gradeProject(project, checks, CLOCK);
const AT = "2026-11-11T09:30:00.000Z";

const assignment = blinkAssignment({ locked: ["cmp_led1"] });
const info = assignment.ext["x-iynk-assignment"];

/** What the student's device would hand in for `project`, with the results it found. */
async function handIn(project: Project, student = "Ada Lovelace") {
  return buildSubmission(project, info, { student, at: AT, results: await grader(project, info.checks) }, parts);
}

const open = async (text: string) => {
  const read = await readSubmission(text, parts);
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
};

describe("a submission", () => {
  it("holds the project in its compact form and a hash of everything in it", async () => {
    const s = await handIn(startAssignment(assignment, IDS));
    expect(s.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(s).length).toBeLessThan(JSON.stringify(startAssignment(assignment, IDS)).length / 2);
    expect(s.assignment).toBe(info.id);
    expect(s.student).toBe("Ada Lovelace");
  });

  it("comes back from a file and from a pasted code, hash intact", async () => {
    const s = await handIn(startAssignment(assignment, IDS));
    for (const text of [submissionFile(s), await submissionCode(s)]) {
      const read = await open(text);
      expect(read.hashOk).toBe(true);
      expect(read.submission.student).toBe("Ada Lovelace");
      expect(read.submission.results).toEqual(s.results);
      expect(read.submission.project.sources).toEqual(s.project.sources);
      expect(read.submission.project.dependencies.components.length).toBeGreaterThan(0);
    }
  });

  it("is refused when it is not one: other JSON, other codes, a missing student", async () => {
    const s = await handIn(startAssignment(assignment, IDS));
    expect((await readSubmission("{}", parts)).ok).toBe(false);
    expect((await readSubmission("{not json", parts)).ok).toBe(false);
    expect((await readSubmission("hello", parts)).ok).toBe(false);
    expect((await readSubmission(JSON.stringify({ ...s, student: "" }), parts)).ok).toBe(false);
    expect((await readSubmission(JSON.stringify({ ...s, project: { nope: true } }), parts)).ok).toBe(false);
    expect((await readSubmission(JSON.stringify({ ...s, project: "x" }), parts)).ok).toBe(false);
  });
});

describe("the teacher's view of a submission", () => {
  it("grades an honest one by running the checks again", async () => {
    const mine = startAssignment(assignment, IDS);
    const graded = await gradeSubmission(assignment, await open(submissionFile(await handIn(mine))), grader);
    expect(graded).toMatchObject({ student: "Ada Lovelace", assignmentOk: true, hashOk: true, lockedLost: [], mismatched: [], passed: 5, total: 5 });
    expect(graded.verdicts.map((v) => v.id)).toEqual(BLINK_CHECKS.map((c) => c.id));
  });

  it("catches a student who edited the project after the checks ran: the claim says pass, the re-run fails", async () => {
    const mine = startAssignment(assignment, IDS);
    const honest = await handIn(mine);
    const broken = { ...mine, sources: mine.sources.map((s) => ({ ...s, content: s.content.replaceAll("500", "100") })) };
    const forged: Submission = { ...(await handIn(broken)), results: honest.results };
    const graded = await gradeSubmission(assignment, await open(submissionFile(forged)), grader);
    expect(graded.hashOk).toBe(false);
    expect(graded.claimed.every((r) => r.ok)).toBe(true);
    expect(graded.mismatched).toEqual(expect.arrayContaining(["toggles", "freq"]));
    expect(graded.mismatched).not.toContain("clean");
    expect(graded.passed).toBeLessThan(5);
  });

  it("catches a student who edited the results and fixed the hash: the re-run still decides", async () => {
    const mine = startAssignment(assignment, IDS);
    const broken = { ...mine, sources: mine.sources.map((s) => ({ ...s, content: "void setup() {}\nvoid loop() {}\n" })) };
    const lie = buildSubmission(broken, info, { student: "Ada", at: AT, results: info.checks.map((c) => ({ id: c.id, ok: true })) }, parts);
    const graded = await gradeSubmission(assignment, await open(submissionFile(lie)), grader);
    expect(graded.hashOk).toBe(true);
    expect(graded.claimed.every((r) => r.ok)).toBe(true);
    expect(graded.verdicts.find((v) => v.id === "toggles")!.ok).toBe(false);
    expect(graded.mismatched).toContain("toggles");
    expect(graded.passed).toBeLessThan(5);
  });

  it("does not take the checks from the submission: a student who weakens them gains nothing", async () => {
    const mine = startAssignment(assignment, IDS);
    const broken = { ...mine, sources: mine.sources.map((s) => ({ ...s, content: "void setup() {}\nvoid loop() {}\n" })) };
    const weak = { ...broken, ext: { "x-iynk-assignment": { ...info, checks: [] } } };
    const sub = await handIn(weak as Project);
    const graded = await gradeSubmission(assignment, await open(submissionFile(sub)), grader);
    expect(graded.total).toBe(5);
    expect(graded.passed).toBeLessThan(5);
  });

  it("flags a locked part that is gone", async () => {
    const mine = startAssignment(assignment, IDS);
    const removed = applyDetached(mine, [{ k: "component.remove", id: "cmp_led1" }], { author: { actor: "usr_local", kind: "user" }, at: AT });
    if (!removed.ok) throw new Error(removed.reject.message);
    const graded = await gradeSubmission(assignment, await open(submissionFile(await handIn(removed.state))), grader);
    expect(graded.lockedLost).toEqual(["cmp_led1"]);
  });

  it("does not grade a submission for another assignment", async () => {
    const other = blinkAssignment({ title: "A different title" });
    const sub = buildSubmission(startAssignment(other, IDS), other.ext["x-iynk-assignment"], { student: "Ada", at: AT, results: [] }, parts);
    const graded = await gradeSubmission(assignment, await open(submissionFile(sub)), grader);
    expect(graded).toMatchObject({ assignmentOk: false, verdicts: [], passed: 0, total: 5 });
  });
});
