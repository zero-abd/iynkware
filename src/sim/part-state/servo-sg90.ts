import type { SimTime } from "../core/clock.ts";
import type { PinSignal } from "../engine.ts";
import type { PartStateProvider } from "./types.ts";

/** The Arduino Servo library's span for write(0) to write(180). A real SG90 starts nearer 500 us. */
const US_MIN = 544;
const US_MAX = 2400;
const DEG_MAX = 180;
/** Pulses outside this are not a servo signal; the arm pushes its stop. */
const US_LOW = 400;
const US_HIGH = 2700;
/** Supply the servo needs to move (the descriptor's `min_supply`). */
const MIN_SUPPLY_V = 4;
const TURN_DEG_PER_S = 600;
const START_DEG = 90;
/** Without a rising edge for this long the pulse train has stopped and the arm stays where it is. */
const STALE_NS = 100e6;

const degOf = (us: number): number => Math.min(DEG_MAX, Math.max(0, ((us - US_MIN) / (US_MAX - US_MIN)) * DEG_MAX));
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The pulse width on SIG in us: what the interpreter says, or the last high pulse of a firmware run's edges. */
function pulseUs(signal: PinSignal, at: SimTime): number | null {
  if (signal.servoUs !== null) return signal.servoUs;
  const fresh = signal.lastRiseAt !== null && at - signal.lastRiseAt <= STALE_NS;
  return fresh && signal.highNs !== null && signal.highNs > 0 ? signal.highNs / 1000 : null;
}

export const servoSg90: PartStateProvider = (ctx) => {
  const supply = ctx.across("VPLUS", "GND");
  const powered = supply !== null && supply >= MIN_SUPPLY_V;
  const paramAngle = ctx.part.params.angle;
  const held = ctx.memory.angle ?? (typeof paramAngle === "number" ? paramAngle : START_DEG);
  const last = ctx.memory.at ?? ctx.at;
  ctx.memory.at = ctx.at;

  const signal = ctx.signal("SIG");
  const us = signal ? pulseUs(signal, ctx.at) : null;
  let angle = held;
  if (powered && us !== null && us >= US_LOW && us <= US_HIGH) {
    const reach = (TURN_DEG_PER_S * Math.max(0, ctx.at - last)) / 1e9;
    const target = degOf(us);
    angle = Math.abs(target - held) <= reach ? target : held + Math.sign(target - held) * reach;
  }
  ctx.memory.angle = angle;
  return { kind: "servo", angle: round1(angle), powered };
};
