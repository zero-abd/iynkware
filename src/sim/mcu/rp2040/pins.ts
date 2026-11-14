import type { RP2040 } from "rp2040js";
import type { Rp2040js } from "./lib.ts";

const PIN_COUNT = 30;
const FUNCTION_PWM = 4;
const PWM_ENABLE = 1;
const PWM_PHASE_CORRECT = 1 << 1;
const PWM_A_INVERT = 1 << 2;
const PWM_B_INVERT = 1 << 3;
const SLICES = 8;
/** Steady levels under this share of a period are shown as a steady level, not a PWM wave. */
const STEADY = 1e-3;

type Level = 0 | 1 | "Z";

export interface PinChange {
  pin: string;
  level: Level;
  duty?: number;
  hz?: number;
}

export const pinName = (index: number): string => `GP${index}`;

export function pinIndex(name: string): number | undefined {
  const match = /^GP(\d{1,2})$/.exec(name);
  const index = match ? Number(match[1]) : NaN;
  return index < PIN_COUNT ? index : undefined;
}

export interface Pins {
  /** What the circuit puts on a pin: a level, or null when nothing drives it. */
  setExternal(index: number, level: 0 | 1 | null): void;
  /** Reports the PWM output of every pin that has one; called when a slice of the run has ended. */
  samplePwm(): void;
  read(index: number): { mode: string; level: 0 | 1; duty?: number; hz?: number };
}

interface Wave {
  level: 0 | 1;
  duty?: number;
  hz?: number;
}

/**
 * Connects the 30 GPIO pins of the chip to the circuit. A pin the firmware drives is reported as 0 or 1, one it
 * releases as Z. A pin on the PWM function is reported by its duty and frequency from the slice's registers instead of
 * edge by edge. An input reads what the circuit puts on it, or its pull resistor's level when nothing does.
 */
export function attachPins(lib: Rp2040js, mcu: RP2040, o: { report(change: PinChange): void; edge(): void }): Pins {
  const { GPIOPinState: State } = lib;
  const external: (0 | 1 | null)[] = Array(PIN_COUNT).fill(null);
  const shown: Level[] = Array(PIN_COUNT).fill("Z");
  const waves: (Wave | null)[] = Array(PIN_COUNT).fill(null);
  const applied: boolean[] = Array(PIN_COUNT).fill(false);

  function refreshInput(index: number): void {
    const state = mcu.gpio[index].value;
    let high: boolean;
    if (state === State.Low || state === State.High) high = state === State.High;
    else if (state === State.InputBusKeeper) high = applied[index];
    else high = external[index] === null ? state === State.InputPullUp : external[index] === 1;
    if (applied[index] === high) return;
    applied[index] = high;
    mcu.gpio[index].setInputValue(high);
  }

  function onState(index: number): void {
    refreshInput(index);
    const gpio = mcu.gpio[index];
    if (gpio.functionSelect === FUNCTION_PWM) return;
    const state = gpio.value;
    const level: Level = state === State.Low ? 0 : state === State.High ? 1 : "Z";
    if (shown[index] === level && waves[index] === null) return;
    shown[index] = level;
    waves[index] = null;
    o.report({ pin: pinName(index), level });
    o.edge();
  }

  function waveOf(index: number): Wave | "Z" {
    const gpio = mcu.gpio[index];
    if (!gpio.outputEnable) return "Z";
    const channel = mcu.pwm.channels[(index >> 1) % SLICES];
    const b = (index & 1) === 1;
    const steady = (high: boolean): Wave => ({ level: high ? 1 : 0 });
    if (!(channel.csr & PWM_ENABLE)) return steady(false);
    const counts = channel.top + 1;
    let duty = Math.min((b ? channel.cc >>> 16 : channel.cc & 0xffff) / counts, 1);
    if (channel.csr & (b ? PWM_B_INVERT : PWM_A_INVERT)) duty = 1 - duty;
    if (duty < STEADY) return steady(false);
    if (duty > 1 - STEADY) return steady(true);
    const fraction = channel.div & 0xf;
    const divider = ((channel.div >> 4) & 0xff || 256) + fraction / 16;
    const hz = mcu.pwm.clockFreq / (divider * counts * (channel.csr & PWM_PHASE_CORRECT ? 2 : 1));
    return { level: gpio.value === State.High ? 1 : 0, duty, hz };
  }

  mcu.gpio.forEach((gpio, index) => {
    gpio.addListener(() => onState(index));
  });

  return {
    setExternal(index, level) {
      external[index] = level;
      refreshInput(index);
    },
    samplePwm() {
      for (let index = 0; index < PIN_COUNT; index++) {
        if (mcu.gpio[index].functionSelect !== FUNCTION_PWM) continue;
        const wave = waveOf(index);
        const before = waves[index];
        if (wave === "Z") {
          if (shown[index] === "Z") continue;
          shown[index] = "Z";
          waves[index] = null;
          o.report({ pin: pinName(index), level: "Z" });
          continue;
        }
        const same = before !== null && before.level === wave.level && before.duty === wave.duty && before.hz === wave.hz;
        if (same || (before === null && shown[index] === wave.level && wave.duty === undefined)) continue;
        shown[index] = wave.level;
        waves[index] = wave;
        o.report({ pin: pinName(index), level: wave.level, ...(wave.duty === undefined ? {} : { duty: wave.duty, hz: wave.hz }) });
        o.edge();
      }
    },
    read(index) {
      const gpio = mcu.gpio[index];
      const wave = waves[index];
      const level: 0 | 1 = applied[index] ? 1 : 0;
      if (gpio.outputEnable) return { mode: wave?.duty === undefined ? "output" : "pwm", level, ...(wave?.duty === undefined ? {} : { duty: wave.duty, hz: wave.hz }) };
      return { mode: gpio.value === State.InputPullUp ? "input_pullup" : gpio.value === State.InputPullDown ? "input_pulldown" : "input", level };
    },
  };
}
