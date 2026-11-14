import type { Descriptor } from "../../parts/descriptor.ts";
import type { Evidence } from "../../project/diagnosis.ts";
import { fixOf, groundFix, logicRail, pinRef, supplyFix } from "./fix-plans.ts";
import type { CodeFacts, Finding, FindingFix, NetView, PinInfo, ProblemTarget, Rule, RuleInput } from "./types.ts";

export const evidence = (ref: string, value: string): Evidence => ({
  kind: "state",
  ref,
  at: 0,
  value,
  provenance: "computed",
  tier: "T0",
  modelIds: [],
});

export const pinTarget = (p: PinInfo): ProblemTarget => ({ kind: "pin", id: p.part, pin: p.pin });

export const pinsOfPart = (view: NetView, part: string): PinInfo[] =>
  (view.descriptor(part)?.pins ?? []).flatMap((p) => view.pin(part, p.id) ?? []);

const isSwitch = (d: Descriptor | undefined): boolean =>
  d?.behaviour.layers.some((l) => l.model.kind === "element" && l.model.element === "button") ?? false;

const shortGroup = (d: Descriptor | undefined, pin: string): readonly string[] | undefined =>
  d?.groups?.find((g) => g.kind === "internal-short" && g.pins.includes(pin))?.pins;

/** Pins that an internal short joins are one contact and share a key. */
const contactKey = (view: NetView, p: PinInfo): string => {
  const group = shortGroup(view.descriptor(p.part), p.pin);
  return `${p.part}/${group ? group.join("+") : p.pin}`;
};

const sameContact = (view: NetView, a: PinInfo, b: PinInfo): boolean => a.part === b.part && contactKey(view, a) === contactKey(view, b);

const isRail = (view: NetView, net: string | null): boolean => {
  const cls = net === null ? undefined : view.netClass(net);
  return cls === "power" || cls === "ground";
};

/** Code names a pin as `13`, `D13` or `A0`; the board names it `D13` or `A0`. */
const samePin = (codePin: string, boardPin: string): boolean => {
  const code = codePin.toUpperCase();
  const board = boardPin.toUpperCase();
  return code === board || `D${code}` === board;
};

const boardPins = (view: NetView, codePin: string): PinInfo[] =>
  view
    .parts()
    .filter((part) => view.isBoard(part))
    .flatMap((part) => pinsOfPart(view, part).filter((p) => samePin(codePin, p.pin)));

const modesOf = (code: CodeFacts | undefined, p: PinInfo): string[] =>
  (code?.pinModes ?? []).filter((f) => samePin(f.value.pin, p.pin)).map((f) => f.value.mode);

/** A supply pin on a rail that a power_io pin of the same part can also feed passes on what feeds the rail. */
const railTap = (view: NetView, p: PinInfo): boolean =>
  p.type === "power_out" && (shortGroup(view.descriptor(p.part), p.pin) ?? []).some((pin) => view.descriptor(p.part)?.pins.find((q) => q.id === pin)?.type === "power_io");

const isDriver = (view: NetView, p: PinInfo, code?: CodeFacts): boolean => {
  if (p.type === "digital_out" || (p.type === "power_out" && p.cls !== "ground" && !railTap(view, p))) return true;
  if (p.type !== "digital_io" || !view.isBoard(p.part)) return false;
  const modes = modesOf(code, p);
  return modes.length > 0 && modes.every((m) => m === "OUTPUT");
};

export const isSupply = (view: NetView, p: PinInfo): boolean =>
  p.cls === "power" && (p.type === "power_out" || (p.type === "power_io" && view.isBoard(p.part)));

export function make(
  def: Pick<Rule, "id" | "causeId" | "symptomId" | "needs">,
  check: (input: RuleInput, finding: (f: Omit<Finding, "ruleId" | "causeId" | "symptomId" | "severity">) => Finding) => Finding[],
): Rule {
  const finding = (f: Omit<Finding, "ruleId" | "causeId" | "symptomId" | "severity">): Finding => ({
    ruleId: def.id,
    causeId: def.causeId,
    symptomId: def.symptomId,
    severity: "error",
    ...f,
  });
  return { ...def, layer: "static", enabled: true, check: (input) => check(input, finding) };
}

/** An input that a pull resistor or a fitted jumper cap holds at a level, so leaving it unwired is a choice, not a fault. */
function heldWhenOpen(view: NetView, part: string, d: Descriptor, pin: string): boolean {
  const pull = d.pins.find((p) => p.id === pin)?.pull;
  if (pull && !(pull.unless_parameter && view.param(part, pull.unless_parameter) === true)) return true;
  return (d.parameters ?? []).some((q) => q.kind === "build-option" && q.type === "boolean" && q.affects?.includes(pin) && view.param(part, q.id) === true);
}

const openPin = make(
  { id: "rule:open-pin@1", causeId: "open-connection", symptomId: "part-dead", needs: ["descriptors"] },
  ({ view, skipped }, finding) => {
    const out: Finding[] = [];
    for (const part of view.parts()) {
      if (view.isBoard(part)) continue;
      const d = view.descriptor(part);
      if (!d) {
        skipped.add("rule:open-pin@1", "undescribed-part");
        continue;
      }
      const pins = pinsOfPart(view, part);
      if (pins.every((p) => p.net === null) || pins.every((p) => p.net !== null)) continue;
      const onBus = new Set(
        (d.protocols ?? []).filter((q) => q.status === "modelled").flatMap((q) => Object.values(q.pins)),
      );
      for (const p of pins) {
        if (p.net !== null) continue;
        if (!["power_in", "digital_in", "analog_in"].includes(p.type ?? "") && !onBus.has(p.pin)) continue;
        if (heldWhenOpen(view, part, d, p.pin)) continue;
        out.push(
          finding({
            targets: [pinTarget(p)],
            evidence: [evidence(`pin:${p.part}.${p.pin}`, "not connected")],
            messageKey: "check.open-pin",
            args: { part: p.part, pin: p.pin },
            fixes: p.type === "power_in" ? supplyFix(view, part, p) : [],
          }),
        );
      }
    }
    return out;
  },
);

const missingGround = make(
  { id: "rule:missing-ground@1", causeId: "missing-ground", symptomId: "part-dead", needs: ["descriptors"] },
  ({ view, skipped }, finding) => {
    const out: Finding[] = [];
    if (view.groundNet === "") {
      skipped.add("rule:missing-ground@1", "no-ground-net");
      return out;
    }
    // a battery or other source with no supply input of its own sets the ground of the circuit it feeds
    const grounded = new Set([view.groundNet]);
    for (const part of view.parts()) {
      const pins = pinsOfPart(view, part);
      if (!pins.some((p) => p.type === "power_out") || pins.some((p) => p.type === "power_in")) continue;
      for (const p of pins) if (p.cls === "ground" && p.net !== null) grounded.add(p.net);
    }
    for (const part of view.parts()) {
      if (view.isBoard(part)) continue;
      if (!view.descriptor(part)) {
        skipped.add("rule:missing-ground@1", "undescribed-part");
        continue;
      }
      const pins = pinsOfPart(view, part);
      const grounds = pins.filter((p) => p.cls === "ground");
      const first = grounds[0];
      if (!first || grounds.some((p) => p.net !== null && grounded.has(p.net))) continue;
      if (!pins.some((p) => p.cls === "power" && p.net !== null)) continue;
      out.push(
        finding({
          targets: [pinTarget(first)],
          evidence: [evidence(`pin:${first.part}.${first.pin}`, first.net === null ? "not connected" : `net ${first.net} does not reach ground`)],
          messageKey: "check.missing-ground",
          args: { part: first.part, pin: first.pin },
          fixes: first.net === null ? groundFix(view, part, first) : [],
        }),
      );
    }
    return out;
  },
);

const railShort = make(
  { id: "rule:rail-short@1", causeId: "supply-shorted-to-ground", symptomId: "supply-collapses", needs: ["descriptors"] },
  ({ view }, finding) => {
    const out: Finding[] = [];
    for (const net of view.nets()) {
      const pins = view.pinsOn(net);
      const supplies = pins.filter((p) => isSupply(view, p));
      const first = supplies[0];
      const grounded = net === view.groundNet || pins.some((p) => p.cls === "ground" && supplies.some((s) => s.part === p.part));
      if (!first || !grounded) continue;
      out.push(
        finding({
          targets: [{ kind: "net", id: net }, ...supplies.map(pinTarget)],
          evidence: [evidence(`net:${net}`, "supply and ground on one net")],
          messageKey: "check.rail-short",
          args: { net, part: first.part, pin: first.pin },
          fixes: [fixOf("wiring", "fix.cut-short", { net, pins: supplies.map((p) => `${p.part}.${p.pin}`).join(", ") }, { t: "cut", pins: supplies.map(pinRef) }, false)],
        }),
      );
    }
    return out;
  },
);

const contention = make(
  { id: "rule:contention@1", causeId: "output-contention", symptomId: "pin-level-wrong", needs: ["descriptors"] },
  ({ view, code }, finding) => {
    const out: Finding[] = [];
    for (const net of view.nets()) {
      const drivers = view.pinsOn(net).filter((p) => isDriver(view, p, code));
      if (new Set(drivers.map((p) => contactKey(view, p))).size < 2) continue;
      out.push(
        finding({
          targets: [{ kind: "net", id: net }, ...drivers.map(pinTarget)],
          evidence: [evidence(`net:${net}`, `${drivers.length} outputs on one net`)],
          messageKey: "check.contention",
          args: { net, pins: drivers.map((p) => `${p.part}.${p.pin}`).join(", ") },
        }),
      );
    }
    return out;
  },
);

/** The one switch contact on `pin`'s net, and the pins of the same switch on its other side. */
function lonelySwitch(view: NetView, pin: PinInfo): { contact: PinInfo; far: PinInfo[] } | undefined {
  if (pin.net === null) return undefined;
  const others = view.pinsOn(pin.net).filter((p) => !sameContact(view, p, pin));
  const contacts = others.filter((p) => isSwitch(view.descriptor(p.part)));
  const contact = contacts[0];
  if (!contact || contacts.some((p) => !sameContact(view, p, contact))) return undefined;
  return { contact, far: pinsOfPart(view, contact.part).filter((p) => !sameContact(view, p, contact)) };
}

/** A pin the code reads, with the code's reasons to leave it alone already applied. */
function readInputs(view: NetView, code: CodeFacts): PinInfo[] {
  const seen = new Set<string>();
  const out: PinInfo[] = [];
  for (const fact of code.pinReads) {
    for (const p of boardPins(view, fact.value.pin)) {
      const modes = modesOf(code, p);
      const key = `${p.part}/${p.pin}`;
      if (seen.has(key) || modes.includes("INPUT_PULLUP") || modes.includes("OUTPUT")) continue;
      if (view.descriptor(p.part)?.pins.find((q) => q.id === p.pin)?.pull) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

const PULL_OHMS = 10_000;

const pullResistor = (view: NetView, pin: PinInfo, to: "up" | "down", key: string, safe: boolean): FindingFix[] => {
  const rail = to === "up" ? logicRail(view, pin.part) : view.groundNet;
  return pin.net === null || !rail ? [] : [fixOf("wiring", key, { part: pin.part, pin: pin.pin, ohms: PULL_OHMS }, { t: "to-rail", net: pin.net, rail, ohms: PULL_OHMS, near: pin.part }, safe)];
};

/** The code change that gives a pin the internal pull-up: the mode word of its `pinMode(..., INPUT)`, or a new `pinMode` line at the top of setup. */
function pullupCode(code: CodeFacts, pin: PinInfo): FindingFix[] {
  const modes = code.pinModes.filter((f) => samePin(f.value.pin, pin.pin));
  const read = code.pinReads.find((f) => samePin(f.value.pin, pin.pin));
  const args = { pin: pin.pin };
  const mode = modes.find((f) => f.value.mode === "INPUT" && f.value.modeSpan);
  if (mode?.value.modeSpan) {
    const { pos, len } = mode.value.modeSpan;
    return [fixOf("code", "fix.pullup-code", args, { t: "edit", edits: [{ file: mode.file, pos, del: len, ins: "INPUT_PULLUP" }] }, true)];
  }
  if (modes.length > 0 || !read || !code.setup) return [];
  const { file, pos, indent } = code.setup;
  return [fixOf("code", "fix.pullup-code", args, { t: "edit", edits: [{ file, pos, del: 0, ins: `\n${indent}pinMode(${read.value.pin}, INPUT_PULLUP);` }] }, true)];
}

const floatingInput = make(
  { id: "rule:floating-input@1", causeId: "floating-input", symptomId: "reading-erratic", needs: ["descriptors", "code"] },
  ({ view, code }, finding) => {
    const out: Finding[] = [];
    if (!code) return out;
    for (const p of readInputs(view, code)) {
      if (!isFloating(view, p, code)) continue;
      out.push(
        finding({
          targets: [pinTarget(p), ...(p.net === null ? [] : [{ kind: "net" as const, id: p.net }])],
          evidence: [evidence(`pin:${p.part}.${p.pin}`, "nothing holds the pin high or low")],
          messageKey: "check.floating-input",
          args: { part: p.part, pin: p.pin },
          fixes: pullResistor(view, p, "down", "fix.floating-pulldown", false),
        }),
      );
    }
    return out;
  },
);

function isFloating(view: NetView, pin: PinInfo, code: CodeFacts): boolean {
  if (pin.net === null) return true;
  if (isRail(view, pin.net) || view.resistorsOn(pin.net).length > 0) return false;
  const others = view.pinsOn(pin.net).filter((p) => !sameContact(view, p, pin));
  if (others.length === 0) return true;
  if (lonelySwitch(view, pin)?.far.some((p) => isRail(view, p.net))) return false;
  return !others.some(
    (p) =>
      isDriver(view, p, code) ||
      p.type === "analog_out" ||
      view.descriptor(p.part)?.pins.find((q) => q.id === p.pin)?.pull !== undefined ||
      (!isSwitch(view.descriptor(p.part)) && pinsOfPart(view, p.part).some((q) => !sameContact(view, q, p) && isRail(view, q.net))),
  );
}

const buttonNoPull = make(
  { id: "rule:button-no-pull@1", causeId: "button-no-pulldown", symptomId: "button-erratic", needs: ["descriptors", "code"] },
  ({ view, code }, finding) => {
    const out: Finding[] = [];
    if (!code) return out;
    for (const pin of readInputs(view, code)) {
      const found = lonelySwitch(view, pin);
      const rail = found?.far.map((p) => (p.net === null ? undefined : view.netClass(p.net))).find((c) => c === "power" || c === "ground");
      if (!found || !rail || pin.net === null) continue;
      const opposite = rail === "power" ? "ground" : "power";
      const pulled = view.resistorsOn(pin.net).some((r) =>
        pinsOfPart(view, r.part).some((q) => q.pin !== r.pin && q.net !== null && view.netClass(q.net) === opposite),
      );
      if (pulled) continue;
      out.push(
        finding({
          targets: [{ kind: "part", id: found.contact.part }, pinTarget(pin)],
          evidence: [evidence(`pin:${pin.part}.${pin.pin}`, `switch to ${rail}, no resistor to ${opposite}`)],
          messageKey: "check.button-no-pull",
          args: { switchPart: found.contact.part, part: pin.part, pin: pin.pin, rail },
          fixes:
            rail === "ground"
              ? [...pullupCode(code, pin), ...pullResistor(view, pin, "up", "fix.button-pullup", true)]
              : pullResistor(view, pin, "down", "fix.button-pulldown", true),
        }),
      );
    }
    return out;
  },
);

/** The six rules that read only the wiring, and the code when there is one. */
export const STATIC_RULES: readonly Rule[] = [openPin, missingGround, railShort, contention, floatingInput, buttonNoPull];
