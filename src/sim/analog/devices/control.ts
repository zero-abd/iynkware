import type { ElementId } from "../types.ts";

/**
 * What a control reads and sets. Nodes are the global ones `buildElements` gives; volts are from the last solve and
 * null before the first one.
 */
export interface ControlIO {
  volts(node: number): number | null;
  /** The duty of an averaged PWM drive on the node and the volts it switches to, or null when no PWM drives it. */
  pwm(node: number): { duty: number; vHighVolts: number } | null;
  /** Amps through an element, positive from its first node to its second. */
  amps(id: ElementId): number | null;
  /** The volts a source element is set to. */
  sourceVolts(id: ElementId): number | null;
  /** The shaft speed of a motor element. */
  rpm(id: ElementId): number | null;
  /** Sets number fields of an element. A change worth solving for marks its circuit to be solved again. */
  set(id: ElementId, fields: Readonly<Record<string, number>>): void;
}

/**
 * A part whose own elements follow what the circuit around it does: an H-bridge follows its inputs and its supply, an
 * encoder follows its shaft. `step` runs after every solve; `dtS` is the time since the last step, 0 when the same
 * instant is stepped again to settle.
 */
export interface Control {
  step(io: ControlIO, dtS: number): void;
  /** The longest step the solver may take while the part is in the circuit. */
  maxStepNs?: number;
}

/** Where an input sits between low and high: 0 or 1 for a steady level, the duty for a PWM drive. Floating reads `idle`. */
export function inputLevel(io: ControlIO, node: number | null, vil: number, vih: number, idle: 0 | 1 = 0): number {
  if (node === null) return idle;
  const pwm = io.pwm(node);
  if (pwm) return pwm.vHighVolts >= vih ? pwm.duty : 0;
  const v = io.volts(node);
  if (v === null) return idle;
  return Math.min(1, Math.max(0, (v - vil) / (vih - vil)));
}

export const across = (io: ControlIO, plus: number, minus: number): number => (io.volts(plus) ?? 0) - (io.volts(minus) ?? 0);
