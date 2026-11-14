import { clockRate, NS_PER_MS, type SimTime } from "@/sim/core/clock";
import { simDiag, type SimDiagnostic } from "@/sim/core/diagnostic";
import { StateHasher } from "@/sim/core/hash";
import { StatementDebugger, type DebugPort } from "@/sim/debug/breakpoints";
import {
  RANK,
  type EventSink,
  type Language,
  type LoadResult,
  type McuEngine,
  type PinPort,
  type ProgramImage,
  type SimEvent,
} from "@/sim/engine";
import type { Diagnostic } from "@/sim/lang/errors";
import { netResolver, pinNet } from "@/lib/interp/pins";
import { fpgaNets } from "@/lib/interp/verilog/nets";
import { getProfile, PROFILES, type BoardId, type BoardProfile, type Language as InterpLanguage } from "@/sim/boards/profiles";
import { type I2CDevice, Pca9685 } from "@/lib/interp/devices";
import { createRun, type DeviceKind, type Run } from "@/lib/interp/run";
import type { DisplayView, PwmDriver } from "@/sim/part-state/types";
import { oledRows, pullOf, type World, type WorldOptions } from "@/lib/interp/world";

export interface InterpEngineOptions {
  id: string;
  board: BoardId;
  variant?: string;
  language: InterpLanguage;
  seed: number;
  devices?: DeviceKind[];
  /** Devices from the circuit to put on the run's I2C bus at each load, made fresh with the run's clock. */
  i2cDevices?: (nowNs: () => number) => I2CDevice[];
  world?: WorldOptions;
  params?: Record<string, number>;
  /** HC-SR04 modules by part id, with the board pins their TRIG and ECHO leads are wired to. A `distance` event moves the obstacle in front of one. */
  rangers?: ReadonlyArray<{ part: string; trig: string; echo: string }>;
}

export interface PinEdgeRecord {
  at: SimTime;
  pin: number;
  level: 0 | 1;
}

export type InterpEngine = McuEngine & {
  readonly run: Run;
  /** Breakpoints and stepping; only the Arduino C++ interpreter pauses, the other languages ignore it. */
  readonly debug: DebugPort;
  readonly serialLog: ReadonlyArray<{ at: SimTime; text: string }>;
  readonly edgeLog: readonly PinEdgeRecord[];
  /** Compile and runtime errors the interpreter reported, in order. */
  readonly diagnostics: readonly SimDiagnostic[];
  /** The OLED the program draws on, or null when it drives none. */
  display(): DisplayView | null;
};

const SIM_LANGUAGE: Record<InterpLanguage, Language> = { arduino: "arduino-cpp", python: "python", verilog: "verilog" };

const INTERP_LANGUAGE: Record<Language, InterpLanguage | undefined> = {
  "arduino-cpp": "arduino",
  python: "python",
  micropython: "python",
  verilog: "verilog",
  "c-cpp": undefined,
};

export function toSimLanguage(l: InterpLanguage): Language {
  return SIM_LANGUAGE[l];
}

export function opNsOf(profile: BoardProfile): number {
  return Math.round(profile.opUs * 1000);
}

const usToNs = (us: number): SimTime => Math.round(us * 1000);

function compileDiagnostic(d: Diagnostic, file: string): SimDiagnostic {
  const isError = d.kind !== "runtime";
  const ref = d.line > 0 ? { file, line: d.line, column: d.col } : { file };
  return simDiag(isError ? "compile-error" : "compile-warning", isError ? "error" : "warning", ref, { message: d.message });
}

function failed(id: string, message: string): LoadResult {
  return { ok: false, diagnostics: [simDiag(id, "error", {}, { message })], models: [] };
}

class InterpEngineImpl implements InterpEngine {
  readonly rank = RANK.mcu;
  readonly tier = "T1";
  readonly language: Language;
  readonly board: BoardId;
  readonly costModel: InterpEngine["costModel"];
  readonly serialLog: { at: SimTime; text: string }[] = [];
  readonly edgeLog: PinEdgeRecord[] = [];
  readonly diagnostics: SimDiagnostic[] = [];
  private current: Run | null = null;
  private entryPath = "";
  readonly debug: StatementDebugger;
  private watched: World | null = null;
  private sink: EventSink | null = null;
  private serialLength = 0;
  /** Virtual time of the Worlds that reset and deep sleep wake have replaced; each new World starts its clock at 0. */
  private base: SimTime = 0;
  private readonly sonars = new Map<string, { distanceCm: number }>();
  private resolve: (net: string) => number | string | undefined = () => undefined;
  /** Verilog only: the board pins each port bit lands on, as the load request gave them. */
  private ports: Record<string, string[]> | undefined;
  /** The level last sent for each pin a Verilog output reaches, so only a change is an event. */
  private readonly shown = new Map<string, number>();
  private readonly profile: BoardProfile | null;

  constructor(
    readonly id: string,
    private readonly o: InterpEngineOptions,
  ) {
    this.board = o.board;
    this.debug = new StatementDebugger(
      (line) => ({ file: this.entryPath, line }),
      () => this.nowNs,
    );
    this.debug.onSkipped((file, line) => {
      this.diagnostics.push(simDiag("debug-skipped-in-isr", "note", { file, line }));
    });
    this.language = toSimLanguage(o.language);
    this.profile = o.board in PROFILES ? getProfile(o.board, o.variant) : null;
    this.costModel = this.profile?.fpga
      ? { kind: "cycle", rate: clockRate(1_000_000_000, this.profile.clockHz) }
      : { kind: "per-statement", opNs: this.profile ? opNsOf(this.profile) : 0 };
  }

  get run(): Run {
    if (!this.current) throw new Error("load a program before using the run");
    return this.current;
  }

  /** What the program has drawn on its OLED, if it drives one. */
  display(): DisplayView | null {
    const oled = this.current?.world.oled;
    if (!oled) return null;
    // text printed over text at the same cursor replaces it, as it does on the glass when a sketch never clears
    const texts = new Map(oled.texts.map(({ x, y, size, text }) => [`${x},${y}`, { x, y, size, text }]));
    return { w: oled.w, h: oled.h, on: oled.on, inverted: oled.inverted, rows: oledRows(oled.fb, oled.w, oled.h), texts: [...texts.values()] };
  }

  /** The PCA9685 boards the program has on its I2C bus, by address. */
  pwmDrivers(): PwmDriver[] {
    const found = [...(this.current?.world.i2c.values() ?? [])].filter((dev): dev is Pca9685 => dev instanceof Pca9685);
    return found.sort((a, b) => a.address - b.address);
  }

  readonly pins: PinPort = {
    read: (pin) => {
      const world = this.run.world;
      const p = world.pin(pin);
      const view: ReturnType<PinPort["read"]> = { mode: p.mode, level: world.level(pin) };
      if (p.duty !== null) {
        view.duty = p.duty;
        view.hz = p.pwmHz;
      } else if (p.toneHz) view.hz = p.toneHz;
      return view;
    },
    drive: (pin, level) => this.run.input(pin, level),
    driveVolts: (pin, volts) => this.run.analog(pin, volts),
  };

  private get nowNs(): SimTime {
    return this.current ? this.base + usToNs(this.current.world.now) : this.base;
  }

  private get live(): boolean {
    const state = this.current?.status.state;
    return state === "running" || state === "sleeping";
  }

  attach(sink: EventSink): void {
    this.sink = sink;
  }

  load(image: ProgramImage): LoadResult {
    const profile = this.profile;
    if (image.kind !== "source") return failed("unsupported-image", "the interpreter runs source, not compiled hex");
    if (!profile) return failed("unknown-board", `unknown board ${this.o.board}`);
    if (INTERP_LANGUAGE[image.language] !== this.o.language) {
      return failed("language-mismatch", `${image.language} does not run on this ${this.o.language} engine`);
    }
    const entry = image.files.find((f) => f.path === image.entry);
    if (!entry) return failed("missing-entry", `${image.entry} is not among the files`);
    let run: Run;
    try {
      run = createRun({
        board: this.o.board,
        variant: this.o.variant,
        language: this.o.language,
        source: entry.text,
        devices: this.o.devices,
        world: { seed: this.o.seed, ...this.o.world },
        params: this.o.params,
        debug: this.debug,
      });
    } catch (e) {
      return failed("unsupported-language", e instanceof Error ? e.message : String(e));
    }
    for (const device of this.o.i2cDevices?.(() => Math.round(run.world.clock.now * 1000)) ?? []) run.world.addDevice(device);
    const diagnostics = run.diagnostics.map((d) => compileDiagnostic(d, entry.path)).slice(0, 1000);
    const ok = !diagnostics.some((d) => d.severity === "error");
    this.entryPath = entry.path;
    this.debug.clearPause();
    this.current = run;
    this.watched = null;
    this.base = 0;
    this.serialLog.length = 0;
    this.edgeLog.length = 0;
    this.diagnostics.length = 0;
    this.serialLength = 0;
    this.ports = image.ports;
    this.shown.clear();
    this.resolve = netResolver(profile, { ports: this.ports });
    this.sonars.clear();
    for (const { part, trig, echo } of this.o.rangers ?? []) {
      const [t, e] = [this.resolve(trig), this.resolve(echo)];
      if (t !== undefined && e !== undefined) this.sonars.set(part, run.attachUltrasonic(t, e));
    }
    run.on("serial", (text) => {
      this.serialLog.push({ at: this.nowNs, text });
      this.serialLength += text.length;
    });
    run.on("error", (e) => {
      const id = e.kind === "limit" ? "limit-exceeded" : "runtime-error";
      this.diagnostics.push(simDiag(id, "error", e.line > 0 ? { file: entry.path, line: e.line, column: e.col } : { file: entry.path }, { message: e.message }));
    });
    if (ok) {
      run.start();
      this.watch();
      this.emitPorts(0);
    }
    return { ok, diagnostics, models: [...(this.o.devices ?? [])] };
  }

  reset(): void {
    if (!this.current) return;
    const at = this.nowNs;
    const driven = [...this.current.world.pins].filter(([, p]) => p.mode === "output" || p.mode === "open_drain").map(([n]) => n);
    this.debug.clearPause();
    this.current.reset();
    this.watch();
    this.shown.clear();
    this.emitPorts(at);
    for (const pin of driven) this.emitPin(at, pin, "Z");
  }

  nextDue(): SimTime | null {
    return this.live ? this.nowNs + NS_PER_MS : null;
  }

  advanceTo(horizon: SimTime): { reached: SimTime; stoppedEarly: boolean } {
    const run = this.current;
    const state = run?.status.state;
    if (!run || (state !== "running" && state !== "sleeping")) return { reached: Math.max(horizon, this.nowNs), stoppedEarly: false };
    let now = this.nowNs;
    if (horizon <= now) return { reached: now, stoppedEarly: false };
    if (this.debug.paused) return { reached: now, stoppedEarly: true };
    // Waking from deep sleep builds a new World at the start of a step; watch it before the program runs.
    if (state === "sleeping") {
      run.step(0);
      this.watch();
      now = this.nowNs;
    }
    run.step((horizon - now) / NS_PER_MS);
    this.watch();
    now = this.nowNs;
    this.emitPorts(now);
    return { reached: now, stoppedEarly: now < horizon && (run.status.throttled || this.debug.paused !== null) };
  }

  onEvent(e: SimEvent): void {
    if (e.phase !== 0 || !this.current || typeof e.payload !== "object" || e.payload === null) return;
    const { target, value } = e.payload as { target: unknown; value: unknown };
    if (typeof target !== "string") return;
    if (e.kind === "serial") {
      if (typeof value === "string") this.serialWrite(value);
      return;
    }
    if (e.kind === "distance") {
      const sonar = this.sonars.get(target);
      if (sonar && typeof value === "number") sonar.distanceCm = value;
      return;
    }
    const pin = this.resolve(target);
    if (pin === undefined) return;
    if (e.kind === "pin" && (value === null || typeof value === "number" || typeof value === "boolean")) this.current.input(pin, value);
    else if (e.kind === "analog" && typeof pin === "number" && (value === null || typeof value === "number")) this.current.analog(pin, value);
  }

  serialWrite(text: string): void {
    this.run.serialWrite(text);
  }

  stateHash(): string {
    const h = new StateHasher().str(this.board).int(this.nowNs).int(this.serialLength);
    if (!this.current) return h.hex();
    h.str(this.current.status.state);
    const pins = [...this.current.world.pins].sort(([a], [b]) => a - b);
    for (const [n, p] of pins) h.obj([n, p.mode, p.out, p.ext, p.duty, p.toneHz]);
    return h.hex();
  }

  private watch(): void {
    const world = this.run.world;
    if (world === this.watched) return;
    if (this.watched) this.base += usToNs(this.watched.now);
    this.watched = world;
    world.onPinWrite((n, level) => {
      const at = this.nowNs;
      this.edgeLog.push({ at, pin: n, level });
      this.emitPin(at, n, level);
    });
    // A new duty is its own event: analogWrite(pin, 120) moves no level edge but the motor driver needs to hear it.
    world.onPwmWrite((n) => this.emitPin(this.nowNs, n, world.level(n)));
    world.onServoWrite((n) => this.emitPin(this.nowNs, n, world.level(n)));
    // INPUT_PULLUP moves no level when a button already holds the pin, but the circuit still has to know about the resistor.
    world.onPullWrite((n) => this.emitPin(this.nowNs, n, world.level(n)));
  }

  /**
   * A Verilog design's outputs reach the board pins its port map names: one event per pin whose level changed, with the
   * share of time it was high for a bit that switches faster than the eye (a multiplexed segment, a PWM LED).
   * Inputs are not echoed: a switch that drives a pin is the pin's driver.
   */
  private emitPorts(at: SimTime): void {
    const { profile, ports, sink } = this;
    if (!sink || !profile?.fpga || !ports) return;
    const { world } = this.run;
    const nets = fpgaNets(profile, { ports: world.ports ?? undefined, duty: world.duty ?? undefined, seg7: world.seg7 ?? undefined }, ports);
    for (const [pin, net] of Object.entries(nets)) {
      if (net.input || pin === "" || this.shown.get(pin) === net.v) continue;
      this.shown.set(pin, net.v);
      const level = net.v >= 0.5 ? 1 : 0;
      sink.emit({ at, phase: 2, rank: RANK.mcu, src: this.id, kind: "pin", payload: { pin, level, ...(net.pwm ? { duty: net.v } : {}) } });
    }
  }

  private emitPin(at: SimTime, n: number, level: 0 | 1 | "Z"): void {
    if (!this.sink || !this.profile) return;
    const { duty, pwmHz, mode, servoUs, toneHz } = this.run.world.pin(n);
    // a tone is a square wave: half the time high, at its frequency
    const pwm = level === "Z" ? {} : duty !== null ? { duty, hz: pwmHz } : toneHz > 0 ? { duty: 0.5, hz: toneHz } : {};
    const servo = servoUs ? { servoUs } : {};
    const pull = pullOf(mode);
    const driven = mode === "output" || mode === "open_drain" ? {} : { driven: false as const, ...(pull ? { pull } : {}) };
    this.sink.emit({ at, phase: 2, rank: RANK.mcu, src: this.id, kind: "pin", payload: { pin: pinNet(this.profile, n), level, ...pwm, ...servo, ...driven } });
  }
}

export function createInterpEngine(o: InterpEngineOptions): InterpEngine {
  return new InterpEngineImpl(o.id, o);
}
