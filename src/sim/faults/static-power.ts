import type { Descriptor } from "../../parts/descriptor.ts";
import { fixOf, ledResistor, ledVf, logicRail, lowestVolts, pinRef, sourceVolts } from "./fix-plans.ts";
import { evidence, isSupply, make, pinsOfPart, pinTarget } from "./static.ts";
import type { Finding, FindingFix, NetView, PinInfo, Rule } from "./types.ts";

const ledElement = (d: Descriptor | undefined) =>
  d?.behaviour.layers.map((l) => l.model).find((m) => m.kind === "element" && m.element === "led");

/** The anode and cathode pins of an LED, read from its element and checked against the pin polarity. */
function ledPins(view: NetView, part: string): { anode: PinInfo; cathode: PinInfo } | undefined {
  const model = ledElement(view.descriptor(part));
  if (model?.kind !== "element") return undefined;
  const anode = view.pin(part, model.terminals.anode ?? "");
  const cathode = view.pin(part, model.terminals.cathode ?? "");
  return anode?.polarity === "anode" && cathode?.polarity === "cathode" ? { anode, cathode } : undefined;
}

/** True when the LED module carries a resistor of its own: a resistance rating that its LED element does not use. */
function hasOwnResistor(d: Descriptor): boolean {
  const model = ledElement(d);
  const used = new Set(
    model?.kind === "element" ? Object.values(model.params ?? {}).map((v) => (typeof v === "object" ? v?.from_rating : undefined)) : [],
  );
  return Object.entries(d.ratings).some(([key, r]) => r?.measure === "resistance" && r.role === "characteristic" && !used.has(key));
}

/** A pin that can push current into an LED: a supply, a driver pin, or any digital I/O pin of a board. */
const isSource = (view: NetView, p: PinInfo): boolean =>
  isSupply(view, p) || p.type === "digital_out" || (p.type === "digital_io" && view.isBoard(p.part));

/** The resistor that goes between a source pin and the LED it drives, when the supply leaves room for one. */
export function ledSeriesFix(view: NetView, part: string): FindingFix[] {
  const led = ledPins(view, part);
  if (!led || led.anode.net === null) return [];
  const source = view.pinsOn(led.anode.net).find((p) => p.part !== part && isSource(view, p));
  const ohms = source && ledResistor(view, part, source);
  return ohms === undefined ? [] : [fixOf("value", "fix.led-series", { led: part, ohms }, { t: "series", at: pinRef(led.anode), ohms }, true)];
}

const ledSeries = make(
  { id: "rule:led-series@1", causeId: "led-no-series-resistor", symptomId: "led-burnt", needs: ["descriptors"] },
  ({ view, skipped }, finding) => {
    const out: Finding[] = [];
    for (const part of view.parts()) {
      const d = view.descriptor(part);
      if (!d) {
        skipped.add("rule:led-series@1", "undescribed-part");
        continue;
      }
      const led = ledPins(view, part);
      if (!led || led.anode.net === null || led.cathode.net === null) continue;
      if (hasOwnResistor(d)) {
        skipped.add("rule:led-series@1", "on-board-resistor");
        continue;
      }
      if (view.netClass(led.cathode.net) !== "ground") continue;
      const here = view.pinsOn(led.anode.net).filter((p) => p.part !== part);
      const source = here.find((p) => isSource(view, p));
      if (!source || here.some((p) => p.part !== source.part)) continue;
      out.push(
        finding({
          targets: [{ kind: "part", id: part }, pinTarget(source)],
          evidence: [evidence(`pin:${led.anode.part}.${led.anode.pin}`, `${source.part}.${source.pin} drives the LED with nothing in series`)],
          messageKey: "check.led-series",
          args: { led: part, source: `${source.part}.${source.pin}` },
          fixes: ledSeriesFix(view, part),
        }),
      );
    }
    return out;
  },
);

/** Below this the LED is barely visible, which is what a megohm resistor does to it. */
const DIM_AMPS = 0.0002;

const ledResistorHigh = make(
  { id: "rule:led-resistor-high@1", causeId: "wrong-value", symptomId: "led-dim", needs: ["descriptors"] },
  ({ view, skipped }, finding) => {
    const out: Finding[] = [];
    for (const part of view.parts()) {
      const d = view.descriptor(part);
      if (!d) {
        skipped.add("rule:led-resistor-high@1", "undescribed-part");
        continue;
      }
      const led = ledPins(view, part);
      if (!led || led.anode.net === null || led.cathode.net === null || hasOwnResistor(d) || view.netClass(led.cathode.net) !== "ground") continue;
      for (const r of view.resistorsOn(led.anode.net)) {
        const far = pinsOfPart(view, r.part).find((q) => q.pin !== r.pin);
        const source = far?.net == null ? undefined : view.pinsOn(far.net).find((p) => p.part !== r.part && isSource(view, p));
        const [ohms, volts] = [view.param(r.part, "ohms"), source && sourceVolts(view, source)];
        if (typeof ohms !== "number" || volts === undefined || source === undefined) continue;
        const amps = (volts - ledVf(view, part)) / ohms;
        if (!(amps > 0 && amps < DIM_AMPS)) continue;
        out.push(
          finding({
            targets: [{ kind: "part", id: part }, { kind: "part", id: r.part }],
            evidence: [evidence(`pin:${r.part}.${r.pin}`, `${Math.round(ohms)} ohm in series with the LED gives about ${(amps * 1000).toFixed(2)} mA`)],
            messageKey: "check.led-resistor-high",
            args: { led: part, resistor: r.part, ohms: Math.round(ohms) },
          }),
        );
      }
    }
    return out;
  },
);

/** The net and every net a series resistor away from it: what a pin on it can still push current into. */
function viaResistors(view: NetView, net: string): Set<string> {
  const seen = new Set([net]);
  for (const queue = [net]; queue.length > 0; ) {
    for (const r of view.resistorsOn(queue.pop()!)) {
      const far = pinsOfPart(view, r.part).find((q) => q.pin !== r.pin);
      if (far?.net != null && !seen.has(far.net)) {
        seen.add(far.net);
        queue.push(far.net);
      }
    }
  }
  return seen;
}

/** True when the nets, or those a resistor away, hold a pin of another part that is a source. */
const driven = (view: NetView, nets: Set<string>, part: string): boolean => [...nets].some((n) => view.pinsOn(n).some((p) => p.part !== part && isSource(view, p)));

const ledPolarity = make(
  { id: "rule:led-polarity@1", causeId: "led-reversed", symptomId: "led-dark", needs: ["descriptors"] },
  ({ view, skipped }, finding) => {
    const out: Finding[] = [];
    for (const part of view.parts()) {
      if (!view.descriptor(part)) {
        skipped.add("rule:led-polarity@1", "undescribed-part");
        continue;
      }
      const led = ledPins(view, part);
      const [a, k] = [led?.anode.net, led?.cathode.net];
      if (!led || a == null || k == null || a === k) continue;
      const [va, vk] = [view.nominalVolts(a), view.nominalVolts(k)];
      const [fromA, fromK] = [viaResistors(view, a), viaResistors(view, k)];
      const reversed =
        ([...fromA].some((n) => view.netClass(n) === "ground") && !driven(view, fromA, part) && driven(view, fromK, part)) ||
        (va !== undefined && vk !== undefined && va < vk);
      if (!reversed) continue;
      out.push(
        finding({
          targets: [{ kind: "part", id: part }, pinTarget(led.anode), pinTarget(led.cathode)],
          evidence: [evidence(`pin:${part}.${led.anode.pin}`, `anode on ${a}, cathode on ${k}`)],
          messageKey: "check.led-polarity",
          args: { led: part },
          fixes: [fixOf("wiring", "fix.led-turn", { led: part }, { t: "turn", part, a: led.anode.pin, b: led.cathode.pin }, true)],
        }),
      );
    }
    return out;
  },
);

const supplyPolarity = make(
  { id: "rule:supply-polarity@1", causeId: "reverse-polarity", symptomId: "part-hot", needs: ["descriptors"] },
  ({ view, skipped }, finding) => {
    const out: Finding[] = [];
    for (const part of view.parts()) {
      if (view.isBoard(part)) continue;
      if (!view.descriptor(part)) {
        skipped.add("rule:supply-polarity@1", "undescribed-part");
        continue;
      }
      const pins = pinsOfPart(view, part);
      const netClass = (p: PinInfo) => (p.net === null ? undefined : view.netClass(p.net));
      const supply = pins.find((p) => p.type === "power_in" && netClass(p) === "ground");
      const ground = pins.find((p) => p.cls === "ground" && netClass(p) === "power");
      const plus = pins.find((p) => p.polarity === "positive");
      const minus = pins.find((p) => p.polarity === "negative");
      const [vp, vm] = [plus?.net ? view.nominalVolts(plus.net) : undefined, minus?.net ? view.nominalVolts(minus.net) : undefined];
      const flipped = plus && minus && (vp !== undefined && vm !== undefined ? vp < vm : netClass(plus) === "ground" && netClass(minus) === "power");
      const culprits = supply && ground ? [supply, ground] : flipped ? [plus, minus] : [];
      const [first, second] = culprits;
      if (!first || !second) continue;
      out.push(
        finding({
          targets: [{ kind: "part", id: part }, pinTarget(first), pinTarget(second)],
          evidence: [evidence(`pin:${first.part}.${first.pin}`, `${first.pin} on net ${first.net}, ${second.pin} on net ${second.net}`)],
          messageKey: "check.supply-polarity",
          args: { part, pin: first.pin, other: second.pin },
          fixes: [fixOf("wiring", "fix.polarity-turn", { part, pin: first.pin, other: second.pin }, { t: "turn", part, a: first.pin, b: second.pin }, true)],
        }),
      );
    }
    return out;
  },
);

/** A net feeds a pin when a source is on it, or when something that could carry a supply to it is. */
const isFed = (view: NetView, pin: PinInfo, net: string): boolean =>
  view.netClass(net) === "power" ||
  view.pinsOn(net).some((p) => p !== pin && (p.cls === "passive" || p.type === "digital_out" || p.type === "digital_io"));

const partSupply = make(
  { id: "rule:part-supply@1", causeId: "part-not-powered", symptomId: "part-dead", needs: ["descriptors"] },
  ({ view, skipped }, finding) => {
    const out: Finding[] = [];
    for (const part of view.parts()) {
      if (view.isBoard(part)) continue;
      const d = view.descriptor(part);
      if (!d) {
        skipped.add("rule:part-supply@1", "undescribed-part");
        continue;
      }
      for (const pin of pinsOfPart(view, part)) {
        if (pin.type !== "power_in" || pin.net === null) continue;
        const targets = [pinTarget(pin), { kind: "net" as const, id: pin.net }];
        if (!isFed(view, pin, pin.net)) {
          out.push(
            finding({
              targets,
              evidence: [evidence(`net:${pin.net}`, "no supply on the net")],
              messageKey: "check.part-supply",
              args: { part, pin: pin.pin, net: pin.net },
            }),
          );
          continue;
        }
        const volts = view.nominalVolts(pin.net);
        if (volts === undefined) continue;
        const input = d.power?.inputs?.find((i) => i.pins.includes(pin.pin));
        const min = input ? lowestVolts(d.ratings[input.voltage]) : undefined;
        if (min === undefined) {
          skipped.add("rule:part-supply@1", "no-voltage-rating");
          continue;
        }
        if (volts >= min) continue;
        out.push(
          finding({
            targets,
            evidence: [evidence(`net:${pin.net}`, `${volts} V on the net, the part needs at least ${min} V`)],
            messageKey: "check.part-supply-low",
            args: { part, pin: pin.pin, net: pin.net, volts, min },
          }),
        );
      }
    }
    return out;
  },
);

const isMotor = (d: Descriptor | undefined): boolean =>
  d?.behaviour.layers.some((l) => l.model.kind === "element" && l.model.element === "motor") ?? false;

/** The pin of the board's I/O that a motor lead sits on with nothing in between. */
const motorGpio = (view: NetView, lead: PinInfo): PinInfo | undefined =>
  lead.net === null ? undefined : view.pinsOn(lead.net).find((p) => view.isBoard(p.part) && p.cls !== "power" && p.cls !== "ground" && (p.type === "digital_io" || p.type === "digital_out"));

function motorDriver(view: NetView, lead: PinInfo, other: PinInfo, gpio: PinInfo): FindingFix[] {
  const own = other.net !== null && view.netClass(other.net) === "power" ? other.net : undefined;
  const supply = own ?? logicRail(view, gpio.part);
  return supply === undefined || view.groundNet === ""
    ? [{ kind: "wiring", messageKey: "fix.motor-explain", args: { part: lead.part } }]
    : [fixOf("wiring", "fix.motor-driver", { part: lead.part, pin: gpio.pin }, { t: "driver", gpio: pinRef(gpio), motor: pinRef(lead), other: pinRef(other), ground: view.groundNet, supply }, false)];
}

const motorDirect = make(
  { id: "rule:motor-direct@1", causeId: "pin-overcurrent", symptomId: "pin-overloaded", needs: ["descriptors"] },
  ({ view }, finding) => {
    const out: Finding[] = [];
    for (const part of view.parts()) {
      if (!isMotor(view.descriptor(part))) continue;
      const leads = pinsOfPart(view, part);
      for (const lead of leads) {
        const gpio = motorGpio(view, lead);
        const other = leads.find((p) => p.pin !== lead.pin);
        if (!gpio || !other) continue;
        out.push(
          finding({
            targets: [{ kind: "part", id: part }, pinTarget(gpio)],
            evidence: [evidence(`pin:${gpio.part}.${gpio.pin}`, `${part} is wired straight to ${gpio.part}.${gpio.pin}`)],
            messageKey: "check.motor-direct",
            args: { part, pin: `${gpio.part}.${gpio.pin}` },
            fixes: motorDriver(view, lead, other, gpio),
          }),
        );
      }
    }
    return out;
  },
);

export const POWER_RULES: readonly Rule[] = [ledSeries, ledResistorHigh, ledPolarity, supplyPolarity, partSupply, motorDirect];
