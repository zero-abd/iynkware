import type { LossItem } from "@/export/loss";
import type { Messages } from "@/i18n/namespaces";
import type { MessageKey, Translate } from "@/i18n/translate";

type Studio = Messages["studio"];
type T = Translate<Studio>;

const key = (path: string) => path as MessageKey<Studio>;

const SIMPLE: Record<string, string> = {
  "wokwi.pin-dropped": "interop.loss.pin",
  "wokwi.connection-skipped": "interop.loss.malformed",
  "wokwi.board-added": "interop.loss.boardAdded",
  "wokwi.libraries": "interop.loss.libraries",
  "wokwi.serial-monitor": "interop.loss.serial",
  "ino.multi-file-merged": "interop.loss.merged",
  "spice.not-modelled": "interop.loss.spiceNotModelled",
  "spice.board-pins-open": "interop.loss.spiceFloating",
  "spice.instruments-left-out": "interop.loss.spiceInstruments",
  "spice.source-limit": "interop.loss.spiceLimit",
  "spice.slew-left-out": "interop.loss.spiceSlew",
  "spice.phase-left-out": "interop.loss.spicePhase",
  "spice.nothing-to-export": "interop.loss.spiceNothing",
  "kicad.no-footprint": "interop.loss.kicadNoFootprint",
  "kicad.no-nets": "interop.loss.kicadNoNets",
  "kicad.no-schematic": "interop.loss.kicadNoSchematic",
};

/** The sentence for an import or export loss item in the person's language, or undefined for an item that carries its own text (the sketch checker's). */
export function describeInterop(item: LossItem, t: T): string | undefined {
  const args = item.args;
  if (!args) return undefined;
  const reason = (code: unknown) => t(key(`interop.reason.${String(code)}`), { detail: String(args.detail ?? "") });
  if (item.code === "wokwi.not-imported") {
    const wires = Number(args.count);
    return t(key(wires > 0 ? "interop.loss.notImportedWires" : "interop.loss.notImported"), { id: String(args.id), type: String(args.type), reason: reason(args.reason), count: wires });
  }
  if (item.code === "wokwi.approximated") return t(key("interop.loss.approximated"), { id: String(args.id), type: String(args.type), reason: reason(args.reason) });
  if (item.code === "wokwi.pin-dropped") return t(key("interop.loss.pin"), { pin: String(args.pin), reason: reason(args.reason) });
  const simple = SIMPLE[item.code];
  return simple ? t(key(simple), args) : undefined;
}
