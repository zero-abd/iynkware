import type { Descriptor } from "../parts/descriptor.ts";
import type { Project } from "../project/generated/types.ts";
import { csvCell } from "./ino.ts";

export interface BomLine {
  qty: number;
  /** The part id and version the project pins. */
  part: string;
  refdes: string[];
  manufacturer: string;
  model: string;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The boards and components of a project, one line per part and version, sorted by part. */
export function projectBom(project: Project, describe: (ref: string, version: string) => Descriptor | undefined): BomLine[] {
  const lines = new Map<string, BomLine>();
  for (const { definition, refdes } of [...project.boards, ...project.components]) {
    const part = `${definition.ref}@${definition.version}`;
    const line = lines.get(part);
    if (line) {
      line.qty += 1;
      line.refdes.push(refdes);
      continue;
    }
    const identity = describe(definition.ref, definition.version)?.identity;
    lines.set(part, { qty: 1, part, refdes: [refdes], manufacturer: identity?.manufacturer ?? "", model: identity?.model ?? definition.ref });
  }
  return [...lines.values()].sort((a, b) => byText(a.part, b.part)).map((l) => ({ ...l, refdes: [...l.refdes].sort(byText) }));
}

/** `qty,refdes,part,manufacturer,model` with CRLF line ends, like the wiring table. */
export function bomCsv(lines: readonly BomLine[]): string {
  const rows = lines.map((l) => [String(l.qty), l.refdes.join(" "), l.part, l.manufacturer, l.model].map(csvCell).join(","));
  return ["qty,refdes,part,manufacturer,model", ...rows].join("\r\n") + "\r\n";
}
