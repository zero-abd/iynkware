// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "../parts/builtin.ts";
import type { Project } from "../project/generated/types.ts";
import { KICAD_PARTS } from "./footprints.ts";
import { exportKicadNetlist, KICAD_LOSS, siValue } from "./kicad.ts";

const registry = builtinRegistry();
const STARTERS = join(import.meta.dirname, "..", "studio", "starters");
const load = (id: string): Project => JSON.parse(readFileSync(join(STARTERS, `${id}.project.json`), "utf8")) as Project;
const OPTS = { exportedAt: "2026-11-10T10:00:00.000Z", appVersion: "test" };

type Node = string | Node[];

/** A KiCad s-expression, read into nested arrays of strings. */
function parse(text: string): Node {
  let at = 0;
  const read = (): Node => {
    if (at >= text.length) throw new Error("the text ends inside a list");
    while (/\s/.test(text[at]!)) at++;
    if (text[at] === "(") {
      at++;
      const list: Node[] = [];
      for (;;) {
        while (/\s/.test(text[at]!)) at++;
        if (text[at] === ")") {
          at++;
          return list;
        }
        list.push(read());
      }
    }
    if (text[at] === '"') {
      let out = "";
      for (at++; text[at] !== '"'; at++) out += text[at] === "\\" ? text[++at] : text[at];
      at++;
      return out;
    }
    const start = at;
    while (at < text.length && !/[\s()]/.test(text[at]!)) at++;
    return text.slice(start, at);
  };
  const root = read();
  expect(text.slice(at).trim()).toBe("");
  return root;
}

const child = (node: Node, name: string): Node[] => (node as Node[]).filter((c): c is Node[] => Array.isArray(c) && c[0] === name);
const field = (node: Node, name: string): string => (child(node, name)[0]![1] as string);

describe("the KiCad netlist of the 555 blinker", () => {
  const out = exportKicadNetlist(load("blinker-555"), registry, OPTS);
  const root = parse(out.text) as Node[];

  it("is a KiCad 8 export with balanced parentheses", () => {
    expect(root[0]).toBe("export");
    expect(field(root, "version")).toBe("E");
    expect(field(child(root, "design")[0]!, "tool")).toBe("iynk test");
  });

  it("lists every part with its footprint and a value a person reads", () => {
    const comps = child(child(root, "components")[0]!, "comp");
    const by = new Map(comps.map((c) => [field(c, "ref"), c]));
    expect([...by.keys()].sort()).toEqual(["C1", "C2", "LED1", "R1", "R2", "R3", "U1", "U2"]);
    expect(field(by.get("R2")!, "value")).toBe("68k");
    expect(field(by.get("C1")!, "value")).toBe("10uF");
    expect(field(by.get("C2")!, "value")).toBe("100nF");
    expect(field(by.get("U2")!, "footprint")).toBe("Package_DIP:DIP-8_W7.62mm");
    expect(field(by.get("LED1")!, "footprint")).toBe("LED_THT:LED_D5.0mm");
    expect(field(by.get("U1")!, "footprint")).toBe("");
  });

  it("puts each pad of the 555 on the net the project wires it to, with the DIP-8 pin numbers", () => {
    const nets = child(child(root, "nets")[0]!, "net");
    const padsOf = (ref: string) =>
      Object.fromEntries(nets.flatMap((n) => child(n, "node").filter((node) => field(node, "ref") === ref).map((node) => [field(node, "pin"), field(n, "name")])));
    const u2 = padsOf("U2");
    expect(u2["1"]).toBe("GND");
    expect(u2["8"]).toBe("+5V");
    expect(u2["6"]).toBe(u2["2"]);
    expect(Object.keys(u2).sort()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });

  it("names a net with no name after its first pad and numbers the nets from 1", () => {
    const names = child(child(root, "nets")[0]!, "net").map((n) => field(n, "name"));
    expect(names).toContain("Net-(C2-Pad1)");
    expect(child(child(root, "nets")[0]!, "net").map((n) => field(n, "code"))).toEqual(names.map((_, i) => String(i + 1)));
  });

  it("names the parts that have no footprint and says no schematic is written", () => {
    expect(out.loss.filter((l) => l.code === KICAD_LOSS.noFootprint).map((l) => l.args!.ref)).toEqual(["U1"]);
    expect(out.loss.map((l) => l.code)).toContain(KICAD_LOSS.schematic);
  });

  it("is the same text for the same project", () => {
    expect(exportKicadNetlist(load("blinker-555"), registry, OPTS).text).toBe(out.text);
  });
});

describe("the footprint table", () => {
  it("names only parts the registry has, with a pad for every pin of each", () => {
    for (const [ref, part] of Object.entries(KICAD_PARTS)) {
      const d = registry.latest(ref);
      expect(d, ref).toBeDefined();
      expect(Object.keys(part.pads).sort(), ref).toEqual(d!.pins.map((p) => p.id).sort());
      expect(new Set(Object.values(part.pads)).size, ref).toBe(d!.pins.length);
    }
  });
});

describe("values", () => {
  it("writes engineering values the way KiCad parts carry them", () => {
    expect([siValue(220, ""), siValue(4700, ""), siValue(1e-7, "F"), siValue(1e-5, "F"), siValue(1e-3, "F"), siValue(0.0001, "H"), siValue(2.2e6, "")]).toEqual(["220", "4.7k", "100nF", "10uF", "1mF", "100uH", "2.2M"]);
  });
});
