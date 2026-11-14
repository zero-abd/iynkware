import { nsToCycles } from "../core/clock.ts";
import { RANGER_DEFAULT_CM, rangerEcho } from "../devices/hc-sr04.ts";
import type { AvrAdapter, AvrContext } from "./avr8js.ts";
import { STATE_HIGH, STATE_LOW, UNO_PIN_MAP } from "./avr8js-pins.ts";

export interface RangerWiring {
  part: string;
  /** Header names of the board pins the TRIG and ECHO leads are on ("D8"). */
  trig: string;
  echo: string;
}

const US_TO_NS = 1000;

/**
 * HC-SR04 modules on the AVR pins. A TRIG pulse the module accepts is answered with an ECHO pulse, both timed on the
 * CPU's own cycle counter, so `pulseIn` measures exactly what the module model says. A `distance` event with the part id
 * moves the obstacle; the distance survives a reset.
 */
export function createRangerAdapter(rangers: readonly RangerWiring[]): AvrAdapter {
  const distances = new Map(rangers.map((r) => [r.part, RANGER_DEFAULT_CM]));

  return {
    id: "avr-rangers",
    attach(ctx) {
      for (const r of rangers) {
        const trig = UNO_PIN_MAP[r.trig];
        const echo = UNO_PIN_MAP[r.echo];
        if (trig && echo) wire(ctx, trig, echo, () => distances.get(r.part) ?? RANGER_DEFAULT_CM);
      }
    },
    onEvent(e) {
      const { target, value } = e.payload as { target: string; value: unknown };
      if (e.kind === "distance" && distances.has(target) && typeof value === "number") distances.set(target, value);
    },
  };
}

function wire(ctx: AvrContext, trig: { port: "B" | "C" | "D"; bit: number }, echo: typeof trig, distanceCm: () => number): void {
  const { cpu, ports, clock } = ctx;
  const cycles = (us: number): number => nsToCycles(Math.round(us * US_TO_NS), clock);
  const setEcho = (high: boolean): void => ports[echo.port].setPin(echo.bit, high);
  let risingAt: number | null = null;

  setEcho(false);
  ports[trig.port].addListener(() => {
    const state = ports[trig.port].pinState(trig.bit);
    if (state === STATE_HIGH) {
      risingAt ??= cpu.cycles;
      return;
    }
    const started = risingAt;
    risingAt = null;
    if (state !== STATE_LOW || started === null) return;
    const pulse = rangerEcho(ctx.cyclesToNs(cpu.cycles - started) / US_TO_NS, distanceCm());
    if (!pulse) return;
    cpu.addClockEvent(() => {
      setEcho(true);
      cpu.addClockEvent(() => setEcho(false), cycles(pulse.widthUs));
    }, cycles(pulse.delayUs));
  });
}
