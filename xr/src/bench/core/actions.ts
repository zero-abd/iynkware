/**
 * Build actions: every build step the bench offers, as project operations (the co-builder seam). A gesture never builds
 * ops inline: it calls one of these with the document and plain arguments, then applies what comes back with
 * `app.project.apply(result.ops, { label: result.label })`, one call per user action (one undo). An assistant performs
 * the same steps through the same functions (`ACTIONS` lists them, `runAction` calls one by name).
 *
 * Everything here is iynk's own rules and op builders, imported unchanged: `placeBatch` and `seatOnSurface` for placing,
 * `moveSeated` and `turnSeated` for moving and turning a part in holes, `legRecipe` for legs leaving holes,
 * `deleteBatch` for removing (what the 2D Studio's Delete key does), `canConnect` and `wireRecipe` for wires. Refusals
 * carry iynk's codes, so `refusalText` words them with iynk's six-language messages. Pure: no IWSDK, no three.js.
 *
 * Points are document millimetres in the project's breadboard view (top left origin, y towards the person); the bench
 * converts from the board frame with `x_mm = x * 1000`, `y_mm = z * 1000`.
 */
import { newId } from '@/core/ids';
import { builtinRegistry } from '@/parts/builtin';
import type { PartRegistry } from '@/parts/registry';
import type { Op, Placement, Project, View, Wire, WireColor, WireEnd } from '@/project/generated/types';
import { createSession } from '@/project/session';
import type { PointMm, ResolvedPartShape, Rotation, Scene } from '@/studio/engine/types';
import { resolvePart } from '@/studio/parts-view';
import { canConnect, endLabel, legRecipe, sameEnd, wireRecipe } from '@/studio/rules/connect';
import type { Access, Refusal, StaticFlag, WireEndRef } from '@/studio/rules/connect';
import type { DocView } from '@/studio/stores/doc';
import { placeBatch } from '@/studio/tools/place';
import type { PlaceDeps, PlaceRefusal } from '@/studio/tools/place';
import { moveSeated, turnSeated } from '@/studio/tools/seat';
import { deleteBatch } from '@/studio/tools/select';
import type { DeleteRefusal } from '@/studio/tools/select';
import type { ToolCtx } from '@/studio/tools/types';
import { seatedAt } from '@/studio/views/breadboard';
import type { IdSource } from '@/studio/views/breadboard';
import deWire from '@/i18n/messages/de/studioWire.json';
import enWire from '@/i18n/messages/en/studioWire.json';
import esWire from '@/i18n/messages/es/studioWire.json';
import frWire from '@/i18n/messages/fr/studioWire.json';
import hiWire from '@/i18n/messages/hi/studioWire.json';
import zhWire from '@/i18n/messages/zh/studioWire.json';
import deEdit from '@/i18n/messages/de/studioEdit.json';
import enEdit from '@/i18n/messages/en/studioEdit.json';
import esEdit from '@/i18n/messages/es/studioEdit.json';
import frEdit from '@/i18n/messages/fr/studioEdit.json';
import hiEdit from '@/i18n/messages/hi/studioEdit.json';
import zhEdit from '@/i18n/messages/zh/studioEdit.json';
import deInspect from '@/i18n/messages/de/studioInspect.json';
import enInspect from '@/i18n/messages/en/studioInspect.json';
import esInspect from '@/i18n/messages/es/studioInspect.json';
import frInspect from '@/i18n/messages/fr/studioInspect.json';
import hiInspect from '@/i18n/messages/hi/studioInspect.json';
import zhInspect from '@/i18n/messages/zh/studioInspect.json';
import type { Lang } from '../../contracts/common';
import { format } from './text';

export type { IdSource, StaticFlag, WireEndRef };

/** Why an action did nothing. iynk's codes first (`Refusal` in connect.ts, place and delete refusals), then the few the bench adds. */
export type ActionReason =
  | Refusal
  | PlaceRefusal
  | DeleteRefusal
  /** `turnSeated` found no free holes for the turned legs (iynk: `edit.seat.rotateBlocked`). */
  | 'rotate-blocked'
  /** The document has no breadboard view, so there is nowhere to build. */
  | 'no-breadboard-view'
  | 'unknown-part'
  | 'unknown-wire'
  /** Pulling out a part that sits in no holes. */
  | 'not-seated'
  /** The action would leave the document as it is (an empty batch cannot be applied). */
  | 'unchanged'
  /** A route holds at most `MAX_BENDS` waypoints (design 5). */
  | 'too-many-bends'
  /** Parts turn in 90 degree steps, boards in 15 (design 3.4.9). */
  | 'bad-rotation'
  /** Not one of the ten project colours. */
  | 'bad-color'
  /** The arguments are missing or of the wrong shape (an assistant's call). */
  | 'bad-args';

export type ActionRefusal = { ok: false; reason: ActionReason; args: Record<string, string> };
export type ActionDone<X extends object = object> = { ok: true; ops: Op[]; label: string } & X;
export type ActionResult<X extends object = object> = ActionDone<X> | ActionRefusal;

export interface ActionEnv {
  /** Part descriptors; iynk's built in registry by default. */
  registry?: PartRegistry;
  /** Where new entity ids come from (`cmp_`, `net_`, `wir_`); random iynk ids by default. Inject one for deterministic tests. */
  ids?: IdSource;
  /** What the person may do with the open project (connect.ts `Access`); `edit` by default. */
  access?: Access;
}

/** A point in the breadboard view's document frame. */
export type DocPoint = { x_mm: number; y_mm: number };

/** The ten project colours, in the 2D Studio's order (its Inspector shows them as two rows of five). */
export const WIRE_COLOURS: readonly WireColor[] = ['red', 'black', 'orange', 'yellow', 'green', 'blue', 'white', 'purple', 'brown', 'grey'];
/** At most four bends per wire (design 5), stored as its `route_mm` waypoints. */
export const MAX_BENDS = 4;
/** Parts turn by quarter turns, boards in 15 degree steps (design 3.4.9). */
export const PART_TURN_DEG = 90;
export const BOARD_TURN_DEG = 15;

/** The 2D Studio's default grid step (`stores/ui.ts`), which loose parts snap to. */
const SNAP_MM = 2.54;
const VIEWPORT = { cx_mm: 0, cy_mm: 0, k: 1, w: 0, h: 0, dpr: 1 };
const randomIds: IdSource = (prefix) => newId(prefix);
const round2 = (n: number): number => Math.round(n * 100) / 100;
const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

let defaultRegistry: PartRegistry | undefined;
const registryOf = (env: ActionEnv): PartRegistry => env.registry ?? (defaultRegistry ??= builtinRegistry());

const refuse = (reason: ActionReason, args: Record<string, string> = {}): ActionRefusal => ({ ok: false, reason, args });
const done = <X extends object>(ops: Op[], label: string, extra: X): ActionDone<X> => ({ ok: true, ops, label, ...extra });

/** What every action works on: the breadboard view and the slice of the Studio's tool context iynk's builders read. */
interface Bench {
  state: Project;
  view: View;
  registry: PartRegistry;
  ids: IdSource;
  access: Access;
  ctx: ToolCtx;
}

/** The view the bench builds in: the document's breadboard view, as `bench/space.ts` lays it out. */
export const breadboardViewOf = (doc: Project): View | undefined => doc.views.find((v) => v.kind === 'breadboard');

const rotationOf = (placement: Placement): Rotation => norm360(placement.rotation_deg ?? 0) as Rotation;

/**
 * Where each placement is drawn: a part in holes sits where its legs put it (`seatedAt`, as the Studio's draw list
 * does), anything else at its placement. `moveSeated` reads these as the 2D canvas's scene items.
 */
function drawnOrigins(state: Project, view: View, resolve: (ref: string) => ResolvedPartShape): Map<string, PointMm> {
  const defs = new Map([...state.boards, ...state.components].map((x) => [x.id, x.definition.ref]));
  const surfaceAt = view.placements.find((p) => p.c === view.surface);
  const surfaceDef = view.surface === undefined ? undefined : defs.get(view.surface);
  const holes = new Map(surfaceDef === undefined ? [] : resolve(surfaceDef).pins.map((pin) => [pin.id, pin]));
  const origins = new Map<string, PointMm>();
  for (const p of view.placements) {
    const def = defs.get(p.c);
    const seat = surfaceAt && def !== undefined && p.c !== view.surface && p.legs ? seatedAt(resolve(def), rotationOf(p), p.legs, holes, { x: surfaceAt.x_mm, y: surfaceAt.y_mm }) : null;
    origins.set(p.c, seat ?? { x: p.x_mm, y: p.y_mm });
  }
  return origins;
}

/**
 * The minimal Studio `ToolCtx` iynk's builders need, from the document: the view, the part shapes (`resolvePart`), the
 * drawn origins as scene items, the Studio's snap step. Nothing in it is hit or drawn.
 */
function toolCtx(state: Project, view: View, registry: PartRegistry, readOnly: boolean): ToolCtx {
  const resolve = (ref: string) => resolvePart(state, ref, registry);
  const items = [...drawnOrigins(state, view, resolve)].map(([id, at]) => ({ id, kind: 'part', xMm: at.x, yMm: at.y }));
  const doc = { revision: state.revision, state, canUndo: false, canRedo: false, saveChip: readOnly ? 'read-only' : 'saved', readOnly } satisfies DocView;
  return {
    doc,
    view,
    viewport: VIEWPORT,
    scene: { viewId: view.id, items, targets: [] } as unknown as Scene,
    selection: [],
    snapMm: SNAP_MM,
    hit: () => null,
    resolve,
  };
}

function benchOf(doc: Project, env: ActionEnv): Bench | ActionRefusal {
  const access = env.access ?? 'edit';
  if (access === 'read-only') return refuse('read-only');
  if (access === 'viewer') return refuse('permission');
  const view = breadboardViewOf(doc);
  if (!view) return refuse('no-breadboard-view');
  const registry = registryOf(env);
  return { state: doc, view, registry, ids: env.ids ?? randomIds, access, ctx: toolCtx(doc, view, registry, false) };
}

const refdesOf = (state: Project, id: string): string => [...state.boards, ...state.components].find((x) => x.id === id)?.refdes ?? id;
const isBoard = (state: Project, id: string): boolean => state.boards.some((b) => b.id === id);
const isPoint = (p: unknown): p is DocPoint =>
  typeof p === 'object' && p !== null && Number.isFinite((p as DocPoint).x_mm) && Number.isFinite((p as DocPoint).y_mm);
const isEnd = (e: unknown): e is WireEndRef => {
  const end = e as WireEndRef | null;
  if (typeof end !== 'object' || end === null) return false;
  if (end.kind === 'pin') return typeof end.c === 'string' && typeof end.p === 'string';
  return end.kind === 'hole' && typeof end.surface === 'string' && typeof end.hole === 'string';
};

/** The name of a wire end as the Studio writes it (`U1.D13`, `a10`); a junction by its id. */
function endName(state: Project, end: WireEnd): string {
  return end.kind === 'junction' ? end.id : endLabel(state, end);
}
const wireName = (state: Project, wire: Wire): string => `${endName(state, wire.from)} to ${endName(state, wire.to)}`;

function placementOf(b: Bench, part: unknown): Placement | ActionRefusal {
  if (typeof part !== 'string') return refuse('bad-args', { part: String(part) });
  return b.view.placements.find((p) => p.c === part) ?? refuse('unknown-part', { part });
}

function wireOf(b: Bench, wire: unknown): Wire | ActionRefusal {
  if (typeof wire !== 'string') return refuse('bad-args', { wire: String(wire) });
  return b.view.wires.find((w) => w.id === wire) ?? refuse('unknown-wire', { wire });
}

const isRefusal = (x: object): x is ActionRefusal => 'ok' in x && x.ok === false;

/**
 * Where a part is drawn in the breadboard view: its layout corner, the point `movePart` moves. A part in holes is where
 * its legs put it; anything else is at its placement. Undefined when the part is not in the view.
 */
export function partOrigin(doc: Project, part: string, env: ActionEnv = {}): DocPoint | undefined {
  const view = breadboardViewOf(doc);
  if (!view) return undefined;
  const registry = registryOf(env);
  const at = drawnOrigins(doc, view, (ref) => resolvePart(doc, ref, registry)).get(part);
  return at && { x_mm: at.x, y_mm: at.y };
}

// ---------------------------------------------------------------------------------------------------------- parts

export type PlacePartArgs = { ref: string; at: DocPoint };
export type Placed = { id: string; refdes: string; loose: boolean; chip: boolean };

/** Session calls `placeBatch` never makes (it only reads the registry and the id source). */
const NO_SESSION = {} as PlaceDeps['session'];

/**
 * Puts a new part into the breadboard view (iynk's `placeBatch`): over the breadboard its first leg seats in the
 * nearest hole within 1.5 pitches that takes every leg (4 for a chip across the centre channel), otherwise it lies loose
 * with its middle at `at`. A board lies with its middle at `at`. One batch: the dependency, the part, its placement and
 * the net ops of its legs.
 */
export function placePart(doc: Project, args: PlacePartArgs, env: ActionEnv = {}): ActionResult<Placed> {
  const b = benchOf(doc, env);
  if (isRefusal(b)) return b;
  if (typeof args?.ref !== 'string' || !isPoint(args.at)) return refuse('bad-args', { ref: String(args?.ref) });
  const placed = placeBatch(b.ctx, { registry: b.registry, session: NO_SESSION, ids: b.ids }, args.ref, { x: args.at.x_mm, y: args.at.y_mm });
  if ('refused' in placed) return refuse(placed.refused, { ref: args.ref });
  return done(placed.batch, placed.label, { id: placed.id, refdes: placed.refdes, loose: placed.loose, chip: placed.chip });
}

export type MovePartArgs = {
  part: string;
  /** Where the part's layout corner goes (its drawn top left, which is `x_mm`, `y_mm` for a part that is not in holes). */
  to: DocPoint;
  /** False lays it loose at `to` even over holes; by default it seats where its first leg lands, as the 2D Studio's drag does. */
  seat?: boolean;
};
export type Moved = { seated: boolean; unseated: boolean };

/** The ops that lay a part loose at `x`, `y` and let its legs go of the strips they were in (`legRecipe` with no legs). */
function looseOps(b: Bench, placement: Placement, x: number, y: number): Op[] {
  const next: Placement = { ...placement, x_mm: round2(x), y_mm: round2(y) };
  delete next.legs;
  const ops: Op[] = [{ k: 'view.place', view: b.view.id, placement: next }];
  if (placement.legs !== undefined) ops.push(...legRecipe(b.state, b.view.id, placement.c, {}, b.ids));
  return ops;
}

const seatedIn = (ops: Op[]): boolean => {
  const place = ops.find((op) => op.k === 'view.place');
  return place?.k === 'view.place' && place.placement.legs !== undefined;
};

/**
 * Moves a part to a point. A part that can sit in holes goes through `moveSeated`: it seats where its first leg lands,
 * or lies where it was dropped and lets go of its strips (`unseated`). Boards, the breadboard itself and parts with no
 * legs move with a plain `view.place`.
 */
export function movePart(doc: Project, args: MovePartArgs, env: ActionEnv = {}): ActionResult<Moved> {
  const b = benchOf(doc, env);
  if (isRefusal(b)) return b;
  const placement = placementOf(b, args?.part);
  if (isRefusal(placement)) return placement;
  if (!isPoint(args.to)) return refuse('bad-args', { part: placement.c });
  const origin = drawnOrigins(b.state, b.view, b.ctx.resolve).get(placement.c)!;
  const dx = round2(args.to.x_mm - origin.x);
  const dy = round2(args.to.y_mm - origin.y);
  if (dx === 0 && dy === 0) return refuse('unchanged', { part: placement.c });
  const label = `Move ${refdesOf(b.state, placement.c)}`;
  if (args.seat !== false) {
    const moved = moveSeated(b.ctx, placement.c, dx, dy, b.ids);
    if (moved) return done(moved.batch, label, { seated: seatedIn(moved.batch), unseated: moved.unseated });
  }
  const ops = looseOps(b, placement, origin.x + dx, origin.y + dy);
  return done(ops, label, { seated: false, unseated: placement.legs !== undefined });
}

export type PullPartArgs = { part: string };

/** Pulls a seated part out of its holes: it lies loose where it is drawn and its legs let go of their strips (`legRecipe`). */
export function pullPart(doc: Project, args: PullPartArgs, env: ActionEnv = {}): ActionResult {
  const b = benchOf(doc, env);
  if (isRefusal(b)) return b;
  const placement = placementOf(b, args?.part);
  if (isRefusal(placement)) return placement;
  if (!placement.legs || Object.keys(placement.legs).length === 0) return refuse('not-seated', { part: placement.c, refdes: refdesOf(b.state, placement.c) });
  const origin = drawnOrigins(b.state, b.view, b.ctx.resolve).get(placement.c)!;
  return done(looseOps(b, placement, origin.x, origin.y), `Pull out ${refdesOf(b.state, placement.c)}`, {});
}

export type TurnPartArgs = {
  part: string;
  /** The rotation to end at, in degrees: a multiple of 90 for a part, of 15 for a board. */
  deg?: number;
  /** Or one step from where it is: 90 degrees for a part, 15 for a board. */
  step?: 1 | -1;
};
export type Turned = { deg: number };

/**
 * Turns a part. A part in holes turns about its first leg through `turnSeated` and is refused (`rotate-blocked`) when
 * the turned legs find no free holes; anything else turns in place (the Studio's plain turn). Boards turn in 15 degree
 * steps, everything else in quarter turns.
 */
export function turnPart(doc: Project, args: TurnPartArgs, env: ActionEnv = {}): ActionResult<Turned> {
  const b = benchOf(doc, env);
  if (isRefusal(b)) return b;
  const placement = placementOf(b, args?.part);
  if (isRefusal(placement)) return placement;
  const board = isBoard(b.state, placement.c);
  const unit = board ? BOARD_TURN_DEG : PART_TURN_DEG;
  const current = norm360(placement.rotation_deg ?? 0);
  const wanted = args.deg !== undefined ? args.deg : args.step === 1 || args.step === -1 ? current + args.step * unit : NaN;
  if (!Number.isFinite(wanted)) return refuse('bad-args', { part: placement.c });
  const deg = norm360(wanted);
  if (Math.abs(deg / unit - Math.round(deg / unit)) > 1e-9) return refuse('bad-rotation', { deg: String(args.deg), step: String(unit) });
  if (deg === current) return refuse('unchanged', { part: placement.c });
  const refdes = refdesOf(b.state, placement.c);
  const label = `Rotate ${refdes}`;
  if (!board) {
    const seated = turnSeated(b.ctx, placement.c, deg as Rotation, b.ids);
    if (seated && 'blocked' in seated) return refuse('rotate-blocked', { refdes });
    if (seated) return done(seated.batch, label, { deg });
  }
  return done([{ k: 'view.place', view: b.view.id, placement: { ...placement, rotation_deg: deg } }], label, { deg });
}

export type RemovePartArgs = { part: string };

/** Removes a part with its wires and its place in every net, as the 2D Studio's Delete does (`deleteBatch`). The only board stays. */
export function removePart(doc: Project, args: RemovePartArgs, env: ActionEnv = {}): ActionResult {
  const b = benchOf(doc, env);
  if (isRefusal(b)) return b;
  const placement = placementOf(b, args?.part);
  if (isRefusal(placement)) return placement;
  const result = deleteBatch(b.state, [{ kind: 'part', view: b.view.id, id: placement.c }], 'cut-connection', false, b.ids);
  if ('refused' in result) return refuse(result.refused, { refdes: refdesOf(b.state, placement.c) });
  return done(result.batch, result.label, {});
}

// ---------------------------------------------------------------------------------------------------------- wires

export type AddWireArgs = { from: WireEndRef; to: WireEndRef };
export type WireMade = { wire: string; flags: StaticFlag[] };

const madeWire = (ops: Op[]): string => {
  const add = ops.find((op) => op.k === 'wire.add');
  return add?.k === 'wire.add' ? add.wire.id : '';
};

/**
 * Adds a wire between two ends, a pin (`{ kind: 'pin', c, p }`) or a breadboard hole (`{ kind: 'hole', surface, hole }`):
 * `canConnect` says whether it may be drawn, `wireRecipe` makes it with its net ops and the Studio's colour (black on a
 * ground net, red on a supply net, else the next of blue, green, yellow, orange, purple, brown). `flags` are the
 * electrical mistakes it makes (advisory, never refused).
 */
export function addWire(doc: Project, args: AddWireArgs, env: ActionEnv = {}): ActionResult<WireMade> {
  const b = benchOf(doc, env);
  if (isRefusal(b)) return b;
  if (!isEnd(args?.from) || !isEnd(args.to)) return refuse('bad-args', {});
  const verdict = canConnect(b.state, b.view.id, args.from, args.to, b.access);
  if (!verdict.ok) return refuse(verdict.code, verdict.args);
  const recipe = wireRecipe(b.state, b.view.id, args.from, args.to, b.ids);
  return done(recipe.batch, recipe.label, { wire: madeWire(recipe.batch), flags: recipe.flags });
}

export type MoveWireEndArgs = { wire: string; end: 'from' | 'to'; to: WireEndRef };

/** A throwaway session over `state`, for reading the document between two halves of one batch. */
function scratch(state: Project) {
  return createSession({ state, clock: () => 0, rnd: { bytes: (n: number) => new Uint8Array(n) } });
}

/**
 * Moves one end of a wire to another pin or hole. One batch: the wire's removal as the Studio deletes it (with the net
 * ops its cut needs), then the wire again from the end it keeps to the new end through `canConnect` and `wireRecipe`,
 * under the same id and in the same colour. The route is dropped, since its bends were for the old end.
 */
export function moveWireEnd(doc: Project, args: MoveWireEndArgs, env: ActionEnv = {}): ActionResult<WireMade> {
  const b = benchOf(doc, env);
  if (isRefusal(b)) return b;
  const wire = wireOf(b, args?.wire);
  if (isRefusal(wire)) return wire;
  if ((args.end !== 'from' && args.end !== 'to') || !isEnd(args.to)) return refuse('bad-args', { wire: wire.id });
  const kept = args.end === 'from' ? wire.to : wire.from;
  const moving = args.end === 'from' ? wire.from : wire.to;
  if (kept.kind === 'junction') return refuse('bad-args', { wire: wire.id, end: 'junction' });
  if (moving.kind !== 'junction' && sameEnd(moving, args.to)) return refuse('unchanged', { wire: wire.id });

  const cut = deleteBatch(b.state, [{ kind: 'wire', view: b.view.id, id: wire.id }], 'cut-connection', false, b.ids);
  if ('refused' in cut) return refuse(cut.refused, {});
  const session = scratch(b.state);
  const applied = session.apply(cut.batch, { actor: b.state.access.owners[0] ?? 'local', kind: 'user' });
  if (!applied.ok) return refuse('bad-args', { wire: wire.id, reject: applied.reject });
  const after = session.state;

  const [a, z] = args.end === 'from' ? [args.to, kept] : [kept, args.to];
  const verdict = canConnect(after, b.view.id, a, z, b.access);
  if (!verdict.ok) return refuse(verdict.code, verdict.args);
  const sameId = ((prefix) => (prefix === 'wir' ? wire.id : b.ids(prefix))) as IdSource;
  const recipe = wireRecipe(after, b.view.id, a, z, sameId);
  const ops = recipe.batch.map((op): Op => {
    if (op.k !== 'wire.add') return op;
    const again: Wire = { ...op.wire };
    if (wire.color === undefined) delete again.color;
    else again.color = wire.color;
    return { ...op, wire: again };
  });
  return done([...cut.batch, ...ops], `Move wire end to ${endLabel(after, args.to)}`, { wire: wire.id, flags: recipe.flags });
}

export type RecolourWireArgs = { wire: string; color: WireColor };

/** Gives a wire one of the ten project colours (one `wire.set`, as the 2D Studio's Inspector does). */
export function recolourWire(doc: Project, args: RecolourWireArgs, env: ActionEnv = {}): ActionResult {
  const b = benchOf(doc, env);
  if (isRefusal(b)) return b;
  const wire = wireOf(b, args?.wire);
  if (isRefusal(wire)) return wire;
  if (!WIRE_COLOURS.includes(args.color)) return refuse('bad-color', { color: String(args.color) });
  if ((wire.color ?? 'grey') === args.color) return refuse('unchanged', { wire: wire.id });
  return done([{ k: 'wire.set', view: b.view.id, id: wire.id, color: args.color }], `Colour wire ${wire.id}`, {});
}

export type RouteWireArgs = { wire: string; route_mm: ReadonlyArray<readonly [number, number]> };

/** Bends a wire through at most four waypoints (document mm), stored as its `route_mm`. An empty route straightens it. */
export function routeWire(doc: Project, args: RouteWireArgs, env: ActionEnv = {}): ActionResult {
  const b = benchOf(doc, env);
  if (isRefusal(b)) return b;
  const wire = wireOf(b, args?.wire);
  if (isRefusal(wire)) return wire;
  if (!Array.isArray(args.route_mm)) return refuse('bad-args', { wire: wire.id });
  if (args.route_mm.length > MAX_BENDS) return refuse('too-many-bends', { limit: String(MAX_BENDS) });
  if (!args.route_mm.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return refuse('bad-args', { wire: wire.id });
  if (args.route_mm.length === 0) return straightenWire(doc, { wire: wire.id }, env);
  const route = args.route_mm.map(([x, y]): [number, number] => [round2(x), round2(y)]);
  const before = (wire.route_mm ?? []).map(([x, y]) => [x, y]);
  if (JSON.stringify(before) === JSON.stringify(route)) return refuse('unchanged', { wire: wire.id });
  return done([{ k: 'wire.route', view: b.view.id, id: wire.id, route_mm: route }], `Route wire ${wireName(b.state, wire)}`, {});
}

export type WireArgs = { wire: string };

/** Takes every bend out of a wire (`wire.route` with no waypoints clears `route_mm`). */
export function straightenWire(doc: Project, args: WireArgs, env: ActionEnv = {}): ActionResult {
  const b = benchOf(doc, env);
  if (isRefusal(b)) return b;
  const wire = wireOf(b, args?.wire);
  if (isRefusal(wire)) return wire;
  if (!wire.route_mm?.length) return refuse('unchanged', { wire: wire.id });
  return done([{ k: 'wire.route', view: b.view.id, id: wire.id, route_mm: [] }], `Straighten wire ${wireName(b.state, wire)}`, {});
}

/** Removes a wire with the net ops its cut needs, as the 2D Studio's Delete does (`deleteBatch`). */
export function removeWire(doc: Project, args: WireArgs, env: ActionEnv = {}): ActionResult {
  const b = benchOf(doc, env);
  if (isRefusal(b)) return b;
  const wire = wireOf(b, args?.wire);
  if (isRefusal(wire)) return wire;
  const result = deleteBatch(b.state, [{ kind: 'wire', view: b.view.id, id: wire.id }], 'cut-connection', false, b.ids);
  if ('refused' in result) return refuse(result.refused, {});
  return done(result.batch, result.label, {});
}

// ---------------------------------------------------------------------------------------------------------- catalogue

const BUILD_ACTIONS = {
  placePart,
  movePart,
  pullPart,
  turnPart,
  removePart,
  addWire,
  moveWireEnd,
  recolourWire,
  routeWire,
  straightenWire,
  removeWire,
} as const;

export type ActionName = keyof typeof BUILD_ACTIONS;

export interface ActionSpec {
  readonly name: ActionName;
  /** Each argument and its shape, in words an assistant reads. Optional ones end in `?`. */
  readonly args: Readonly<Record<string, string>>;
  /** What it does, in one sentence. */
  readonly does: string;
}

const END = "{ kind: 'pin', c: part id, p: pin id } or { kind: 'hole', surface: breadboard id, hole: hole name like 'a10' }";
const POINT = '{ x_mm, y_mm } in the breadboard view, document millimetres';

/** Every build action, for an assistant to list. Each one returns `{ ok: true, ops, label }` or `{ ok: false, reason, args }`. */
export const ACTIONS: readonly ActionSpec[] = [
  { name: 'placePart', args: { ref: 'part definition ref, like core.led-5mm', at: `${POINT}: where its first leg goes` }, does: 'Adds a new part: it seats in the breadboard holes under its first leg, or lies loose with its middle at the point.' },
  { name: 'movePart', args: { part: 'part or board id', to: `${POINT}: its new top left corner`, 'seat?': 'false to lay it loose even over holes' }, does: 'Moves a part: a part with legs seats where its first leg lands or lies loose, a board just moves.' },
  { name: 'pullPart', args: { part: 'id of a part seated in holes' }, does: 'Pulls a part out of its holes so it lies loose where it is.' },
  { name: 'turnPart', args: { part: 'part or board id', 'deg?': 'rotation to end at: a multiple of 90 for a part, of 15 for a board', 'step?': '1 or -1: one step from where it is' }, does: 'Turns a part by quarter turns about its first leg, or a board in 15 degree steps.' },
  { name: 'removePart', args: { part: 'part or board id' }, does: 'Removes a part with its wires and its connections; the only board stays.' },
  { name: 'addWire', args: { from: END, to: END }, does: 'Adds a wire between two pins or holes, coloured as the 2D Studio colours it.' },
  { name: 'moveWireEnd', args: { wire: 'wire id', end: "'from' or 'to'", to: END }, does: 'Moves one end of a wire to another pin or hole, keeping its colour.' },
  { name: 'recolourWire', args: { wire: 'wire id', color: WIRE_COLOURS.join(', ') }, does: 'Gives a wire one of the ten project colours.' },
  { name: 'routeWire', args: { wire: 'wire id', route_mm: `up to ${MAX_BENDS} waypoints [x_mm, y_mm]` }, does: 'Bends a wire through up to four waypoints.' },
  { name: 'straightenWire', args: { wire: 'wire id' }, does: 'Takes every bend out of a wire.' },
  { name: 'removeWire', args: { wire: 'wire id' }, does: 'Removes a wire and splits its net where the wire was the only link.' },
];

/** Calls a build action by name with plain arguments, for an assistant. An unknown name is refused as `bad-args`. */
export function runAction(doc: Project, name: string, args: unknown, env: ActionEnv = {}): ActionResult<object> {
  const action = (BUILD_ACTIONS as Record<string, (doc: Project, args: never, env: ActionEnv) => ActionResult<object>>)[name];
  if (!action) return refuse('bad-args', { action: name });
  return action(doc, (args ?? {}) as never, env);
}

// ---------------------------------------------------------------------------------------------------------- wording

type Messages = Readonly<Record<string, unknown>>;
type Namespace = 'studioWire' | 'studioEdit' | 'studioInspect';

const MESSAGES: Readonly<Record<Lang, Readonly<Record<Namespace, Messages>>>> = {
  en: { studioWire: enWire, studioEdit: enEdit, studioInspect: enInspect },
  de: { studioWire: deWire, studioEdit: deEdit, studioInspect: deInspect },
  es: { studioWire: esWire, studioEdit: esEdit, studioInspect: esInspect },
  fr: { studioWire: frWire, studioEdit: frEdit, studioInspect: frInspect },
  hi: { studioWire: hiWire, studioEdit: hiEdit, studioInspect: hiInspect },
  zh: { studioWire: zhWire, studioEdit: zhEdit, studioInspect: zhInspect },
};

/** Where iynk words a refusal: its message file and key. Null for the bench's own codes, which only an assistant's call can meet. */
export function refusalMessageKey(refusal: Pick<ActionRefusal, 'reason' | 'args'>): { ns: Namespace; key: string } | null {
  switch (refusal.reason) {
    case 'quota':
      // a wire's quota names the limit it reached; a part's does not
      return refusal.args.limit !== undefined ? { ns: 'studioWire', key: 'wire.refuse.quota' } : { ns: 'studioEdit', key: 'edit.place.quota' };
    case 'unknown-definition':
      return { ns: 'studioEdit', key: 'edit.place.unknownDefinition' };
    case 'board-view':
      return { ns: 'studioEdit', key: 'edit.place.boardView' };
    case 'rotate-blocked':
      return { ns: 'studioEdit', key: 'edit.seat.rotateBlocked' };
    case 'last-board':
      return { ns: 'studioInspect', key: 'select.refuse.last-board' };
    case 'same-pin':
    case 'no-such-pin':
    case 'mechanical-pin':
    case 'not-on-view':
    case 'hole-not-on-surface':
    case 'same-strip':
    case 'duplicate-wire':
    case 'empty-target':
    case 'permission':
    case 'read-only':
      return { ns: 'studioWire', key: `wire.refuse.${refusal.reason}` };
    default:
      return null;
  }
}

function lookup(messages: Messages, key: string): string | undefined {
  // iynk's keys hold dots inside a segment (`wire.refuse.same-pin` is wire → refuse → same-pin), never inside a name
  let at: unknown = messages;
  for (const part of key.split('.')) at = typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[part] : undefined;
  return typeof at === 'string' ? at : undefined;
}

/** A refusal in the person's language with iynk's own message, or null when iynk has none (a bench code). */
export function refusalText(lang: Lang, refusal: Pick<ActionRefusal, 'reason' | 'args'>): string | null {
  const where = refusalMessageKey(refusal);
  if (!where) return null;
  const text = lookup(MESSAGES[lang][where.ns], where.key) ?? lookup(MESSAGES.en[where.ns], where.key);
  return text === undefined ? null : format(text, refusal.args);
}
