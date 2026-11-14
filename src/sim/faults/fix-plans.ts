import type { Rating } from "../../parts/generated/types.ts";
import { PROFILES, boardIdOf, type BoardProfile } from "../boards/profiles.ts";
import type { FindingFix, FixPlan, NetView, PinInfo } from "./types.ts";

const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82] as const;

/** What an indicator LED is sized for. */
export const LED_TARGET_AMPS = 0.01;
const DEFAULT_LED_VF = 2;
const MIN_HEADROOM_VOLTS = 0.3;

/** The smallest E12 value that is not below `ohms`, so the current stays at or under the target. */
export function e12Up(ohms: number): number {
  const exponent = Math.floor(Math.log10(ohms)) - 1;
  const mantissa = ohms / 10 ** exponent;
  const pick = E12.find((v) => v >= mantissa * 0.995) ?? 100;
  return Number((pick * 10 ** exponent).toPrecision(3));
}

/** The largest E12 value that is not above `ohms`. */
export function e12Down(ohms: number): number {
  const exponent = Math.floor(Math.log10(ohms)) - 1;
  const mantissa = ohms / 10 ** exponent;
  const pick = [...E12].reverse().find((v) => v <= mantissa * 1.005) ?? 10;
  return Number((pick * 10 ** exponent).toPrecision(3));
}

const RAIL_BY_PIN: readonly [RegExp, number][] = [
  [/^P?5V$/, 5],
  [/^P?3V3$/, 3.3],
  [/^VIN$/, 5],
];

export function profileOf(view: NetView, part: string): BoardProfile | undefined {
  const id = view.descriptor(part)?.id;
  return id === undefined ? undefined : (PROFILES as Record<string, BoardProfile | undefined>)[boardIdOf(id)];
}

/** The level a pin drives high: a board's logic level for an I/O pin, the rail of a supply pin. */
export function sourceVolts(view: NetView, p: PinInfo): number | undefined {
  if (view.isBoard(p.part) && p.cls !== "power") return profileOf(view, p.part)?.logicV;
  const nominal = p.net === null ? undefined : view.nominalVolts(p.net);
  return nominal ?? RAIL_BY_PIN.find(([pattern]) => pattern.test(p.pin))?.[1];
}

/** The volts a net is held at, from a source pin on it, when that is known. */
export function netVolts(view: NetView, net: string): number | undefined {
  const nominal = view.nominalVolts(net);
  if (nominal !== undefined) return nominal;
  for (const p of view.pinsOn(net)) {
    const volts = RAIL_BY_PIN.find(([pattern]) => pattern.test(p.pin))?.[1];
    if (volts !== undefined && view.isBoard(p.part)) return volts;
  }
  return undefined;
}

/** The power nets that something drives and whose level is known, lowest first. */
export function powerRails(view: NetView): { net: string; volts: number }[] {
  return view
    .nets()
    .filter((net) => view.netClass(net) === "power")
    .flatMap((net) => {
      const volts = netVolts(view, net);
      return volts === undefined ? [] : [{ net, volts }];
    })
    .sort((a, b) => a.volts - b.volts);
}

/** The rail a board's logic runs at, or the lowest one when the board is unknown. */
export function logicRail(view: NetView, board: string | undefined): string | undefined {
  const rails = powerRails(view);
  const want = board === undefined ? undefined : profileOf(view, board)?.logicV;
  return (rails.find((r) => r.volts === want) ?? rails[0])?.net;
}

/** The forward voltage of an LED from its colour parameter, as the descriptor rates it. */
export function ledVf(view: NetView, part: string): number {
  const d = view.descriptor(part);
  const color = view.param(part, "color");
  const rating = typeof color === "string" ? d?.ratings[`forward_voltage_${color}`] : undefined;
  const slot = rating?.simulation ?? rating?.manufacturer;
  const typ = slot && "typ" in slot ? slot.typ : slot && "value" in slot ? slot.value : undefined;
  return typeof typ === "number" ? typ : DEFAULT_LED_VF;
}

/** The resistor that holds an LED on `source` near the target current, or none when the supply has no room above the LED's drop. */
export function ledResistor(view: NetView, led: string, source: PinInfo): number | undefined {
  const volts = sourceVolts(view, source);
  if (volts === undefined) return undefined;
  const room = volts - ledVf(view, led);
  return room < MIN_HEADROOM_VOLTS ? undefined : e12Up(room / LED_TARGET_AMPS);
}

export const pinRef = (p: PinInfo): { part: string; pin: string } => ({ part: p.part, pin: p.pin });

export const fixOf = (kind: FindingFix["kind"], messageKey: string, args: FindingFix["args"], plan: FixPlan, safe: boolean): FindingFix => ({
  kind,
  messageKey,
  args,
  plan,
  safe,
});

/** The lowest voltage a rating gives, from the slot a model reads (the stated one when none does). */
export function lowestVolts(rating: Rating | undefined): number | undefined {
  if (rating?.measure !== "voltage") return undefined;
  const slot = rating.used_by_model === "none" ? rating.manufacturer : rating[rating.used_by_model];
  return slot?.unit === "V" ? (slot.min ?? slot.value) : undefined;
}

/**
 * The fix for an unconnected supply pin: join it to the rail its part needs. The part's own other supply pin names the
 * rail when it has one; otherwise the lowest rail that meets the part's minimum. It is safe only when there is no choice.
 */
export function supplyFix(view: NetView, part: string, pin: PinInfo): FindingFix[] {
  const rails = powerRails(view);
  const d = view.descriptor(part);
  const input = d?.power?.inputs?.find((i) => i.pins.includes(pin.pin));
  const min = input ? lowestVolts(d?.ratings[input.voltage]) : undefined;
  const wired = pinsOfPartNets(view, part).find((net) => view.netClass(net) === "power");
  const fit = rails.filter((r) => min === undefined || r.volts >= min);
  const net = wired ?? fit[0]?.net;
  if (net === undefined) return [];
  return [fixOf("wiring", "fix.connect-supply", { part, pin: pin.pin }, { t: "join", pin: pinRef(pin), net }, wired !== undefined || fit.length === 1)];
}

const pinsOfPartNets = (view: NetView, part: string): string[] =>
  (view.descriptor(part)?.pins ?? []).flatMap((q) => view.pin(part, q.id)?.net ?? []);

export const groundFix = (view: NetView, part: string, pin: PinInfo): FindingFix[] =>
  view.groundNet === "" ? [] : [fixOf("wiring", "fix.connect-ground", { part, pin: pin.pin }, { t: "join", pin: pinRef(pin), net: view.groundNet }, true)];
