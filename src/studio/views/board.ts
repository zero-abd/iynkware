import { PROFILES } from "../../sim/boards/profiles.ts";
import type { BoardId } from "../../sim/boards/profiles.ts";
import { boardIdForPart } from "../../parts/boards.ts";
import type { Pin } from "../../parts/generated/types.ts";
import type { PartRegistry } from "../../parts/registry.ts";
import type { Op, Project as ProjectState } from "../../project/generated/types.ts";
import { netlist } from "../../project/netlist.ts";
import type { Netlist, NetlistNode } from "../../project/netlist.ts";
import { pinLevels } from "../engine/part-state.ts";
import type { PartStateFrame } from "../stores/run.ts";

export type PinRole = "power" | "ground" | "digital" | "analog" | "bus" | "other";

export interface PinRow {
  pin: string;
  designator: string;
  name: string;
  type: Pin["type"];
  klass: Pin["class"];
  connector: string;
  role: PinRole;
  netId?: string;
  netName?: string;
  /** `refdes.pin` of every other pin on the net. */
  connectedTo: string[];
  /** The name a run reports this pin's level under, when it is not the pin id: the project's name for a Verilog port bit. */
  signal?: string;
  note?: string;
}

export interface PortRow {
  port: string;
  dir: "in" | "out";
  width: number;
  activeLow: boolean;
  /** Bit 0 first. */
  bits: PinRow[];
}

export interface PinMapModel {
  /** The id of the board in the document, which is the `c` of a `PinRef`. */
  board: string;
  refdes: string;
  kind: "pins" | "ports";
  groups: { connector: string; rows: PinRow[] }[];
  ports: PortRow[];
}

export interface PinLive {
  level: 0 | 1;
}

const EMPTY: PinMapModel = { board: "", refdes: "", kind: "pins", groups: [], ports: [] };

const ROLE_OF_CLASS: Partial<Record<Pin["class"], PinRole>> = { power: "power", ground: "ground", digital: "digital", analog: "analog", bus: "bus" };

const textOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

let cached: { state: ProjectState; nl: Netlist } | undefined;
function netlistOf(state: ProjectState): Netlist {
  if (cached?.state !== state) cached = { state, nl: netlist(state) };
  return cached.nl;
}

function portsOf(rows: ReadonlyMap<string, PinRow>, ports: Record<string, string[] | undefined>, boardId: BoardId | undefined): PortRow[] {
  const known = boardId ? PROFILES[boardId].fpga?.ports : undefined;
  return Object.entries(ports).flatMap(([port, pins]) => {
    const profile = known?.find((x) => x.name === port);
    // The board lists one pin per port bit (`led3`); a project mapped from a lesson names the pin on the board (`LD3`).
    const bitPin = (name: string, bit: number): PinRow | undefined => {
      const own = rows.get(name) ?? (profile ? rows.get(profile.width === 1 ? port : `${port}${bit}`) : undefined);
      return own && { ...own, signal: name };
    };
    const bits = (pins ?? []).flatMap((p, bit) => bitPin(p, bit) ?? []);
    if (bits.length === 0) return [];
    const dir = profile?.dir ?? (bits.every((b) => b.type === "digital_in") ? "in" : "out");
    return [{ port, dir, width: bits.length, activeLow: profile?.activeLow ?? false, bits }];
  });
}

/**
 * The pins of one board as the board view lists them: grouped by connector in descriptor order, each with its role,
 * its net and the other pins on that net. A Verilog board also gets its ports, bits in the order the project maps them.
 * A board that is not in the document, or whose part is not in `reg`, gives an empty model.
 */
export function buildPinMap(state: ProjectState, boardId: string, reg: PartRegistry): PinMapModel {
  const board = state.boards.find((b) => b.id === boardId);
  if (!board) return EMPTY;
  const part = reg.get(board.definition.ref, board.definition.version);
  if (!part) return { ...EMPTY, board: board.id, refdes: board.refdes };

  const nl = netlistOf(state);
  const nodes = new Map<string, NetlistNode>(nl.nodes.map((n) => [n.id, n]));
  const refdes = new Map([...state.boards, ...state.components].map((x) => [x.id, x.refdes]));
  const inBus = new Set(part.protocols?.flatMap((p) => Object.values(p.pins).flatMap((id) => id ?? [])));

  const rowOf = (pin: Pin): PinRow => {
    const node = nodes.get(nl.pinNode[`${board.id}/${pin.id}`] ?? "");
    const role = ROLE_OF_CLASS[pin.class] ?? "other";
    const netName = node?.names[0];
    const note = textOf(pin.note);
    return {
      pin: pin.id,
      designator: pin.designator ?? pin.id,
      name: textOf(pin.name) ?? pin.designator ?? pin.id,
      type: pin.type,
      klass: pin.class,
      connector: pin.connector ?? "",
      role: role === "digital" && inBus.has(pin.id) ? "bus" : role,
      ...(node && { netId: node.nets[0] }),
      ...(netName && { netName }),
      connectedTo: (node?.pins ?? []).filter((x) => x.c !== board.id || x.p !== pin.id).map((x) => `${refdes.get(x.c) ?? x.c}.${x.p}`),
      ...(note && { note }),
    };
  };

  const rows = new Map(part.pins.filter((p) => p.type !== "mechanical").map((p) => [p.id, rowOf(p)]));
  const groups: PinMapModel["groups"] = [];
  for (const row of rows.values()) {
    const group = groups.find((g) => g.connector === row.connector);
    if (group) group.rows.push(row);
    else groups.push({ connector: row.connector, rows: [row] });
  }

  const mapped = board.firmware?.ports;
  const ports = mapped ? portsOf(rows, mapped, boardIdForPart(board.definition.ref) as BoardId | undefined) : [];
  return { board: board.id, refdes: board.refdes, kind: ports.length > 0 ? "ports" : "pins", groups, ports };
}

/**
 * The level of every pin of the board that the frame reports as 0 or 1, keyed by pin id. A pin on no net, as on a design
 * that has no parts yet, is read under its own name: that is what the engine reports an output as.
 */
export function livePins(state: ProjectState, frame: PartStateFrame, boardId: string): Record<string, PinLive> {
  const live: Record<string, PinLive> = {};
  for (const [name, level] of Object.entries(frame.pins)) {
    if (level === 0 || level === 1) live[name] = { level };
  }
  for (const [key, level] of pinLevels(state, frame)) {
    if (level !== null && key.startsWith(`${boardId}/`)) live[key.slice(boardId.length + 1)] = { level };
  }
  return live;
}

const BOARD_VIEW = "vw_board";

/** A document with no board view gets one, named like the schematic's. A board view places exactly one board, the first. */
export function ensureBoardView(state: ProjectState): Op[] {
  const board = state.boards[0];
  if (!board || state.views.some((v) => v.kind === "board")) return [];
  const taken = new Set(state.views.map((v) => v.id));
  let id = BOARD_VIEW;
  for (let n = 2; taken.has(id); n++) id = `${BOARD_VIEW}${n}`;
  return [{ k: "view.add", view: { id, kind: "board", name: "Board", placements: [{ c: board.id, x_mm: 0, y_mm: 0 }], wires: [] } }];
}
