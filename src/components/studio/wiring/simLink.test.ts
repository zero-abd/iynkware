// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInlinePort } from "@/protocol";
import type { Op } from "@/project/generated/types";
import type { HostInput } from "@/sim/engine";
import { classifyImpact } from "@/project/opImpact";
import { sampleBlinkD12 } from "@/project/samples";
import { createSession } from "@/project/session";
import { seededRandom, steppingClock } from "@/project/session.testing";
import { validateValue } from "@/project/validate";
import { createInterpEngine } from "@/sim-host/engines/interp-engine";
import { createSimHandler } from "@/sim-host/handler";
import { createSimHost } from "@/sim-host/host";
import type { SimEv } from "@/sim-host/protocol";
import type { Project } from "@/project/generated/types";
import { INTERP_LANGUAGE } from "@/lib/interp";
import { createDigitalNets } from "@/sim/digital/nets";
import { createDocStore } from "@/studio/stores/doc";
import { createRunStore } from "@/studio/stores/run";
import { createRecordingDoc } from "@/studio/testing/recording-doc";
import { linkSim, loadForRun, type SimHostLike } from "./simLink";

function blinkSession(code?: string) {
  const report = validateValue(sampleBlinkD12());
  const state = report.doc!;
  if (code) state.sources.find((s) => s.role === "firmware")!.content = code;
  return createSession({ state, clock: steppingClock(), rnd: seededRandom() });
}

function fakeHost() {
  const listeners: Array<(e: SimEv) => void> = [];
  const calls: string[] = [];
  const host: SimHostLike & { loads: unknown[]; inputs: HostInput[] } = {
    loads: [],
    inputs: [],
    async load(net, opts, program) {
      calls.push("load");
      host.loads.push({ net, opts, program });
      return { diagnostics: [], runId: calls.length };
    },
    async control(op) {
      calls.push(`control:${op}`);
    },
    async input(i) {
      calls.push(`input:${i.kind}`);
      host.inputs.push(i);
    },
    async setInput(i) {
      calls.push(`part:${i.part}:${i.param}:${i.value}`);
    },
    async pause() {
      calls.push("pause");
    },
    async resume() {
      calls.push("resume");
    },
    async step(unit, n) {
      calls.push(`step:${unit}:${n}`);
    },
    async setSpeed(x) {
      calls.push(`speed:${x}`);
    },
    async debug(op) {
      calls.push(`debug:${op.op}`);
    },
    onEvent(fn) {
      listeners.push(fn);
      return () => void listeners.splice(listeners.indexOf(fn), 1);
    },
  };
  const emit = (e: SimEv) => listeners.forEach((fn) => fn(e));
  return { host, calls, emit };
}

const stateEv = (state: Extract<SimEv, { t: "state" }>["state"], limit?: { kind: string; message: string }): SimEv => ({ t: "state", run: 1, state, at: 0, ...(limit ? { limit } : {}) });

function rig() {
  const doc = createRecordingDoc(blinkSession());
  const run = createRunStore();
  const fake = fakeHost();
  const link = linkSim({ doc, run, host: fake.host, impact: classifyImpact });
  return { doc, run, link, ...fake };
}

function knobRig() {
  const state = validateValue(JSON.parse(readFileSync("src/studio/starters/knob.project.json", "utf8"))).doc!;
  const doc = createRecordingDoc(createSession({ state, clock: steppingClock(), rnd: seededRandom() }));
  const fake = fakeHost();
  const link = linkSim({ doc, run: createRunStore(), host: fake.host, impact: classifyImpact });
  return { link, ...fake };
}

const moveResistor = (): Op => ({ k: "view.place", view: "vw_bb", placement: { c: "cmp_res1", legs: { P1: "b10", P2: "b14" }, x_mm: 1, y_mm: 2 } }) as Op;

describe("simLink", () => {
  afterEach(() => void vi.useRealTimers());

  it("loads the project and then runs it", async () => {
    const { link, run, calls, host, emit } = rig();
    await link.run();
    expect(calls).toEqual(["load", "control:run"]);
    expect(run.getState().phase).toBe("starting");
    emit(stateEv("running"));
    expect(run.getState().phase).toBe("running");
    const { program, opts } = host.loads[0] as { program: { entry: string; files: { path: string }[] }; opts: { speed: number } };
    expect(program.entry).toBe(program.files[0]!.path);
    expect(opts.speed).toBe(1);
  });

  it("ignores a second Run while starting or running", async () => {
    const { link, calls, emit } = rig();
    await link.run();
    emit(stateEv("running"));
    await link.run();
    expect(calls).toEqual(["load", "control:run"]);
  });

  it("turns frames into part states and serial lines with stamps", async () => {
    const { link, run, emit } = rig();
    await link.run();
    emit(stateEv("running"));
    emit({ t: "frame", run: 1, at: 1_000_000_000, pins: { D12: 1 }, parts: [], serial: [{ at: 1_000_000_000, text: "on\n" }] });
    expect(run.getState().frame).toMatchObject({ tNs: 1_000_000_000, pins: { D12: 1 } });
    expect(run.getState().serial).toMatchObject([{ tNs: 1_000_000_000, kind: "out", text: "on" }]);
  });

  it("marks stale for an edit of the code and for a changed parameter, not for a move", async () => {
    const { doc, link, run, emit } = rig();
    await link.run();
    emit(stateEv("running"));
    doc.commit([moveResistor()], { label: "Move" });
    expect(run.getState().stale).toBe(false);
    doc.commit([{ k: "component.set", id: "cmp_res1", params: { ohms: 470 } }], { label: "Value" });
    expect(run.getState().stale).toBe(true);
  });

  it("starts a running circuit again on its new value once the editing has paused", async () => {
    vi.useFakeTimers();
    const { doc, link, run, emit, host } = rig();
    await link.run();
    emit(stateEv("running"));
    doc.commit([{ k: "component.set", id: "cmp_res1", params: { ohms: 470 } }], { label: "Value" });
    doc.commit([{ k: "component.set", id: "cmp_res1", params: { ohms: 680 } }], { label: "Value" });
    expect(host.loads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(host.loads).toHaveLength(2);
    expect(run.getState().stale).toBe(false);
    link.dispose();
  });

  it("does not start again after a stop, and not for the code", async () => {
    vi.useFakeTimers();
    const { doc, link, emit, host } = rig();
    await link.run();
    emit(stateEv("running"));
    const source = doc.getState().state.sources.find((s) => s.role === "firmware")!;
    doc.commit([{ k: "source.edit", id: source.id, baseSeq: 0, pos: 0, del: 0, ins: "// hi\n" }], { label: "Edit" });
    doc.commit([{ k: "component.set", id: "cmp_res1", params: { ohms: 470 } }], { label: "Value" });
    link.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(host.loads).toHaveLength(1);
    link.dispose();
  });

  it("leaves a run alone for an instrument on a pin it has a node for, and starts it again for one it has not", async () => {
    vi.useFakeTimers();
    const { doc, link, run, emit, host } = rig();
    await link.run();
    emit(stateEv("running"));
    const net = host.loads[0] as { net: { parts: { id: string; pins: Record<string, string | null> }[] } };
    const part = net.net.parts.find((p) => p.id === "cmp_res1")!;
    const wired = Object.keys(part.pins).find((p) => part.pins[p] !== null)!;
    doc.commit([{ k: "instrument.set", instrument: { id: "ins_1", kind: "multimeter", target: { pin: { c: "cmp_res1", p: wired } } } }], { label: "Add instrument" });
    await vi.advanceTimersByTimeAsync(500);
    expect(run.getState().stale).toBe(false);
    expect(host.loads).toHaveLength(1);
    doc.commit([{ k: "instrument.set", instrument: { id: "ins_2", kind: "multimeter", target: { pin: { c: "cmp_res1", p: "nowhere" } } } }], { label: "Add instrument" });
    expect(run.getState().stale).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(host.loads).toHaveLength(2);
    link.dispose();
  });

  it("marks stale when the source is edited", async () => {
    const { doc, link, run, emit } = rig();
    await link.run();
    emit(stateEv("running"));
    const source = doc.getState().state.sources.find((s) => s.role === "firmware")!;
    doc.commit([{ k: "source.edit", id: source.id, baseSeq: 0, pos: 0, del: 0, ins: "// hi\n" }], { label: "Edit" });
    expect(run.getState().stale).toBe(true);
  });

  it("does nothing about edits when no run exists", () => {
    const { doc, run } = rig();
    doc.commit([{ k: "component.set", id: "cmp_res1", params: { ohms: 470 } }], { label: "Value" });
    expect(run.getState().stale).toBe(false);
  });

  it("restarts from the current document and clears the stale mark", async () => {
    const { doc, link, run, emit, host } = rig();
    await link.run();
    emit(stateEv("running"));
    const source = doc.getState().state.sources.find((s) => s.role === "firmware")!;
    doc.commit([{ k: "source.edit", id: source.id, baseSeq: 0, pos: 0, del: 0, ins: "// hi\n" }], { label: "Edit" });
    await link.run();
    expect(host.loads).toHaveLength(2);
    expect((host.loads[1] as { program: { files: { text: string }[] } }).program.files[0]!.text.startsWith("// hi")).toBe(true);
    expect(run.getState().stale).toBe(false);
  });

  it("stops during starting without running the late load", async () => {
    const { link, run, calls, host } = rig();
    let release: () => void = () => {};
    host.load = async () => {
      calls.push("load");
      await new Promise<void>((resolve) => (release = resolve));
      return { diagnostics: [], runId: 1 };
    };
    const pending = link.run();
    link.stop();
    release();
    await pending;
    expect(run.getState().phase).toBe("stopped");
    expect(calls).not.toContain("control:run");
    expect(calls).toContain("control:stop");
  });

  it("shows compile errors and runs nothing", async () => {
    const { link, run, calls, host } = rig();
    host.load = async () => ({ diagnostics: [{ id: "parse", severity: "error", ref: { line: 3 }, text_key: "diag.parse", args: { message: "expected ;" } }], runId: 1 });
    await link.run();
    expect(run.getState()).toMatchObject({ phase: "error", diagnostics: [{ text: "expected ;", line: 3 }] });
    expect(calls).not.toContain("control:run");
  });

  it("maps a limit event to the limit that was hit", async () => {
    const { link, run, emit } = rig();
    await link.run();
    emit(stateEv("running"));
    emit(stateEv("limit", { kind: "limit-exceeded", message: "The code ran more than 400000 statements" }));
    expect(run.getState()).toMatchObject({ phase: "limit", limit: { which: "statements" } });
  });

  it("maps a replaced worker to killed and runs again from the document", async () => {
    const { link, run, emit, host } = rig();
    await link.run();
    emit(stateEv("running"));
    emit(stateEv("limit", { kind: "wall-stall", message: "restarted" }));
    expect(run.getState().phase).toBe("killed");
    await link.run();
    expect(host.loads).toHaveLength(2);
  });

  it("maps halted to error and shows event messages", async () => {
    const { link, run, emit } = rig();
    await link.run();
    emit(stateEv("running"));
    emit({ t: "event", run: 1, event: { kind: "diagnostic", message: "division by zero", at: 5 } });
    emit(stateEv("halted"));
    expect(run.getState()).toMatchObject({ phase: "error", diagnostics: [{ text: "division by zero" }] });
  });

  it("sends serial text and button presses only while running", async () => {
    const { link, run, calls, emit } = rig();
    link.sendSerial("hi\n");
    link.press("cmp_btn", "A", true);
    expect(calls).toEqual([]);
    await link.run();
    emit(stateEv("running"));
    link.sendSerial("hi\n");
    link.press("cmp_btn", "A", true);
    expect(calls.slice(-2)).toEqual(["input:serial", "input:pin"]);
    expect(run.getState().serial.at(-1)).toMatchObject({ kind: "in", text: "hi" });
  });

  it("puts the world inputs at their values at the start, and a turned knob keeps its place on restart", async () => {
    const { link, host, emit, calls } = knobRig();
    await link.run();
    const start = calls.filter((c) => c === "input:analog");
    expect(start).toHaveLength(1);
    expect(host.inputs.at(-1)).toMatchObject({ kind: "analog", target: "A0" });
    expect(host.inputs.at(-1)!.value).toBeCloseTo((620 / 1023) * 5, 6);
    emit(stateEv("running"));
    link.setInput("knob", 1023);
    expect(host.inputs.at(-1)).toMatchObject({ kind: "analog", target: "A0", value: 5 });
    await link.restart();
    expect(host.inputs.at(-1)).toMatchObject({ kind: "analog", target: "A0", value: 5 });
  });

  it("sends a part input only while running", async () => {
    const { link, calls, emit } = knobRig();
    link.partInput({ part: "cmp_btn", param: "pressed", value: 1 });
    expect(calls.some((c) => c.startsWith("part:"))).toBe(false);
    await link.run();
    emit(stateEv("running"));
    link.partInput({ part: "cmp_btn", param: "pressed", value: 1 });
    expect(calls.at(-1)).toBe("part:cmp_btn:pressed:1");
  });

  it("drives the world input a lesson ties to the part, so the pins follow the canvas", async () => {
    const { link, host, emit } = knobRig();
    await link.run();
    emit(stateEv("running"));
    const before = host.inputs.length;
    link.partInput({ part: "cmp_pot1", param: "pos", value: 1 });
    const driven = host.inputs.slice(before);
    expect(driven).toContainEqual(expect.objectContaining({ kind: "analog", target: "A0", value: 5 }));
    link.partInput({ part: "cmp_other", param: "pos", value: 1 });
    expect(host.inputs).toHaveLength(before + driven.length);
  });

  it("sends a world input only while running", async () => {
    const { link, host, emit } = knobRig();
    link.setInput("knob", 512);
    expect(host.inputs).toEqual([]);
    await link.run();
    emit(stateEv("running"));
    const before = host.inputs.length;
    link.setInput("knob", 512);
    link.setInput("no-such-input", 1);
    // The knob turns the potentiometer and puts its voltage on the pin.
    expect(host.inputs).toHaveLength(before + 2);
  });

  it("goes back to idle on reset and ignores late events", async () => {
    const { link, run, calls, emit } = rig();
    await link.run();
    emit(stateEv("running"));
    link.reset();
    emit({ t: "frame", run: 1, at: 5, pins: {}, parts: [], serial: [{ at: 5, text: "late\n" }] });
    expect(run.getState()).toMatchObject({ phase: "idle", serial: [] });
    expect(calls).toContain("control:reset");
  });

  it("shows what the host reports about keeping up", async () => {
    const { link, run, emit } = rig();
    await link.run();
    emit(stateEv("running"));
    emit({ t: "speed.report", run: 1, achieved: 20, behind: true });
    expect(run.getState()).toMatchObject({ behindReal: true, achievedSpeed: 20 });
    emit({ t: "speed.report", run: 1, achieved: 100, behind: false });
    expect(run.getState().behindReal).toBe(false);
    emit({ t: "speed.report", run: 1, achieved: 20, behind: true });
    emit(stateEv("paused"));
    expect(run.getState()).toMatchObject({ phase: "paused", behindReal: false });
  });

  it("pauses, steps and resumes only in the phase that allows it", async () => {
    const { link, run, calls, emit } = rig();
    await link.run();
    emit(stateEv("running"));
    link.step("statement", 1);
    link.pause();
    emit(stateEv("paused"));
    link.pause();
    link.step("statement", 1);
    link.resume();
    expect(calls.filter((c) => /^(pause|resume|step)/.test(c))).toEqual(["pause", "step:statement:1", "resume"]);
    expect(run.getState().phase).toBe("paused");
  });

  it("moves the clock to where a step left the run, though no frame came with it", async () => {
    const { link, run, emit } = rig();
    await link.run();
    emit(stateEv("running"));
    emit({ t: "state", run: 1, state: "paused", at: 1_446_000_000 });
    expect(run.getState().tNs).toBe(1_446_000_000);
    emit({ t: "state", run: 1, state: "paused", at: 2_446_000_000 });
    expect(run.getState().tNs).toBe(2_446_000_000);
  });

  it("keeps the chosen speed for the next run and tells the host", async () => {
    const { link, run, calls, host } = rig();
    link.setSpeed(10);
    expect(calls).not.toContain("speed:10");
    await link.run();
    expect((host.loads[0] as { opts: { speed: number } }).opts.speed).toBe(10);
    link.setSpeed(0);
    expect(calls).toContain("speed:0");
    link.reset();
    expect(run.getState().speed).toBe(0);
  });

  it("stops listening on dispose", async () => {
    const { link, run, doc } = rig();
    await link.run();
    link.dispose();
    doc.commit([{ k: "component.set", id: "cmp_res1", params: { ohms: 470 } }], { label: "Value" });
    expect(run.getState().stale).toBe(false);
  });
});

describe("simLink with the real simulator", () => {
  const hosts: Array<ReturnType<typeof createSimHost>> = [];
  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((h) => h.kill()));
  });

  const SKETCH = 'void setup() { Serial.begin(9600); pinMode(12, OUTPUT); }\nvoid loop() { digitalWrite(12, HIGH); Serial.println("on"); delay(500); digitalWrite(12, LOW); Serial.println("off"); delay(500); }\n';

  async function blinkRun(): Promise<string[]> {
    let wall = 0;
    const host = createSimHost({
      makePort: () =>
        createInlinePort(
          createSimHandler({
            diag: false,
            wallMs: () => (wall += 2000),
            schedule: (fn) => void setTimeout(fn, 0),
            makeEngine: (program, net, opts) =>
              createInterpEngine({
                id: net.parts.find((p) => p.kind === "board")!.id,
                board: "uno-r3",
                language: INTERP_LANGUAGE[(program.kind === "source" ? program.language : "arduino-cpp") as keyof typeof INTERP_LANGUAGE] ?? "arduino",
                seed: opts.seed,
              }),
            makeDigital: createDigitalNets,
          }),
        ),
    });
    hosts.push(host);
    const run = createRunStore();
    const link = linkSim({ doc: createDocStore(blinkSession(SKETCH)), run, host, impact: classifyImpact });
    await link.run();
    for (let i = 0; i < 2000 && run.getState().serial.length < 5; i++) await new Promise((r) => setTimeout(r, 5));
    link.stop();
    return run.getState().serial.slice(0, 5).map((e) => `${e.tNs} ${e.text}`);
  }

  it("prints five lines with virtual stamps, the same in every run", async () => {
    const first = await blinkRun();
    expect(first.map((l) => l.split(" ")[1])).toEqual(["on", "off", "on", "off", "on"]);
    expect(Number(first[4]!.split(" ")[0])).toBeGreaterThan(1.9e9);
    expect(await blinkRun()).toEqual(first);
  });
});

describe("loadForRun", () => {
  it("hands a robot project to the host so the physics engine is fetched, and a plain project without it", async () => {
    const seen: Array<Project | undefined> = [];
    const host = { load: async (_n: unknown, _o: unknown, _p: unknown, robot?: Project) => (seen.push(robot), { diagnostics: [], runId: 1 }) };
    const robot = JSON.parse(readFileSync("content/projects/robots/drive-base.project.json", "utf8")) as Project;
    await loadForRun(host, robot, 1);
    await loadForRun(host, validateValue(sampleBlinkD12()).doc!, 1);
    expect(seen[0]?.id).toBe(robot.id);
    expect(seen[1]).toBeUndefined();
  });
});

describe("an FPGA board running alone", () => {
  it("follows a switch of the Inputs panel with the LEDs of its Verilog design", async () => {
    const starter = JSON.parse(readFileSync("src/studio/starters/basys3.project.json", "utf8")) as Project;
    const host = createSimHost({
      makePort: () =>
        createInlinePort(
          createSimHandler({
            diag: false,
            wallMs: () => performance.now(),
            schedule: (fn) => void setTimeout(fn, 0),
            makeEngine: (_program, _net, opts) => createInterpEngine({ id: "brd_main", board: "basys3", language: "verilog", seed: opts.seed }),
            makeDigital: createDigitalNets,
          }),
        ),
    });
    const run = createRunStore();
    const link = linkSim({ doc: createDocStore(createSession({ state: starter, clock: steppingClock(), rnd: seededRandom() })), run, host, impact: classifyImpact });
    link.setSpeed(1);
    await link.run();
    const pin = (name: string) => run.getState().frame?.pins[name];
    for (let i = 0; i < 400 && pin("LD3") === undefined; i++) await new Promise((r) => setTimeout(r, 5));
    expect([pin("LD1"), pin("LD3")]).toEqual([0, 1]);
    link.setInput("sw0", 1);
    for (let i = 0; i < 400 && pin("LD1") !== 1; i++) await new Promise((r) => setTimeout(r, 5));
    expect([pin("LD1"), pin("LD3")]).toEqual([1, 0]);
    link.stop();
    await host.kill();
  });
});
