import type { PartStateProvider } from "./types.ts";

/** Below this an LED gives no light you would see. */
const LIT_AMPS = 0.0005;

/**
 * An LED's light from the current the solver puts through each of its lamps, so a lamp lit from a battery or a
 * regulator shows as lit as well as one a board pin drives. `lamps` names the lamps of a part with more than one (an
 * RGB LED's channels, a traffic light's R, Y and G), and the tag lists the ones that are lit. A lamp a PWM pin drives
 * shows that duty as its brightness, and one on steady current shows full. With no solver there is no current to read,
 * and the board's pin levels decide as before.
 */
export const ledLamps =
  (lamps: readonly string[] = []): PartStateProvider =>
  (ctx) => {
    const ids = lamps.length ? lamps.map((lamp) => `${ctx.part.id}:${lamp}`) : [ctx.part.id];
    const amps = ids.map((id) => ctx.amps(id));
    if (amps.every((a) => a === null)) return null;
    const lit = lamps.filter((_, i) => (amps[i] ?? 0) > LIT_AMPS);
    const on = amps.some((a) => (a ?? 0) > LIT_AMPS);
    const pins = lamps.length ? lit : ["A", "K"];
    const pwm = pins.map((pin) => ctx.signal(pin)).find((sig) => sig && sig.hz !== null && sig.duty !== null && sig.duty < 1);
    const brightness = on ? pwm?.duty ?? 1 : 0;
    return { kind: "led", lit: on, brightness, provenance: "approximation", tier: "T0", ...(lamps.length ? { lamps: lit } : {}) };
  };
