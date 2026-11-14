import { sha256Hex } from "../core/sha256.ts";
import type { Project } from "../project/generated/types.ts";
import type { Descriptor } from "../parts/descriptor.ts";
import type { PartRegistry } from "../parts/registry.ts";
import { KICAD_PARTS } from "./footprints.ts";
import type { KicadPart } from "./footprints.ts";
import type { LossItem } from "./loss.ts";

export const KICAD_LOSS = {
  noFootprint: "kicad.no-footprint",
  noNets: "kicad.no-nets",
  schematic: "kicad.no-schematic",
} as const;

export interface KicadNetlist {
  /** The `.net` file: the KiCad 8 netlist (`(export (version "E") ...)`), which Pcbnew reads with File, Import, Netlist. */
  text: string;
  loss: LossItem[];
}

export interface KicadOptions {
  exportedAt: string;
  appVersion: string;
}

const NET_PREFIX: Record<string, string> = { GND: "GND", "5V": "+5V", "3V3": "+3V3" };
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const quote = (text: string): string => `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replace(/[\r\n]+/g, " ")}"`;

/** A KiCad-style value: `4.7k`, `100n`, `10u`, `2.2`. */
export function siValue(x: number, unit: string): string {
  const steps: [number, string][] = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "u"], [1e-9, "n"], [1e-12, "p"]];
  const [scale, prefix] = steps.find(([s]) => Math.abs(x) >= s * 0.9995) ?? steps[steps.length - 1]!;
  return `${Number((x / scale).toPrecision(4))}${prefix}${unit}`;
}

/** A tstamp KiCad accepts: 32 hex digits as a UUID, the same for the same project and part. */
const uuid = (seed: string): string => {
  const h = sha256Hex(seed);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

interface Fitted {
  id: string;
  ref: string;
  value: string;
  footprint: string;
  lib: string;
  symbol: string;
  description: string;
  pads: Readonly<Record<string, string>> | undefined;
  pins: string[];
}

function valueOf(hit: KicadPart | undefined, params: Record<string, unknown> | undefined, d: Descriptor | undefined, fallback: string): string {
  if (hit && typeof hit.value === "object") {
    const raw = params?.[hit.value.param] ?? d?.parameters?.find((p) => p.id === (hit.value as { param: string }).param)?.default;
    if (typeof raw === "number") return siValue(raw, hit.value.unit);
  }
  return typeof hit?.value === "string" ? hit.value : (d?.identity.model ?? fallback);
}

/**
 * The project as a KiCad 8 netlist: every part with its reference, value and footprint, and every net with the pads on it.
 * A breadboard is left out. Parts in `KICAD_PARTS` carry a stock footprint and the pad numbers of it; any other part is written without a footprint, with
 * its iynk pin names as pad numbers, and named in `loss`. A schematic is not written (see docs/INTEROP.md).
 */
export function exportKicadNetlist(project: Project, registry: Pick<PartRegistry, "get">, opts: KicadOptions): KicadNetlist {
  const loss: LossItem[] = [];
  const onBoard = (inst: Project["components"][number]) => !registry.get(inst.definition.ref, inst.definition.version)?.identity.tags?.includes("surface");
  const parts: Fitted[] = [...project.boards, ...project.components.filter(onBoard)].map((inst) => {
    const d = registry.get(inst.definition.ref, inst.definition.version);
    const hit = KICAD_PARTS[inst.definition.ref];
    const params = inst.params as Record<string, unknown> | undefined;
    const pins = (d?.pins ?? []).map((p) => p.id);
    if (!hit) {
      loss.push({ code: KICAD_LOSS.noFootprint, severity: "warning", path: inst.refdes, message: `${inst.refdes} (${inst.definition.ref}) has no footprint in the table`, args: { ref: inst.refdes, part: inst.definition.ref } });
    }
    const symbol = hit ? hit.symbol : inst.definition.ref.replace(/^core\./, "");
    return {
      id: inst.id,
      ref: inst.refdes,
      value: valueOf(hit, params, d, inst.definition.ref),
      footprint: hit?.footprint ?? "",
      lib: hit?.lib ?? "iynk",
      symbol: inst.definition.ref === "core.rgb-led" && params?.common === "anode" ? "LED_RGBA" : symbol,
      description: hit?.description ?? d?.identity.model ?? "",
      pads: hit?.pads,
      pins,
    };
  });
  const byId = new Map(parts.map((p) => [p.id, p]));
  const padOf = (part: Fitted, pin: string): string => part.pads?.[pin] ?? pin;

  const nets = project.nets
    .map((net) => ({
      name: net.name,
      nodes: net.connections.flatMap(({ c, p }) => {
        const part = byId.get(c);
        return part ? [{ ref: part.ref, pad: padOf(part, p), pin: p }] : [];
      }),
    }))
    .filter((n) => n.nodes.length > 0);
  if (nets.length === 0) loss.push({ code: KICAD_LOSS.noNets, severity: "warning", message: "The project has no nets; the netlist lists the parts only", args: {} });
  loss.push({ code: KICAD_LOSS.schematic, severity: "info", message: "Only the netlist is written, not a schematic", args: {} });

  const named = nets.map((n) => {
    const nodes = n.nodes.sort((a, b) => byText(a.ref, b.ref) || byText(a.pad, b.pad));
    const name = n.name ? (NET_PREFIX[n.name] ?? `/${n.name}`) : `Net-(${nodes[0]!.ref}-Pad${nodes[0]!.pad})`;
    return { name, nodes };
  });
  named.sort((a, b) => byText(a.name, b.name));

  const libparts = new Map<string, Fitted>();
  for (const p of parts) libparts.set(`${p.lib}:${p.symbol}`, libparts.get(`${p.lib}:${p.symbol}`) ?? p);
  const libraries = [...new Set(parts.map((p) => p.lib))].sort(byText);
  const source = `${project.meta.title.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "project"}.kicad_sch`;
  const sortedParts = [...parts].sort((a, b) => byText(a.ref, b.ref));

  const lines: string[] = [
    `(export (version "E")`,
    `  (design`,
    `    (source ${quote(source)})`,
    `    (date ${quote(opts.exportedAt)})`,
    `    (tool ${quote(`iynk ${opts.appVersion}`)})`,
    `    (sheet (number "1") (name "/") (tstamps "/")`,
    `      (title_block (title ${quote(project.meta.title)}) (company "") (rev "") (date "") (source ${quote(source)})`,
    `        (comment (number "1") (value "")) (comment (number "2") (value "")) (comment (number "3") (value "")) (comment (number "4") (value "")))))`,
    `  (components`,
  ];
  for (const p of sortedParts) {
    const stamp = uuid(`${project.id}/${p.id}`);
    lines.push(
      `    (comp (ref ${quote(p.ref)})`,
      `      (value ${quote(p.value)})`,
      `      (footprint ${quote(p.footprint)})`,
      `      (libsource (lib ${quote(p.lib)}) (part ${quote(p.symbol)}) (description ${quote(p.description)}))`,
      `      (property (name "Sheetname") (value ""))`,
      `      (property (name "Sheetfile") (value ${quote(source)}))`,
      `      (sheetpath (names "/") (tstamps "/"))`,
      `      (tstamps ${quote(stamp)}))`,
    );
  }
  lines.push(`  )`, `  (libparts`);
  for (const p of libparts.values()) {
    const numbers = p.pads ? p.pins.map((pin) => [padOf(p, pin), pin] as const) : p.pins.map((pin) => [pin, pin] as const);
    lines.push(
      `    (libpart (lib ${quote(p.lib)}) (part ${quote(p.symbol)})`,
      `      (description ${quote(p.description)})`,
      `      (docs "~")`,
      `      (fields (field (name "Reference") ${quote(p.ref.replace(/\d+$/, ""))}) (field (name "Value") ${quote(p.symbol)}) (field (name "Footprint")) (field (name "Datasheet") "~"))`,
      `      (pins ${numbers.sort((a, b) => byText(a[0].padStart(8, "0"), b[0].padStart(8, "0"))).map(([num, name]) => `(pin (num ${quote(num)}) (name ${quote(name)}) (type "passive"))`).join(" ")}))`,
    );
  }
  lines.push(`  )`, `  (libraries`);
  for (const lib of libraries) lines.push(`    (library (logical ${quote(lib)}) (uri ${quote(`\${KICAD8_SYMBOL_DIR}/${lib}.kicad_sym`)}))`);
  lines.push(`  )`, `  (nets`);
  named.forEach((net, i) => {
    lines.push(`    (net (code ${quote(String(i + 1))}) (name ${quote(net.name)}) (class "Default")`);
    net.nodes.forEach((node, k) => {
      lines.push(`      (node (ref ${quote(node.ref)}) (pin ${quote(node.pad)}) (pinfunction ${quote(node.pin)}) (pintype "passive"))${k === net.nodes.length - 1 ? ")" : ""}`);
    });
  });
  lines.push(`  ))`);
  return { text: lines.join("\n") + "\n", loss };
}
