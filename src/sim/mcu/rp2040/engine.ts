import type { RP2040, Simulator } from "rp2040js";
import { utf8Encode } from "../../../core/canonical.ts";
import { NS_PER_MS, clockRate, type SimTime } from "../../core/clock.ts";
import { simDiag, type SimDiagnostic } from "../../core/diagnostic.ts";
import { StateHasher } from "../../core/hash.ts";
import type { BusOp, BusPort } from "../../bus/index.ts";
import { RANK, type EventSink, type Language, type LoadResult, type McuEngine, type PinPort, type ProgramImage, type SimEvent, type SliceBudget } from "../../engine.ts";
import { handleFlashBreak, patchFlashRoutines } from "./flash-rom.ts";
import type { Rp2040js } from "./lib.ts";
import { attachPins, pinIndex, pinName, type PinChange, type Pins } from "./pins.ts";
import { installPollSkip, type PollSkip } from "./poll-skip.ts";
import { SerialText } from "./serial-text.ts";
import { BOOT2_BYTES, FLASH_BASE, flashOf, hasBoot2, hasProgram, parseUf2 } from "./uf2.ts";
import { attachUsbSerial, type UsbSerial } from "./usb-serial.ts";

const I2C_BUS = "i2c0";
const ENGINE_ID = "engine:rp2040@1.0.0";
const SLICE_STEPS = 4096;
const I2C_FUNCTION = 3;
const ADC_FIRST_PIN = 26;
const ADC_CHANNELS = 4;
const ADC_VREF = 3.3;
const ADC_MAX = 4095;
/** The internal temperature sensor reads 0.706 V at 27 degrees. */
const ADC_TEMPERATURE = Math.round((0.706 / ADC_VREF) * ADC_MAX);
/** A loop that reads the ADC without pause hands control back to the circuit this often, not on every read. */
const ADC_SOLVE_EVERY_NS = 20_000;
const I2C_MODEL_HZ = 100_000;
const I2C_STEP_NS = 1000;
const FALLBACK_I2C_HZ = 100_000;

export interface Rp2040Wiring {
  /** The volts the circuit puts on a pin, or null when nothing is wired to it. */
  volts(pin: string): number | null;
  /** The I2C bus the two board pins are on, or null when either is not wired. */
  i2c(sda: string, scl: string): BusPort | null;
}

export interface Rp2040Options {
  lib: Rp2040js;
  /** The boot ROM image; it is copied before the flash routines in it are replaced. */
  bootrom: Uint32Array;
  wiring: Rp2040Wiring;
}

export interface Rp2040Engine extends McuEngine {
  readonly nowNs: SimTime;
  readonly serialLog: ReadonlyArray<{ at: SimTime; text: string }>;
  readonly diagnostics: readonly SimDiagnostic[];
  /** What the run did so far: instructions run, time spent asleep and time skipped in wait loops. */
  readonly stats: { instructions: number; sleptNs: number; skippedNs: number };
}

type StopReason = "pin" | "adc";
interface Machine {
  sim: Simulator;
  mcu: RP2040;
  pins: Pins;
  usb: UsbSerial;
  skip: PollSkip;
  /** The end of the slice being run, in the clock's nanoseconds. */
  target: number;
  cycleNs: number;
  /** Counts what the circuit or the host can see, so the poll skip knows a wait loop is doing more than waiting. */
  activity: number;
}

function failed(id: string, message: string): LoadResult {
  return { ok: false, diagnostics: [simDiag(id, "error", {}, { message })], models: [] };
}

class Rp2040EngineImpl implements Rp2040Engine {
  readonly id = ENGINE_ID;
  readonly rank = RANK.mcu;
  readonly tier = "T3";
  readonly language: Language = "c-cpp";
  readonly board = "pico";
  readonly costModel = { kind: "cycle", rate: clockRate(8, 1) } as const;
  readonly serialLog: { at: SimTime; text: string }[] = [];
  readonly diagnostics: SimDiagnostic[] = [];
  readonly stats = { instructions: 0, sleptNs: 0, skippedNs: 0 };
  private sink: EventSink | null = null;
  private flash: Uint8Array | null = null;
  private m: Machine | null = null;
  private halted = false;
  private stop: StopReason | null = null;
  private lastAdcSolveNs = -Infinity;
  private adcOverride: (number | null)[] = Array(ADC_CHANNELS).fill(null);
  private readonly text = new SerialText();
  private lastByteAt = 0;
  private serialBytes = 0;
  private readonly i2cPorts: { key: string; port: BusPort | null }[] = [{ key: "", port: null }, { key: "", port: null }];

  private readonly o: Rp2040Options;

  constructor(o: Rp2040Options) {
    this.o = o;
  }

  get nowNs(): SimTime {
    return this.m ? Math.floor(this.m.sim.clock.nanos) : 0;
  }

  readonly pins: PinPort = {
    read: (pin) => (this.m ? this.m.pins.read(pin) : { mode: "unset", level: 0 }),
    drive: (pin, level) => this.m?.pins.setExternal(pin, level),
    driveVolts: (pin, volts) => this.setAnalog(pin, volts),
  };

  attach(sink: EventSink): void {
    this.sink = sink;
  }

  load(image: ProgramImage): LoadResult {
    if (image.kind !== "uf2") return failed("unsupported-image", "the RP2040 engine runs a UF2 file, not source or hex");
    const parsed = parseUf2(image.bytes);
    if (!parsed.ok) return failed(parsed.error.kind, parsed.error.message);
    const flash = flashOf(parsed.value);
    if (!hasProgram(flash)) return failed("uf2-no-vectors", "the program has no vector table at the start of flash");
    this.flash = flash;
    this.start();
    return { ok: true, diagnostics: [], models: [] };
  }

  reset(): void {
    if (this.flash) this.start();
  }

  nextDue(): SimTime | null {
    return this.m && !this.halted ? this.nowNs + NS_PER_MS : null;
  }

  advanceTo(horizon: SimTime, budget: SliceBudget): { reached: SimTime; stoppedEarly: boolean } {
    const m = this.m;
    const now = this.nowNs;
    if (!m || this.halted || horizon <= now) return { reached: Math.max(horizon, now), stoppedEarly: false };
    this.stop = null;
    m.target = horizon;
    this.beforeSlice(m);
    const yielded = this.execute(m, budget);
    m.pins.samplePwm();
    this.flushSerial();
    if (this.halted) return { reached: horizon, stoppedEarly: false };
    const early = this.stop !== null || yielded;
    return early ? { reached: Math.min(this.nowNs, horizon), stoppedEarly: true } : { reached: horizon, stoppedEarly: false };
  }

  onEvent(e: SimEvent): void {
    if (e.phase !== 0 || !this.m || typeof e.payload !== "object" || e.payload === null) return;
    const { target, value } = e.payload as { target: unknown; value: unknown };
    if (typeof target !== "string") return;
    if (e.kind === "serial") {
      if (typeof value === "string") this.serialWrite(value);
      return;
    }
    const pin = pinIndex(target);
    if (pin === undefined) return;
    if (e.kind === "pin" && (value === null || typeof value === "number" || typeof value === "boolean")) {
      this.m.pins.setExternal(pin, value === null ? null : value ? 1 : 0);
    } else if (e.kind === "analog" && (value === null || typeof value === "number")) this.setAnalog(pin, value);
  }

  serialWrite(text: string): void {
    const m = this.m;
    if (!m) return;
    const bytes = Array.from(utf8Encode(text));
    if (m.usb.connected) m.usb.write(bytes);
    else {
      const uart = m.mcu.uart.find((u) => u.rxEnabled);
      for (const byte of bytes) uart?.feedByte(byte);
    }
  }

  stateHash(): string {
    const h = new StateHasher().str(this.board).int(this.nowNs).int(this.serialBytes).str(this.halted ? "halted" : this.m ? "running" : "unloaded");
    if (this.m) {
      const { core, sram } = this.m.mcu;
      h.bytes(new Uint8Array(core.registers.buffer, core.registers.byteOffset, core.registers.byteLength)).bytes(sram);
    }
    return h.hex();
  }

  private setAnalog(pin: number, volts: number | null): void {
    const channel = pin - ADC_FIRST_PIN;
    if (channel >= 0 && channel < ADC_CHANNELS) this.adcOverride[channel] = volts;
  }

  private start(): void {
    const flash = this.flash;
    if (!flash) return;
    const { lib } = this.o;
    const sim = new lib.Simulator();
    const mcu = sim.rp2040;
    mcu.logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
    const rom = this.o.bootrom.slice();
    patchFlashRoutines(rom);
    mcu.loadBootrom(rom);
    mcu.flash.set(flash);
    const pins = attachPins(lib, mcu, {
      report: (change) => this.reportPin(change),
      edge: () => {
        if (this.m) this.m.activity++;
        this.stop ??= "pin";
      },
    });
    const m: Machine = {
      sim,
      mcu,
      pins,
      usb: attachUsbSerial(lib, mcu, (bytes) => bytes.forEach((b) => this.serialByte(b))),
      skip: installPollSkip(mcu, sim.clock, { activity: () => this.m?.activity ?? 0, spanNs: () => (this.m ? this.m.target - this.m.sim.clock.nanos : 0) }),
      target: 0,
      cycleNs: 1e9 / mcu.clkSys,
      activity: 0,
    };
    this.m = m;
    this.halted = false;
    this.stop = null;
    this.diagnostics.length = 0;
    this.serialLog.length = 0;
    this.serialBytes = 0;
    this.adcOverride.fill(null);
    this.lastAdcSolveNs = -Infinity;
    mcu.addClockListener((clkSys) => {
      m.cycleNs = 1e9 / clkSys;
    });
    mcu.onBreak = (code) => this.onBreak(mcu, code);
    mcu.uart.forEach((uart) => {
      uart.onByte = (byte) => this.serialByte(byte);
    });
    this.installAdc(m);
    this.installI2c(m);
    this.boot(m, flash);
  }

  /** Runs the second stage loader when the program carries one, as the boot ROM does; else starts at the vector table. */
  private boot(m: Machine, flash: Uint8Array): void {
    const { core } = m.mcu;
    if (hasBoot2(flash)) {
      core.PC = FLASH_BASE;
      return;
    }
    const vectors = FLASH_BASE + BOOT2_BYTES;
    core.VTOR = vectors;
    core.SP = m.mcu.readUint32(vectors);
    core.PC = m.mcu.readUint32(vectors + 4) & ~1;
  }

  private onBreak(mcu: RP2040, code: number): void {
    if (handleFlashBreak(mcu, code)) return;
    this.halted = true;
    this.diagnostics.push(simDiag("runtime-error", "error", {}, { message: `The firmware stopped at a breakpoint (BKPT ${code}), usually a failed assert or a panic.` }));
  }

  private reportPin(change: PinChange): void {
    this.sink?.emit({ at: this.nowNs, phase: 2, rank: RANK.mcu, src: this.id, kind: "pin", payload: change });
  }

  private serialByte(byte: number): void {
    this.text.push(byte);
    this.serialBytes++;
    this.lastByteAt = this.nowNs;
    if (this.m) this.m.activity++;
  }

  private flushSerial(): void {
    if (this.text.length === 0) return;
    const text = this.text.take();
    if (text !== "") this.serialLog.push({ at: this.lastByteAt, text });
  }

  /** The voltage on each ADC pin comes from the circuit at the start of every slice. */
  private beforeSlice(m: Machine): void {
    const { channelValues } = m.mcu.adc;
    for (let channel = 0; channel < ADC_CHANNELS; channel++) {
      const volts = this.o.wiring.volts(pinName(ADC_FIRST_PIN + channel)) ?? this.adcOverride[channel] ?? 0;
      channelValues[channel] = Math.round((Math.min(Math.max(volts, 0), ADC_VREF) / ADC_VREF) * ADC_MAX);
    }
    channelValues[4] = ADC_TEMPERATURE;
  }

  private installAdc(m: Machine): void {
    const { adc } = m.mcu;
    const read = adc.onADCRead;
    adc.onADCRead = (channel) => {
      m.activity++;
      if (m.sim.clock.nanos - this.lastAdcSolveNs >= ADC_SOLVE_EVERY_NS) {
        this.lastAdcSolveNs = m.sim.clock.nanos;
        this.stop ??= "adc";
      }
      read(channel);
    };
  }

  private i2cPort(m: Machine, instance: number): BusPort | null {
    const found = m.mcu.gpio.flatMap((gpio) => (gpio.functionSelect === I2C_FUNCTION && (gpio.index % 4) >> 1 === instance ? [gpio.index] : []));
    const sda = found.find((index) => index % 2 === 0);
    const scl = found.find((index) => index % 2 === 1);
    const key = `${sda}/${scl}`;
    const cached = this.i2cPorts[instance];
    if (cached.key !== key) this.i2cPorts[instance] = { key, port: sda === undefined || scl === undefined ? null : this.o.wiring.i2c(pinName(sda), pinName(scl)) };
    return this.i2cPorts[instance].port;
  }

  private installI2c(m: Machine): void {
    const { I2CMode } = this.o.lib;
    m.mcu.i2c.forEach((i2c, instance) => {
      let done: () => void = () => undefined;
      const alarm = m.sim.clock.createAlarm(() => done());
      const hz = (): number => {
        const cycles = i2c.sclHighPeriod + i2c.sclLowPeriod;
        return cycles > 0 ? m.mcu.clkSys / cycles : FALLBACK_I2C_HZ;
      };
      const transact = (op: BusOp, finish: (ack: boolean, byte: number) => void): void => {
        let ack = false;
        let byte = 0xff;
        let costNs = I2C_STEP_NS;
        const port = this.i2cPort(m, instance);
        if (port) {
          const result = port.transact(I2C_BUS, op);
          if ("notModelled" in result) {
            this.diagnostics.push(simDiag("runtime-error", "error", {}, { message: `The I2C bus has no model for this transfer: ${result.reason}` }));
            this.halted = true;
          } else {
            ack = result.ack ?? false;
            byte = result.byte ?? 0xff;
            costNs = Math.max(I2C_STEP_NS, Math.round((result.costNs * I2C_MODEL_HZ) / hz()));
          }
        }
        m.activity++;
        done = () => finish(ack, byte);
        alarm.schedule(costNs);
      };
      i2c.onStart = () => {
        done = () => i2c.completeStart();
        alarm.schedule(I2C_STEP_NS);
      };
      i2c.onConnect = (address, mode) => transact({ kind: "i2c-start", addr7: address, read: mode === I2CMode.Read }, (ack) => i2c.completeConnect(ack));
      i2c.onWriteByte = (value) => transact({ kind: "i2c-write", byte: value }, (ack) => i2c.completeWrite(ack));
      i2c.onReadByte = (ack) => transact({ kind: "i2c-read", last: !ack }, (_ack, byte) => i2c.completeRead(byte));
      i2c.onStop = () => transact({ kind: "i2c-stop" }, () => i2c.completeStop());
    });
  }

  /** The instruction loop belongs to the host. Returns true when the budget asked to yield. */
  private execute(m: Machine, budget: SliceBudget): boolean {
    const { core } = m.mcu;
    const { clock } = m.sim;
    let steps = 0;
    let yielded = false;
    while (clock.nanos < m.target && this.stop === null && !this.halted) {
      if (core.waiting) {
        this.sleep(m);
        continue;
      }
      clock.tick(core.executeInstruction() * m.cycleNs);
      if (++steps % SLICE_STEPS === 0 && budget.shouldYield()) {
        yielded = true;
        break;
      }
    }
    this.stats.instructions += steps;
    this.stats.skippedNs = m.skip.skippedNs;
    return yielded;
  }

  /** WFI and WFE: nothing happens until the next alarm, so the clock jumps to it; with no alarm it jumps to the end of the slice. */
  private sleep(m: Machine): void {
    const { clock } = m.sim;
    const before = clock.nanos;
    let span = clock.nanosToNextAlarm;
    if (span <= 0) {
      clock.tick(0);
      if (!m.mcu.core.waiting) return;
      span = clock.nanosToNextAlarm;
      if (span <= 0) span = m.target - clock.nanos;
    }
    clock.tick(Math.min(span, m.target - clock.nanos));
    this.stats.sleptNs += clock.nanos - before;
  }
}

export function createRp2040Engine(o: Rp2040Options): Rp2040Engine {
  return new Rp2040EngineImpl(o);
}
