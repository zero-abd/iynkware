import type { SimTime } from "../core/clock.ts";
import type { LiveAnalog } from "../analog/live.ts";
import { catalogueName } from "../analog/live.ts";
import type { Readout } from "../analog/readout.ts";
import type { DigitalLayer, PartState, PinSignal, SimNetlist, SimPart } from "../engine.ts";
import { PROVIDERS } from "./index.ts";
import type { DisplayView, PartStateCtx, PartStateProvider, ProviderTable, PwmDriver } from "./types.ts";

export interface PartStates {
  /** The state of every part that has a provider, as of `at`. */
  states(at: SimTime): PartState[];
}

interface Slot {
  part: SimPart;
  name: string;
  provide: PartStateProvider;
  memory: Record<string, number | undefined>;
}

const PWM_MODULE = "pca9685-module";
const PWM_CHANNELS = 16;

/** The signal on each net a PWM chip's channel drives: the nth module in the netlist is the nth chip on the bus. */
function chipChannels(net: SimNetlist, drivers: () => readonly PwmDriver[]): (netId: string) => PinSignal | null {
  const byNet = new Map<string, { module: number; channel: number }>();
  net.parts
    .filter((part) => catalogueName(part.descriptor) === PWM_MODULE)
    .forEach((part, module) => {
      for (let channel = 0; channel < PWM_CHANNELS; channel++) {
        const id = part.pins[`PWM${channel}`];
        if (id) byNet.set(id, { module, channel });
      }
    });
  return (netId) => {
    const at = byNet.get(netId);
    const chip = at ? drivers()[at.module] : undefined;
    if (!at || !chip) return null;
    const duty = chip.duty(at.channel);
    const periodNs = 1e9 / chip.hz;
    return {
      level: duty > 0 ? 1 : 0,
      duty,
      hz: chip.hz,
      servoUs: duty > 0 ? Math.round((duty * periodNs) / 1000) : null,
      highNs: duty > 0 ? duty * periodNs : null,
      periodNs,
      lastRiseAt: null,
      lastEdgeAt: null,
    };
  };
}

/** Looks each part of the netlist up in `providers`; a part with none is left to the digital layer. */
export function createPartStates(
  net: SimNetlist,
  src: { digital: DigitalLayer; live: LiveAnalog | null; pwmDrivers?: () => readonly PwmDriver[]; display?: () => DisplayView | null },
  providers: ProviderTable = PROVIDERS,
): PartStates {
  const slots: Slot[] = [];
  for (const part of net.parts) {
    const name = catalogueName(part.descriptor);
    const provide = providers[name];
    if (provide) slots.push({ part, name, provide, memory: {} });
  }
  const { digital, live } = src;
  const fromChip = src.pwmDrivers ? chipChannels(net, src.pwmDrivers) : () => null;
  const byNet = new Map<string, { slot: Slot; pin: string }[]>();
  for (const slot of slots) {
    for (const [pin, n] of Object.entries(slot.part.pins)) if (n != null) byNet.set(n, [...(byNet.get(n) ?? []), { slot, pin }]);
  }

  return {
    states(at) {
      let readout: Readout | undefined;
      const read = (): Readout | null => (live ? (readout ??= live.readout()) : null);
      const contexts = new Map<Slot, PartStateCtx>();
      const ctxOf = (slot: Slot): PartStateCtx => {
        const made = contexts.get(slot);
        if (made) return made;
        const { part, memory } = slot;
        const netOf = (pin: string): string | null => part.pins[pin] ?? null;
        const volts = (pin: string): number | null => {
          const n = netOf(pin);
          return n === null || !live ? null : live.netVolts(n);
        };
        const ctx: PartStateCtx = {
          part,
          at,
          memory,
          net: netOf,
          signal: (pin) => {
            const n = netOf(pin);
            if (n === null) return null;
            return fromChip(n) ?? (digital.signalOf ? digital.signalOf(n) : null);
          },
          edges: (pin, after) => {
            const n = netOf(pin);
            return n === null || !digital.edgesOf ? [] : digital.edgesOf(n, after);
          },
          peers: (pin) => {
            const n = netOf(pin);
            return (n === null ? [] : byNet.get(n) ?? [])
              .filter((other) => other.slot !== slot)
              .map((other) => ({ name: other.slot.name, pin: other.pin, ctx: ctxOf(other.slot) }));
          },
          volts,
          across: (plus, minus) => {
            const [a, b] = [volts(plus), volts(minus)];
            return a === null || b === null ? null : a - b;
          },
          amps: (element = part.id) => read()?.amps.get(element) ?? null,
          rpm: (element = part.id) => read()?.rpm.get(element) ?? null,
          pinAmps: (pin) => read()?.pinAmps.get(part.id)?.[pin] ?? null,
          health: () => read()?.parts.get(part.id)?.state ?? null,
          display: () => src.display?.() ?? null,
        };
        contexts.set(slot, ctx);
        return ctx;
      };
      const out: PartState[] = [];
      for (const slot of slots) {
        try {
          const body = slot.provide(ctxOf(slot));
          if (body) out.push({ part: slot.part.id, ...body } as PartState);
        } catch {
          // a provider that throws leaves its part to the digital layer; the frame still goes out
        }
      }
      return out;
    },
  };
}
