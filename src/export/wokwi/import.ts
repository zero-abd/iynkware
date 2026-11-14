import { fail, ok } from "../../core/result.ts";
import type { Result } from "../../core/result.ts";
import { LIMITS } from "../../core/limits.ts";
import { blankProject } from "../../project/blank.ts";
import type { Board, Component, Op, ParamValue, Project, Source, Wire, WireColor } from "../../project/generated/types.ts";
import { createSession } from "../../project/session.ts";
import type { Descriptor } from "../../parts/descriptor.ts";
import { interfaceOf } from "../../parts/pins.ts";
import type { PartRegistry } from "../../parts/registry.ts";
import { importIno } from "../ino.ts";
import type { InoAnalyser, InoFile } from "../ino.ts";
import type { LossItem } from "../loss.ts";
import { readZip, utf8Decode } from "../zip.ts";
import { parseDiagram, splitEndpoint } from "./diagram.ts";
import { spreadApart, type Box } from "./layout.ts";
import type { DiagramErrorCode, WokwiDiagram } from "./diagram.ts";
import { RULES, UNSUPPORTED } from "./parts.ts";
import type { Made, PartRule, Reason, Target } from "./parts.ts";

export interface WokwiFile {
  name: string;
  bytes: Uint8Array;
}

export interface WokwiEnv {
  /** The new project's id, made by the caller with `newProjectId`. */
  id: string;
  now: string;
  locale: string;
  actor: string;
  registry: Pick<PartRegistry, "latest">;
  title?: string;
  /** Finds the constructs the sketch interpreter cannot run; without it the sketch is taken as written. */
  analyse?: InoAnalyser;
}

export interface WokwiImport {
  project: Project;
  loss: LossItem[];
  imported: number;
  notImported: number;
}

export type WokwiErrorCode = DiagramErrorCode | "no-diagram" | "bad-zip" | "too-many-files" | "too-big" | "sketch" | "project";

export interface WokwiError {
  code: WokwiErrorCode;
  message: string;
}

export const WOKWI_LOSS = {
  notImported: "wokwi.not-imported",
  approximated: "wokwi.approximated",
  pin: "wokwi.pin-dropped",
  malformed: "wokwi.connection-skipped",
  noBoard: "wokwi.board-added",
  libraries: "wokwi.libraries",
  serial: "wokwi.serial-monitor",
} as const;

const PX_MM = 25.4 / 96;
const MAX_FILES = 64;
const MAX_FILE_BYTES = LIMITS.canonicalBytes;
const SKETCH_EXTENSIONS = [".ino", ".h", ".hpp", ".c", ".cpp"];
const BOARD_ID = "brd_main";
const SOURCE_ID = "src_main";
const VIEW = "vw_bb";
const GROUND_PIN = /^GND\d*$|^AGND$/;
const POWER_PIN = /^(P5V|P3V3|VIN|VBUS|VSYS)$/;
const NET_NAME: Record<string, string> = { P5V: "5V", P3V3: "3V3" };

const failure = (code: WokwiErrorCode, message: string) => fail<WokwiError>({ code, message });
const baseName = (name: string) => name.split(/[\\/]/).pop() ?? name;
const dirName = (name: string) => name.split(/[\\/]/).slice(0, -1).join("/");
const extension = (name: string) => (name.lastIndexOf(".") < 0 ? "" : name.slice(name.lastIndexOf(".")).toLowerCase());

const WIRE_COLOURS: Record<string, WireColor> = {
  red: "red", black: "black", orange: "orange", yellow: "yellow", green: "green", blue: "blue", white: "white", purple: "purple",
  brown: "brown", grey: "grey", gray: "grey", limegreen: "green", lime: "green", gold: "yellow", cyan: "blue", magenta: "purple",
  pink: "purple", violet: "purple", silver: "grey",
};
const SWATCH: Record<WireColor, [number, number, number]> = {
  red: [220, 40, 40], black: [20, 20, 20], orange: [240, 140, 30], yellow: [240, 220, 40], green: [40, 170, 60],
  blue: [40, 90, 220], white: [245, 245, 245], purple: [140, 60, 190], brown: [130, 80, 40], grey: [140, 140, 140],
};

/** A Wokwi wire colour as the nearest of iynk's ten; an empty colour (a hidden wire) and an unreadable one give none. */
export function wireColour(raw: string): WireColor | undefined {
  const name = raw.trim().toLowerCase();
  if (WIRE_COLOURS[name]) return WIRE_COLOURS[name];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(name)?.[1];
  if (!hex) return undefined;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  let best: WireColor | undefined;
  let bestDistance = Infinity;
  for (const [colour, swatch] of Object.entries(SWATCH) as [WireColor, number[]][]) {
    const distance = swatch.reduce((sum, v, i) => sum + (v - rgb[i]!) ** 2, 0);
    if (distance < bestDistance) [best, bestDistance] = [colour, distance];
  }
  return best;
}

interface Picked {
  diagram: string;
  sketch: InoFile[];
  python: InoFile | undefined;
  libraries: string | undefined;
}

function pick(files: readonly WokwiFile[]): Result<Picked, WokwiError> {
  const all: WokwiFile[] = [];
  for (const file of files) {
    const zipped = extension(file.name) === ".zip" || (file.bytes[0] === 0x50 && file.bytes[1] === 0x4b);
    if (!zipped) {
      all.push(file);
      continue;
    }
    const zip = readZip(file.bytes);
    if (!zip.ok) return failure("bad-zip", zip.error.message);
    all.push(...zip.value.filter((f) => !f.path.endsWith("/") && !f.symlink).map((f) => ({ name: f.path, bytes: f.data })));
  }
  if (all.length > MAX_FILES) return failure("too-many-files", `${all.length} files; the limit is ${MAX_FILES}`);
  if (all.some((f) => f.bytes.length > MAX_FILE_BYTES)) return failure("too-big", `a file is over ${MAX_FILE_BYTES} bytes`);

  const diagrams = all.filter((f) => baseName(f.name).toLowerCase() === "diagram.json").sort((a, b) => a.name.split(/[\\/]/).length - b.name.split(/[\\/]/).length);
  const diagram = diagrams[0];
  if (!diagram) return failure("no-diagram", "No diagram.json among the files");
  const here = dirName(diagram.name);
  const beside = all.filter((f) => dirName(f.name) === here);
  const text = (f: WokwiFile | undefined) => (f ? utf8Decode(f.bytes) ?? undefined : undefined);
  return ok({
    diagram: text(diagram) ?? "",
    sketch: beside.filter((f) => SKETCH_EXTENSIONS.includes(extension(f.name))).map((f) => ({ name: baseName(f.name), bytes: f.bytes })),
    python: beside.filter((f) => baseName(f.name).toLowerCase() === "main.py").map((f) => ({ name: "main.py", bytes: f.bytes }))[0],
    libraries: text(beside.find((f) => baseName(f.name).toLowerCase() === "libraries.txt")),
  });
}

/** The library names in `libraries.txt`: one per line, `Name@version` loses its version, URLs and comments are not names. */
export function libraryNames(text: string | undefined): { names: string[]; skipped: number } {
  const names: string[] = [];
  let skipped = 0;
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (/^[a-z]+:\/\//i.test(line)) {
      skipped++;
      continue;
    }
    const name = line.replace(/@[^@]*$/, "").trim();
    if (name !== "" && !names.includes(name)) names.push(name);
  }
  return { names: names.slice(0, 64), skipped };
}

interface Instance {
  id: string;
  ref: string;
  isBoard: boolean;
  params?: Record<string, ParamValue>;
}

interface Placed {
  wokwiId: string;
  rule: PartRule;
  made: Made;
  instances: Instance[];
}

const defaultParams = (d: Descriptor): Record<string, ParamValue> =>
  Object.fromEntries((d.parameters ?? []).flatMap((p): [string, ParamValue][] => (p.default === undefined ? [] : [[p.id, p.default as ParamValue]])));

class UnionFind {
  private readonly parent = new Map<string, string>();
  find(key: string): string {
    const up = this.parent.get(key);
    if (up === undefined) {
      this.parent.set(key, key);
      return key;
    }
    if (up === key) return key;
    const root = this.find(up);
    this.parent.set(key, root);
    return root;
  }
  union(a: string, b: string): void {
    this.parent.set(this.find(a), this.find(b));
  }
  keys(): string[] {
    return [...this.parent.keys()];
  }
}

const refdesOf = (wokwiId: string, d: Descriptor, taken: Set<string>): string => {
  const wanted = wokwiId.toUpperCase();
  let name = /^[A-Z][A-Z0-9_]{0,15}$/.test(wanted) ? wanted : "";
  for (let n = 1; name === "" || taken.has(name); n++) name = `${d.identity.refdes_prefix ?? "U"}${n}`;
  taken.add(name);
  return name;
};

/**
 * Turns a Wokwi project (diagram.json, the sketch, libraries.txt; loose or in a zip) into an iynk project with the nearest
 * iynk parts, one net per set of joined pins, the wire colours and the sketch. What has no iynk match, and every pin or
 * wire that went with it, comes back in `loss`; nothing is dropped without a line there.
 */
export function importWokwi(files: readonly WokwiFile[], env: WokwiEnv): Result<WokwiImport, WokwiError> {
  const picked = pick(files);
  if (!picked.ok) return picked;
  const parsed = parseDiagram(picked.value.diagram);
  if (!parsed.ok) return failure(parsed.error.code, parsed.error.message);
  const diagram = parsed.value;
  const loss: LossItem[] = [];

  const resolved = resolveParts(diagram, env, loss);
  const board = resolved.placed.find((p) => p.rule.kind === "board");
  const boardId = board?.rule.board ?? "uno-r3";
  if (!board) loss.push({ code: WOKWI_LOSS.noBoard, severity: "info", message: "The diagram has no supported board; an Arduino Uno was added", args: { board: "uno-r3" } });

  const sketch = sketchSources(picked.value, boardId, env, loss);
  if (!sketch.ok) return sketch;

  const wired = resolveWires(diagram, resolved, loss);
  const libs = libraryNames(picked.value.libraries);
  if (libs.skipped > 0) loss.push({ code: WOKWI_LOSS.libraries, severity: "info", message: `${libs.skipped} library lines are links and were left out`, args: { count: libs.skipped } });

  const built = build({ diagram, resolved, wired, sketch: sketch.value, libraries: libs.names, boardRef: board?.instances[0]!.ref ?? "core.uno-r3" }, env);
  if (!built.ok) return built;
  const imported = resolved.placed.filter((p) => p.rule.kind !== "surface").length;
  return ok({ project: built.value, loss, imported, notImported: resolved.skipped });
}

interface Resolved {
  placed: Placed[];
  byWokwi: Map<string, Placed>;
  skipped: number;
  skippedIds: Set<string>;
}

function resolveParts(diagram: WokwiDiagram, env: WokwiEnv, loss: LossItem[]): Resolved {
  const placed: Placed[] = [];
  const byWokwi = new Map<string, Placed>();
  const skippedIds = new Set<string>();
  const taken = new Set<string>(["U1"]);
  let boards = 0;
  let serial = 0;
  const skip = (id: string, type: string, reason: Reason) => {
    skippedIds.add(id);
    const wires = diagram.wires.filter((w) => splitEndpoint(w.from)?.part === id || splitEndpoint(w.to)?.part === id).length;
    loss.push({ code: WOKWI_LOSS.notImported, severity: "warning", message: `Not imported: ${id} (${type}): ${reason}`, args: { id, type, reason, count: wires } });
  };

  for (const part of diagram.parts) {
    const rule = RULES[part.type];
    if (!rule) {
      skip(part.id, part.type, UNSUPPORTED[part.type] ?? "no-part");
      continue;
    }
    if (rule.kind === "board" && ++boards > 1) {
      skip(part.id, part.type, "second-board");
      continue;
    }
    const made = rule.make(part.attrs);
    const instances: Instance[] = made.parts.map((m, i) => ({ id: `${rule.kind === "board" ? "brd" : "cmp"}_${placed.length + 1}${i === 0 ? "" : `x${i}`}`, ref: m.ref, params: m.params, isBoard: rule.kind === "board" }));
    const p: Placed = { wokwiId: part.id, rule, made, instances };
    placed.push(p);
    byWokwi.set(part.id, p);
    for (const note of made.notes) {
      loss.push({ code: WOKWI_LOSS.approximated, severity: "info", message: `${part.id} (${part.type}): ${note.reason}: ${note.detail}`, args: { id: part.id, type: part.type, reason: note.reason, detail: note.detail } });
    }
    if (rule.kind === "surface") loss.push({ code: WOKWI_LOSS.approximated, severity: "info", message: `${part.id}: breadboard-flattened`, args: { id: part.id, type: part.type, reason: "breadboard-flattened", detail: "" } });
  }
  for (const w of diagram.wires) if ([w.from, w.to].some((e) => e.startsWith("$serialMonitor:"))) serial++;
  if (serial > 0) loss.push({ code: WOKWI_LOSS.serial, severity: "info", message: "Serial monitor wires were left out; iynk has its own serial monitor", args: { count: serial } });
  return { placed, byWokwi, skipped: skippedIds.size, skippedIds };
}

interface Edge {
  a: string;
  b: string;
  color: WireColor | undefined;
}
interface Wired {
  edges: Edge[];
  keyOf: Map<string, { c: string; p: string }>;
}

const key = (c: string, p: string) => `${c}/${p}`;

function resolveWires(diagram: WokwiDiagram, resolved: Resolved, loss: LossItem[]): Wired {
  const edges: Edge[] = [];
  const keyOf = new Map<string, { c: string; p: string }>();
  const dropped = new Set<string>();
  const endpoint = (raw: string): string | null => {
    const e = splitEndpoint(raw);
    if (!e || e.part.startsWith("$") || resolved.skippedIds.has(e.part)) return null;
    const p = resolved.byWokwi.get(e.part);
    const target: Target | null | undefined = p?.rule.pin(e.pin);
    if (!p) return null;
    if (target === undefined || target === null) {
      if (!dropped.has(raw)) {
        dropped.add(raw);
        const reason: Reason = target === null ? "pin-unused" : "pin-unknown";
        loss.push({ code: WOKWI_LOSS.pin, severity: "warning", message: `Pin ${raw} was left out: ${reason}`, args: { pin: raw, reason } });
      }
      return null;
    }
    const inst = p.instances[target.part]!;
    const k = key(inst.id, target.pin);
    keyOf.set(k, { c: inst.id, p: target.pin });
    return k;
  };
  for (const w of diagram.wires) {
    const a = endpoint(w.from);
    const b = endpoint(w.to);
    if (a !== null && b !== null && a !== b) edges.push({ a, b, color: wireColour(w.color) });
  }
  if (diagram.malformed > 0) loss.push({ code: WOKWI_LOSS.malformed, severity: "warning", message: `${diagram.malformed} connections could not be read`, args: { count: diagram.malformed } });
  for (const p of resolved.placed) {
    for (const [x, y] of p.made.inside ?? []) {
      const kx = key(p.instances[x.part]!.id, x.pin);
      const ky = key(p.instances[y.part]!.id, y.pin);
      keyOf.set(kx, { c: p.instances[x.part]!.id, p: x.pin });
      keyOf.set(ky, { c: p.instances[y.part]!.id, p: y.pin });
      edges.push({ a: kx, b: ky, color: undefined });
    }
  }
  return { edges, keyOf };
}

interface SketchSources {
  language: "arduino-cpp" | "micropython";
  sources: { path: string; text: string; language: Source["language"] }[];
  title: string;
}

function sketchSources(picked: Picked, boardId: string, env: WokwiEnv, loss: LossItem[]): Result<SketchSources, WokwiError> {
  const title = env.title ?? "Wokwi project";
  if (picked.sketch.some((f) => extension(f.name) === ".ino")) {
    const result = importIno(picked.sketch, env.analyse ?? (() => []), { board: boardId });
    if (!result.ok) return failure("sketch", result.error.message);
    loss.push(...result.value.loss);
    const languageOf = (path: string): Source["language"] => (path.endsWith(".ino") ? "arduino-cpp" : path.endsWith(".c") ? "c" : "cpp");
    return ok({ language: "arduino-cpp", title, sources: result.value.sources.map((s) => ({ path: s.path, text: s.text, language: languageOf(s.path) })) });
  }
  const text = picked.python ? utf8Decode(picked.python.bytes) : null;
  if (text !== null && boardId === "pico") return ok({ language: "micropython", title, sources: [{ path: "main.py", text, language: "micropython" }] });
  return ok({ language: "arduino-cpp", title, sources: [{ path: "main.ino", text: "void setup() {\n}\n\nvoid loop() {\n}\n", language: "arduino-cpp" }] });
}

interface BuildInput {
  diagram: WokwiDiagram;
  resolved: Resolved;
  wired: Wired;
  sketch: SketchSources;
  libraries: string[];
  boardRef: string;
}

function build(i: BuildInput, env: WokwiEnv): Result<Project, WokwiError> {
  const boardDescriptor = env.registry.latest(i.boardRef);
  if (!boardDescriptor) return failure("project", `${i.boardRef} is not a known part`);

  const base = blankProject({ board: "uno", title: i.sketch.title, locale: env.locale, actor: env.actor, now: env.now, id: env.id });
  const board: Board = {
    id: BOARD_ID,
    definition: { ref: i.boardRef, version: boardDescriptor.version },
    refdes: "U1",
    firmware: { language: i.sketch.language, entry: SOURCE_ID, sources: [SOURCE_ID], libraries: i.libraries },
  };
  const [entry, ...rest] = i.sketch.sources;
  const sources: Source[] = [
    { id: SOURCE_ID, path: entry!.path, language: entry!.language, role: "firmware", board: BOARD_ID, content: entry!.text },
    ...rest.map((s, n): Source => ({ id: `src_x${n + 1}`, path: s.path, language: s.language, role: "firmware", board: BOARD_ID, content: s.text })),
  ];
  board.firmware!.sources = sources.map((s) => s.id) as [string, ...string[]];
  const state: Project = {
    ...base,
    boards: [board],
    sources,
    simulation: { ...base.simulation, runtimes: [{ id: "rtm_main", board: BOARD_ID, engine: "iynk-interp" }] },
    dependencies: { ...base.dependencies, components: [{ ref: i.boardRef, version: boardDescriptor.version, origin: "builtin", interface: interfaceOf(boardDescriptor) }] },
  };

  const ops: Op[] = [];
  const taken = new Set(["U1"]);
  const pinned = new Set([i.boardRef]);
  let missing: string | undefined;
  const surfaceGroups: string[][] = [];
  const owner = new Map<string, string>();
  const seats = new Map<string, { x: number; y: number; rotation: number }>();
  const boxes: Box[] = [];
  let boardBox: Box | undefined;

  for (const p of i.resolved.placed) {
    const wokwiPart = i.diagram.parts.find((part) => part.id === p.wokwiId)!;
    p.instances.forEach((inst, n) => {
      const made = p.made.parts[n]!;
      const d = env.registry.latest(made.ref);
      if (!d) {
        missing = made.ref;
        return;
      }
      const id = inst.isBoard ? BOARD_ID : inst.id;
      owner.set(inst.id, id);
      if (p.rule.kind === "surface") {
        surfaceGroups.push(...(d.groups ?? []).map((g) => g.pins.map((pin) => key(inst.id, pin))));
        return;
      }
      const rotation = wokwiPart.rotate % 90 === 0 ? wokwiPart.rotate % 360 : 0;
      const seat = { x: Math.round(wokwiPart.left * PX_MM * 100) / 100, y: Math.round(wokwiPart.top * PX_MM * 100) / 100, rotation };
      seats.set(id, seat);
      const body = d.dimensions?.body ?? d.dimensions?.board;
      const turned = rotation % 180 !== 0;
      const box: Box = { id, x: seat.x, y: seat.y, w: (turned ? body?.h : body?.w) ?? 0, h: (turned ? body?.w : body?.h) ?? 0 };
      if (inst.isBoard) {
        boardBox = box;
        return;
      }
      boxes.push(box);
      if (!pinned.has(made.ref)) {
        pinned.add(made.ref);
        ops.push({ k: "dep.set", dependency: { ref: d.id, version: d.version, origin: "builtin", interface: interfaceOf(d) } });
      }
      const component: Component = { id, definition: { ref: d.id, version: d.version }, refdes: refdesOf(p.wokwiId + (n === 0 ? "" : `_${n}`), d, taken), params: { ...defaultParams(d), ...(made.params ?? {}) } };
      ops.push({ k: "component.add", component });
    });
  }

  if (missing) return failure("project", `${missing} is not a known part`);

  const apart = spreadApart(boardBox ? [boardBox] : [], boxes);
  for (const [id, seat] of seats) {
    const at = apart.get(id) ?? seat;
    ops.push({ k: "view.place", view: VIEW, placement: { c: id, x_mm: Math.round(at.x * 100) / 100, y_mm: Math.round(at.y * 100) / 100, ...(seat.rotation !== 0 && { rotation_deg: seat.rotation }) } });
  }

  const sets = new UnionFind();
  for (const e of i.wired.edges) sets.union(e.a, e.b);
  const used = new Set(sets.keys());
  for (const group of surfaceGroups) {
    const live = group.filter((k) => used.has(k));
    for (const k of live.slice(1)) sets.union(live[0]!, k);
  }
  const surfaceKeys = new Set(surfaceGroups.flat());

  const members = new Map<string, string[]>();
  for (const k of sets.keys()) {
    if (surfaceKeys.has(k)) continue;
    const root = sets.find(k);
    members.set(root, [...(members.get(root) ?? []), k]);
  }
  const netOf = new Map<string, string>();
  let netCount = 0;
  for (const keys of [...members.values()].sort((a, b) => (a[0]! < b[0]! ? -1 : 1))) {
    const pins = keys.sort().map((k) => ({ c: owner.get(i.wired.keyOf.get(k)!.c) ?? i.wired.keyOf.get(k)!.c, p: i.wired.keyOf.get(k)!.p }));
    if (pins.length < 2) continue;
    const id = `net_${++netCount}`;
    const boardPins = pins.filter((pin) => pin.c === BOARD_ID).map((pin) => pin.p);
    const named = boardPins.find((p) => GROUND_PIN.test(p)) ?? boardPins.find((p) => POWER_PIN.test(p)) ?? boardPins[0];
    const cls = boardPins.some((p) => GROUND_PIN.test(p)) ? "ground" : boardPins.some((p) => POWER_PIN.test(p)) ? "power" : "signal";
    ops.push({ k: "net.create", net: { id, class: cls, ...(named && { name: GROUND_PIN.test(named) ? "GND" : (NET_NAME[named] ?? named) }), connections: pins as [(typeof pins)[0], ...typeof pins] } });
    for (const k of keys) netOf.set(k, id);
  }

  const wires: Wire[] = [];
  for (const e of i.wired.edges) {
    // a wire to a breadboard hole is the breadboard's strips joining nets, which the net already says
    const net = surfaceKeys.has(e.a) || surfaceKeys.has(e.b) ? undefined : netOf.get(e.a);
    if (net === undefined) continue;
    const end = (k: string) => {
      const pin = i.wired.keyOf.get(k)!;
      return { kind: "pin" as const, c: owner.get(pin.c) ?? pin.c, p: pin.p };
    };
    wires.push({ id: `wir_${wires.length + 1}`, net, from: end(e.a), to: end(e.b), ...(e.color && { color: e.color }) });
  }
  for (const wire of wires) ops.push({ k: "wire.add", view: VIEW, wire });

  const session = createSession({ state, clock: () => Date.parse(env.now), rnd: { bytes: (n) => new Uint8Array(n) } });
  const done = session.apply(ops, { actor: env.actor, kind: "import" }, { label: "Import Wokwi project" });
  return done.ok ? ok(session.state) : failure("project", `${done.reject}: ${done.message}`);
}
