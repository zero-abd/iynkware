// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeIynk } from "@/export/iynk";
import { writeIynkz } from "@/export/iynkz";
import { startAssignment } from "@/studio/assignment/assignment";
import { CLOCK, IDS, blinkAssignment, parts } from "@/studio/assignment/fixture.testing";
import { gradeProject } from "@/studio/assignment/grade";
import { buildSubmission, submissionFile } from "@/studio/assignment/submission";
import { ASSIGNMENT_EXT } from "@/studio/assignment/types";
import type { Project } from "@/project/generated/types";
import type { Io } from "./io";
import { main } from "./main";

const ROOT = process.cwd();
const STARTERS = "src/studio/starters";
const BLINK = JSON.parse(readFileSync(join(ROOT, STARTERS, "blink.project.json"), "utf8")) as Project;

const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);

let work: string;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "iynk-cli-test-"));
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

interface Result {
  code: number;
  out: string;
  err: string;
}

async function iynk(args: string[], cwd = ROOT, env: Record<string, string> = {}): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => void out.push(l), err: (l) => void err.push(l), cwd, now: () => NOW, env: { IYNK_LANG: "en", ...env } };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function project(edit: (doc: Project) => void): Project {
  const doc = structuredClone(BLINK);
  edit(doc);
  return doc;
}

function save(name: string, doc: Project): string {
  const file = join(work, name);
  writeFileSync(file, writeIynk(doc));
  return file;
}

const withoutResistor = project((doc) => {
  const d13 = doc.nets.find((n) => n.id === "net_d13")!;
  d13.connections = [{ c: "brd_main", p: "D13" }, { c: "cmp_led1", p: "A" }];
  doc.nets = doc.nets.filter((n) => n.id !== "net_led1a_res1p2");
});

const tooFast = project((doc) => {
  doc.sources[0]!.content = doc.sources[0]!.content.replaceAll("delay(500)", "delay(5)");
});

// Only a warning is left: the pin is never set up, and no check of the project is there to fail.
const withoutPinMode = project((doc) => {
  doc.sources[0]!.content = doc.sources[0]!.content.replace("  pinMode(LED_PIN, OUTPUT);\n", "");
  doc.tests = [];
});

describe("iynk check on the starters", () => {
  it("passes every starter", async () => {
    const { code, out } = await iynk(["check", STARTERS, "--json"]);
    const report = JSON.parse(out) as { summary: { projects: number }; projects: { file: string; status: string }[] };
    const files = readdirSync(join(ROOT, STARTERS)).filter((f) => f.endsWith(".project.json"));
    expect(report.summary.projects).toBe(files.length);
    expect(report.projects.filter((p) => p.status !== "pass").map((p) => p.file)).toEqual([]);
    expect(code).toBe(0);
  });

  it("prints a readable report", async () => {
    const { code, out } = await iynk(["check", `${STARTERS}/blink.project.json`]);
    expect(code).toBe(0);
    expect(out).toContain("PASS  src/studio/starters/blink.project.json  (Blink an LED)");
    expect(out).toContain("Project checks (main): 3 of 3 passed");
    expect(out).toContain("1 of 1 project passed");
  });

  it("writes the same report in another language", async () => {
    const { out } = await iynk(["check", `${STARTERS}/blink.project.json`, "--lang", "de"]);
    expect(out).toContain("BESTANDEN  src/studio/starters/blink.project.json");
    expect(out).toContain("3 von 3 bestanden");
  });
});

describe("iynk check on a broken project", () => {
  it("fails with the circuit finding and says where", async () => {
    const file = save("no-resistor.iynk", withoutResistor);
    const { code, out } = await iynk(["check", file, "--json"]);
    const report = JSON.parse(out) as { projects: { findings: { causeId: string; severity: string; targets: { id: string }[] }[] }[] };
    expect(code).toBe(1);
    expect(report.projects[0]!.findings).toContainEqual(expect.objectContaining({ causeId: "led-no-series-resistor", severity: "error", targets: expect.arrayContaining([expect.objectContaining({ id: "cmp_led1" })]) }));
  });

  it("fails with the project check that did not hold", async () => {
    const file = save("too-fast.iynk", tooFast);
    const { code, out } = await iynk(["check", file]);
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL {2}.*too-fast\.iynk/);
    expect(out).toMatch(/FAIL {2}D13 turns on and off at least twice/);
    expect(out).toContain("Project checks (main): 2 of 3 passed");
  });

  it("writes a JUnit file with a failure for it", async () => {
    const file = save("junit.iynk", tooFast);
    const target = join(work, "reports", "junit.xml");
    const { code } = await iynk(["check", file, "--junit", target]);
    const xml = readFileSync(target, "utf8");
    expect(code).toBe(1);
    expect(xml).toContain('<testsuites name="iynk" tests="5" failures="1" errors="0" skipped="0">');
    expect(xml).toMatch(/<testcase classname="[^"]*junit\.iynk" name="main: D13 turns on and off[^"]*">\s*<failure type="pin-toggles"/);
  });

  it("fails a warning only with --strict", async () => {
    const file = save("warning.iynk", withoutPinMode);
    const lenient = await iynk(["check", file]);
    expect(lenient.out).toContain("1 warning");
    expect(lenient.code).toBe(0);
    expect((await iynk(["check", file, "--strict"])).code).toBe(1);
  });

  it("reports a file that is no project instead of stopping", async () => {
    const bad = join(work, "bad.iynk");
    writeFileSync(bad, "not json");
    const good = save("good.iynk", BLINK);
    const { code, out } = await iynk(["check", bad, good]);
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL {2}.*bad\.iynk/);
    expect(out).toMatch(/PASS {2}.*good\.iynk/);
    expect(out).toContain("1 of 2 projects passed");
  });

  it("reads a Wokwi project through the importer and checks the circuit it makes", async () => {
    const folder = join(work, "wokwi");
    mkdirSync(folder, { recursive: true });
    for (const name of ["diagram.json", "sketch.ino"]) writeFileSync(join(folder, name), readFileSync(join(ROOT, "src/export/wokwi/fixtures/blink", name)));
    const { out } = await iynk(["check", "wokwi/diagram.json"], work);
    expect(out).toContain("Circuit rules");
    expect(out).not.toContain("not a valid project");
    const folderRun = await iynk(["check", "wokwi", "--json"], work);
    expect((JSON.parse(folderRun.out) as { summary: { projects: number } }).summary.projects).toBe(1);
  });

  it("says why a Wokwi diagram cannot be read", async () => {
    const folder = join(work, "wokwi-bad");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "diagram.json"), "{");
    const { code, out } = await iynk(["check", "wokwi-bad/diagram.json"], work);
    expect(code).toBe(1);
    expect(out).toContain("is not a valid project");
  });

  it("lists the fix under a finding", async () => {
    const { out } = await iynk(["check", save("no-resistor.iynk", withoutResistor), "--json"]);
    const report = JSON.parse(out) as { projects: { findings: { ruleId: string; fixes: { message: string; safe: boolean }[] }[] }[] };
    const led = report.projects[0]!.findings.find((f) => f.ruleId.includes("led-series"));
    expect(led?.fixes.length).toBeGreaterThan(0);
    expect(led?.fixes[0]!.message).toMatch(/resistor/i);
    const text = await iynk(["check", save("no-resistor.iynk", withoutResistor)]);
    expect(text.out).toContain("fix:");
  });
});

describe("iynk check on a submission", () => {
  const assignment = blinkAssignment({ locked: ["cmp_led1"] });
  const info = assignment.ext[ASSIGNMENT_EXT];

  async function submit(name: string, doc: Project, student = "Ada Lovelace"): Promise<string> {
    const results = gradeProject(doc, info.checks, CLOCK);
    const file = join(work, name);
    writeFileSync(file, submissionFile(buildSubmission(doc, info, { student, at: "2026-11-11T09:30:00.000Z", results }, parts)));
    return file;
  }

  const assignmentFile = () => save("assignment.iynk", assignment);

  it("grades a submission that meets every check", async () => {
    const good = await submit("good.iynk-submission.json", startAssignment(assignment, IDS));
    // The starting project is the teacher's circuit, so it is a full blink.
    const { code, out } = await iynk(["check", "--assignment", assignmentFile(), good]);
    expect(out).toContain("Ada Lovelace");
    expect(out).toContain(`${info.checks.length} of ${info.checks.length} passed`);
    expect(code).toBe(0);
  }, 120_000);

  it("fails a submission whose code is too fast and says which check", async () => {
    const fast = structuredClone(startAssignment(assignment, IDS));
    fast.sources[0]!.content = fast.sources[0]!.content.replaceAll("delay(500)", "delay(5)");
    const file = await submit("fast.iynk-submission.json", fast);
    const { code, out } = await iynk(["check", "--assignment", assignmentFile(), file, "--json"]);
    const report = JSON.parse(out) as { projects: { status: string; grade: { passed: number; total: number; lines: { id: string; ok: boolean }[] } }[] };
    expect(code).toBe(1);
    expect(report.projects[0]!.status).toBe("fail");
    expect(report.projects[0]!.grade.lines.find((l) => l.id === "toggles")?.ok).toBe(false);
  }, 120_000);

  it("fails a submission that was edited after it was made", async () => {
    const file = await submit("edited.iynk-submission.json", startAssignment(assignment, IDS));
    writeFileSync(file, readFileSync(file, "utf8").replace("Ada Lovelace", "Grace Hopper"));
    const { code, out } = await iynk(["check", "--assignment", assignmentFile(), file]);
    expect(code).toBe(1);
    expect(out).toContain("changed after the student made it");
  }, 120_000);

  it("fails a submission with no assignment to grade it against, and exits 2 for a file that is not an assignment", async () => {
    const file = await submit("lonely.iynk-submission.json", startAssignment(assignment, IDS));
    const alone = await iynk(["check", file]);
    expect(alone.code).toBe(1);
    expect(alone.out).toContain("--assignment");
    const wrong = await iynk(["check", "--assignment", save("plain.iynk", BLINK), file]);
    expect(wrong.code).toBe(2);
    expect(wrong.err).toContain("is not an assignment");
  }, 120_000);
});

describe("iynk check on files", () => {
  it("reads .iynkz containers and globs", async () => {
    mkdirSync(join(work, "glob"), { recursive: true });
    writeFileSync(join(work, "glob", "a.iynkz"), writeIynkz(BLINK, []));
    writeFileSync(join(work, "glob", "b.iynk"), writeIynk(BLINK));
    const { code, out } = await iynk(["check", "glob/*"], work);
    expect(code).toBe(0);
    expect(out).toContain("2 of 2 projects passed");
  });

  it("uses a folder as every project file inside it", async () => {
    const { out } = await iynk(["check", "glob"], work);
    expect(out).toContain("2 of 2 projects passed");
  });

  it("exits 2 when nothing matches", async () => {
    const { code, err } = await iynk(["check", "nothing/*.iynk"], work);
    expect(code).toBe(2);
    expect(err).toContain("No project file matches nothing/*.iynk.");
  });
});

describe("iynk run", () => {
  it("prints the serial output and the pin events of the run", async () => {
    const { code, out } = await iynk(["run", `${STARTERS}/blink.project.json`, "--for", "1200ms"]);
    expect(code).toBe(0);
    expect(out).toContain("1.2 s simulated");
    expect(out).toContain("Nothing was printed.");
    expect(out).toContain("0.000 s  D13  out  1");
    expect(out).toContain("0.500 s  D13  out  0");
    expect(out).toContain("1.000 s  D13  out  1");
    expect(out).not.toContain("1.500 s");
  });

  it("prints the serial lines of a sketch", async () => {
    const { out } = await iynk(["run", `${STARTERS}/serial-echo.project.json`, "--for", "1s"]);
    expect(out).toContain("0.000 s  Type a message and it comes back.");
  });

  it("gives JSON with --json", async () => {
    const { out } = await iynk(["run", `${STARTERS}/blink.project.json`, "--for", "600ms", "--json"]);
    const run = JSON.parse(out) as { simulatedMs: number; pins: { net: string; t: number; v: number }[] };
    expect(run.simulatedMs).toBe(600);
    expect(run.pins.map((p) => [p.net, Math.round(p.t), p.v])).toEqual([["D13", 0, 1], ["D13", 500, 0]]);
  });

  it("refuses a duration that is none", async () => {
    const { code, err } = await iynk(["run", `${STARTERS}/blink.project.json`, "--for", "soon"]);
    expect(code).toBe(2);
    expect(err).toContain('"soon" is not a duration');
  });
});

describe("iynk export", () => {
  it("writes the sketch folder with its wiring table", async () => {
    const target = join(work, "sketch");
    const { code } = await iynk(["export", `${STARTERS}/blink.project.json`, "--format", "ino", "--out", target]);
    expect(code).toBe(0);
    const ino = readFileSync(join(target, "Blink_an_LED", "Blink_an_LED.ino"), "utf8");
    expect(ino).toContain("// Exported: 2026-01-02T03:04:05.000Z by iynk");
    expect(ino).toContain("pinMode(LED_PIN, OUTPUT);");
    expect(readFileSync(join(target, "Blink_an_LED", "wiring.csv"), "utf8")).toContain("U1,D13,D13");
  });

  it("prints the parts list as CSV", async () => {
    const { code, out } = await iynk(["export", `${STARTERS}/blink.project.json`, "--format", "bom"]);
    expect(code).toBe(0);
    expect(out.split("\n")[0]).toBe("qty,refdes,part,manufacturer,model");
    expect(out).toContain("1,U1,core.uno-r3@1.0.0,Arduino,Arduino UNO Rev3");
    expect(out).toContain("1,LED1,core.led-5mm@1.0.0");
  });

  it("asks for a format", async () => {
    const { code, err } = await iynk(["export", `${STARTERS}/blink.project.json`]);
    expect(code).toBe(2);
    expect(err).toContain("--format");
  });
});

describe("iynk on the command line", () => {
  it("prints its usage and rejects what it does not know", async () => {
    expect((await iynk(["help"])).out).toContain("iynk check <files|globs>");
    expect((await iynk(["frobnicate"])).code).toBe(2);
    expect((await iynk(["check", "--nope"])).code).toBe(2);
    expect((await iynk(["check", "x", "--lang", "tlh"])).code).toBe(2);
  });
});

/** The command of the action's "Check" step, with the inputs it would get. */
function actionCommand(): string {
  const lines = readFileSync(join(ROOT, "action.yml"), "utf8").split("\n");
  const at = lines.findIndex((l) => l.trim() === "- name: Check");
  const run = lines.findIndex((l, i) => i > at && l.trim() === "run: |");
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && !line.startsWith("        ")) break;
    body.push(line.slice(8));
  }
  return body.join("\n");
}

describe("action.yml", () => {
  it("runs iynk check on the files it is given and fails the step when a project fails", () => {
    const good = save("action-good.iynk", BLINK);
    const bad = save("action-bad.iynk", tooFast);
    const run = (files: string, extra: Record<string, string> = {}) =>
      spawnSync("bash", ["-c", actionCommand()], {
        cwd: work,
        encoding: "utf8",
        env: { ...process.env, GITHUB_ACTION_PATH: resolve(ROOT), IYNK_FILES: files, IYNK_STRICT: "false", IYNK_JUNIT: "", IYNK_LANG: "en", ...extra },
      });
    const passing = run(good);
    expect(passing.stdout).toContain("1 of 1 project passed");
    expect(passing.status).toBe(0);
    const failing = run(`${good} ${bad}`, { IYNK_JUNIT: "action.xml" });
    expect(failing.stdout).toContain("1 of 2 projects passed");
    expect(failing.status).toBe(1);
    expect(readFileSync(join(work, "action.xml"), "utf8")).toContain("<failure");
  }, 60_000);
});
