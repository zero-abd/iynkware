import type { RP2040 } from "rp2040js";
import type { Rp2040js } from "./lib.ts";

type Clock = InstanceType<Rp2040js["Simulator"]>["clock"];

/** The key of the TIMER block in `RP2040.peripherals`. */
const TIMER = 0x40054;
const TIMER_TIME_REGISTERS: ReadonlySet<number> = new Set([0x08, 0x0c, 0x24, 0x28]);
/** Reads of the timer this close together, in CPU cycles, are one wait loop. */
const GAP_CYCLES = 40;
const STREAK = 16;
/** After a skip the next one comes after this many more reads. */
const STREAK_AFTER_SKIP = 12;
/** Waits shorter than this run instruction by instruction, so short delays stay exact. */
const EXACT_NS = 500_000;
const MAX_SKIP_NS = 50_000;
/** A skip is at most this share of the wait seen so far. */
const SHARE = 16;
const MIN_SKIP_NS = 1000;

export interface PollSkip {
  /** Skipped time so far, in nanoseconds. */
  readonly skippedNs: number;
}

/**
 * Firmware that waits with `while (time_us_32() - start < n)` reads the timer every few cycles and does nothing else.
 * Once such a wait has lasted half a millisecond the clock jumps ahead in steps of at most 50 microseconds, never past the
 * next alarm or the end of the slice, so the wait ends within 50 microseconds of where it would have. A wait is
 * left alone as soon as something the circuit can see happens (`activity` changes), so loops that do work between
 * reads of the timer run every instruction.
 */
export function installPollSkip(mcu: RP2040, clock: Clock, o: { activity(): number; spanNs(): number }): PollSkip {
  const timer = mcu.peripherals[TIMER];
  const read = timer.readUint32.bind(timer);
  const state = { skippedNs: 0 };
  let lastCycles = -Infinity;
  let streak = 0;
  let since = 0;
  let seen = -1;

  timer.readUint32 = (offset: number): number => {
    if (TIMER_TIME_REGISTERS.has(offset)) {
      const cycles = mcu.core.cycles;
      const activity = o.activity();
      if (cycles - lastCycles > GAP_CYCLES || activity !== seen) {
        streak = 0;
        since = clock.nanos;
        seen = activity;
      } else if (++streak >= STREAK && clock.nanos - since >= EXACT_NS) {
        const ahead = clock.nanosToNextAlarm;
        const skip = Math.min(MAX_SKIP_NS, (clock.nanos - since) / SHARE, o.spanNs(), ahead > 0 ? ahead : Infinity);
        if (skip >= MIN_SKIP_NS) {
          clock.tick(skip);
          state.skippedNs += skip;
          streak = STREAK_AFTER_SKIP;
        }
      }
      lastCycles = cycles;
    }
    return read(offset);
  };

  return {
    get skippedNs() {
      return state.skippedNs;
    },
  };
}
