// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { stateHash } from "../../project/hash.ts";
import { createSession } from "../../project/session.ts";
import { seededRandom, steppingClock } from "../../project/session.testing.ts";
import { createRecordingDoc } from "../testing/recording-doc.ts";
import { keyboardRig, VIEW } from "../testing/keyboard-rig.ts";
import { projectWithBreadboard, registry } from "../testing/breadboard-fixture.ts";
import { createSessionStore } from "../stores/session.ts";
import { createToolHost } from "./host.ts";
import { resolvePart } from "../parts-view.ts";
import { buildDrawList } from "../engine/draw-list.ts";
import { stubArt } from "../engine/testing/mini-scene.ts";
import type { Hit } from "../engine/types.ts";
import { BREADBOARD_REF, surfaceGeom } from "../views/breadboard.ts";
import type { IdSource } from "../views/breadboard.ts";
import { legRecipe } from "../rules/connect.ts";
import type { WireEndRef } from "../rules/connect.ts";
import {
  COARSE_STEPS,
  commitWirePick,
  createAnnouncer,
  createNudger,
  firstFreePin,
  focusNextPart,
  netOfSelection,
  partName,
  pickWireEnds,
  pinEntries,
  placeAtCentre,
  rotateBatch,
} from "./keyboard.ts";
import { createWireTool } from "./wire.ts";
import type { ToolCtx, ToolPointerEvent } from "./types.ts";

const pin = (c: string, p: string): WireEndRef => ({ kind: "pin", c, p });

const counterIds = (): IdSource => {
  let n = 0;
  return (prefix) => `${prefix}_k${++n}`;
};

describe("createAnnouncer", () => {
  it("keeps lines as a key with arguments, oldest first, each with its own id", () => {
    const announcer = createAnnouncer();
    const seen = vi.fn();
    announcer.lines.subscribe(seen);
    announcer.say("studioWire.announce.wireMade", { from: "D1.A", to: "U1.D13" });
    announcer.say("studioWire.announce.readOnly", undefined, "assertive");
    const lines = announcer.lines.getState();
    expect(lines.map((l) => l.key)).toEqual(["studioWire.announce.wireMade", "studioWire.announce.readOnly"]);
    expect(lines[0]).toMatchObject({ args: { from: "D1.A", to: "U1.D13" }, politeness: "polite" });
    expect(lines[1]).toMatchObject({ args: {}, politeness: "assertive" });
    expect(lines[0]!.id).not.toBe(lines[1]!.id);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("drops the oldest lines past twenty", () => {
    const announcer = createAnnouncer();
    for (let i = 0; i < 25; i++) announcer.say("k", { i });
    const lines = announcer.lines.getState();
    expect(lines).toHaveLength(20);
    expect(lines[0]!.args).toEqual({ i: 5 });
  });
});

describe("createNudger", () => {
  const placement = (rig: ReturnType<typeof keyboardRig>, c: string) => rig.ctx().view.placements.find((p) => p.c === c)!;
  const step = { fine: false, coarse: false };

  it("adds the steps of one key-hold into one view.place batch", () => {
    const rig = keyboardRig();
    const nudger = createNudger();
    const before = placement(rig, rig.circuit.uno);
    for (let i = 0; i < 3; i++) expect(nudger.nudge(rig.ctx(), [rig.circuit.uno], 1, 0, step)).toEqual({ kind: "preview" });
    const result = nudger.flush(rig.ctx());
    if (result.kind !== "commit") throw new Error(result.kind);
    expect(result.batch).toEqual([{ k: "view.place", view: VIEW, placement: { ...before, x_mm: Math.round((before.x_mm + 3 * 2.54) * 100) / 100 } }]);
    expect(result.label).toBe("Move U1");
    expect(nudger.flush(rig.ctx())).toEqual({ kind: "none" });
  });

  it("moves ten steps with coarse and 0.01 mm with fine", () => {
    const rig = keyboardRig();
    const nudger = createNudger();
    nudger.nudge(rig.ctx(), [rig.circuit.uno], 0, 1, { fine: false, coarse: true });
    const coarse = nudger.flush(rig.ctx());
    nudger.nudge(rig.ctx(), [rig.circuit.uno], 0, -1, { fine: true, coarse: true });
    const fine = nudger.flush(rig.ctx());
    const y = (r: typeof coarse) => (r.kind === "commit" && r.batch[0]!.k === "view.place" ? r.batch[0].placement : null);
    expect(y(coarse)!.y_mm).toBeCloseTo(placement(rig, rig.circuit.uno).y_mm + COARSE_STEPS * 2.54, 5);
    expect(y(fine)!.y_mm).toBeCloseTo(placement(rig, rig.circuit.uno).y_mm - 0.01, 5);
  });

  it("seats a part in holes in the next columns, a hole at a time, and the nets follow its legs", () => {
    const rig = keyboardRig();
    const nudger = createNudger(counterIds());
    nudger.nudge(rig.ctx(), [rig.circuit.led], 1, 0, step);
    const result = nudger.flush(rig.ctx());
    if (result.kind !== "commit") throw new Error(result.kind);
    expect(result.label).toBe("Move D1");
    expect(result.batch[0]).toMatchObject({ k: "view.place", placement: { c: rig.circuit.led, legs: { A: "b12", K: "b13" } } });
    expect(rig.doc.commit(result.batch, { label: result.label }).ok).toBe(true);
  });

  it("leaves a part in holes where it is when it is moved with others", () => {
    const rig = keyboardRig();
    const nudger = createNudger();
    nudger.nudge(rig.ctx(), [rig.circuit.uno, rig.circuit.r1], 1, 0, step);
    const result = nudger.flush(rig.ctx());
    if (result.kind !== "commit") throw new Error(result.kind);
    expect(result.batch).toHaveLength(1);
    expect(result.batch[0]).toMatchObject({ placement: { c: rig.circuit.uno } });
  });

  it("returns to the start with opposite keys and commits nothing", () => {
    const rig = keyboardRig();
    const nudger = createNudger();
    nudger.nudge(rig.ctx(), [rig.circuit.uno], 1, 0, step);
    nudger.nudge(rig.ctx(), [rig.circuit.uno], -1, 0, step);
    expect(nudger.flush(rig.ctx())).toEqual({ kind: "none" });
  });

  it("refuses in a read only project and forgets the steps on discard", () => {
    const rig = keyboardRig();
    const nudger = createNudger();
    nudger.nudge(rig.ctx(), [rig.circuit.uno], 1, 0, step);
    expect(nudger.ids()).toEqual([rig.circuit.uno]);
    nudger.discard();
    expect(nudger.ids()).toEqual([]);
    rig.doc.setSaveChip("read-only");
    expect(nudger.nudge(rig.ctx(), [rig.circuit.uno], 1, 0, step)).toEqual({ kind: "cancel" });
  });

  it("draws a ghost where the part is going", () => {
    const rig = keyboardRig();
    const nudger = createNudger();
    expect(nudger.preview(rig.ctx())).toEqual([]);
    nudger.nudge(rig.ctx(), [rig.circuit.r1], 1, 0, step);
    const ghost = nudger.preview(rig.ctx());
    expect(ghost.map((g) => g.id)).toEqual([`nudge:${rig.circuit.r1}`]);
  });
});

describe("pickWireEnds", () => {
  function pointerWire(from: WireEndRef, to: WireEndRef) {
    const rig = keyboardRig();
    const session = createSessionStore(VIEW);
    const host = createToolHost({ doc: rig.doc, session });
    host.register(createWireTool({ setStatus: session.setStatus, ids: counterIds() }));
    session.setTool("wire");
    let target: Hit | null = null;
    const ctx = (): ToolCtx => ({ ...rig.ctx(), hit: () => target });
    const ev = (type: ToolPointerEvent["type"]): ToolPointerEvent => ({ type, xPx: 0, yPx: 0, xMm: 0, yMm: 0, button: 0, shift: false, alt: false, ctrl: false, pointerType: "mouse", pointerId: 1 });
    target = { kind: "pin", c: (from as { c: string }).c, p: (from as { p: string }).p };
    host.pointer(ev("down"), ctx());
    host.pointer(ev("move"), ctx());
    target = { kind: "pin", c: (to as { c: string }).c, p: (to as { p: string }).p };
    host.pointer(ev("up"), ctx());
    return rig;
  }

  it("makes the wire the pointer makes: the same ops, so the same state", () => {
    const from = pin("brd_uno", "D8");
    const keyboard = keyboardRig();
    const to = pin(keyboard.circuit.button, "P1");
    const picked = pickWireEnds(keyboard.ctx(), from, to, counterIds());
    if (picked.kind !== "commit") throw new Error(picked.kind);
    keyboard.doc.commit(picked.batch, { label: picked.label });

    const pointer = pointerWire(from, pin(keyboard.circuit.button, "P1"));
    expect(pointer.doc.commits).toHaveLength(1);
    expect(pointer.doc.commits[0]!.batch).toEqual(picked.batch);
    expect(stateHash(keyboard.doc.getState().state)).toBe(stateHash(pointer.doc.getState().state));
    expect(picked).toMatchObject({ from: "U1.D8", to: expect.stringContaining("SW1.P1") });
  });

  it("says why a wire cannot be made", () => {
    const rig = keyboardRig();
    expect(pickWireEnds(rig.ctx(), pin("brd_uno", "D8"), pin("brd_uno", "D8"))).toMatchObject({ kind: "refused", code: "same-pin" });
    rig.doc.setSaveChip("read-only");
    expect(pickWireEnds(rig.ctx(), pin("brd_uno", "D8"), pin("brd_uno", "D9"))).toMatchObject({ kind: "refused", code: "read-only" });
  });
});

describe("commitWirePick", () => {
  it("commits the wire, selects it and says which ends it joins", () => {
    const rig = keyboardRig();
    const announcer = createAnnouncer();
    const ok = commitWirePick({ doc: rig.doc, session: rig.session, announcer }, rig.ctx(), pin("brd_uno", "D8"), pin(rig.circuit.button, "P1"));
    expect(ok).toBe(true);
    const added = rig.ctx().view.wires.find((w) => !rig.circuit.wires.includes(w.id))!;
    expect(rig.session.getState().selection).toEqual([{ kind: "wire", view: VIEW, id: added.id }]);
    expect(announcer.lines.getState().map((l) => l.key)).toEqual(["studioWire.announce.wireMade"]);
  });

  it("announces a refusal sharply and writes nothing", () => {
    const rig = keyboardRig();
    const announcer = createAnnouncer();
    const ok = commitWirePick({ doc: rig.doc, session: rig.session, announcer }, rig.ctx(), pin("brd_uno", "D8"), pin("brd_uno", "D8"));
    expect(ok).toBe(false);
    expect(rig.doc.commits).toHaveLength(0);
    expect(announcer.lines.getState()[0]).toMatchObject({ key: "studioWire.wire.refuse.same-pin", politeness: "assertive" });
  });
});

describe("focusNextPart", () => {
  it("walks the parts in refdes order from the first or last, wrapping, leaving the breadboard out", () => {
    const rig = keyboardRig();
    const { uno, r1, led, button } = rig.circuit;
    const pick = (id: string) => rig.session.setSelection([{ kind: "part", view: VIEW, id }]);
    expect(focusNextPart(rig.ctx(), 1)!.id).toBe(led);
    expect(focusNextPart(rig.ctx(), -1)!.id).toBe(uno);
    pick(led);
    expect(focusNextPart(rig.ctx(), 1)!.id).toBe(r1);
    pick(r1);
    expect(focusNextPart(rig.ctx(), 1)!.id).toBe(button);
    pick(uno);
    expect(focusNextPart(rig.ctx(), 1)!.id).toBe(led);
    pick(led);
    expect(focusNextPart(rig.ctx(), -1)!.id).toBe(uno);
  });
});

describe("rotateBatch", () => {
  it("turns a free part a quarter", () => {
    const rig = keyboardRig();
    rig.session.setSelection([{ kind: "part", view: VIEW, id: rig.circuit.uno }]);
    const left = rotateBatch(rig.ctx(), -1);
    expect(left?.batch[0]).toMatchObject({ k: "view.place", placement: { c: rig.circuit.uno, rotation_deg: 270 } });
    expect(left).toMatchObject({ count: 1, blocked: [] });
    expect(rotateBatch(rig.ctx(), 1)?.batch[0]).toMatchObject({ placement: { rotation_deg: 90 } });
  });

  it("seats a part in holes again when its turned legs land on free holes", () => {
    const rig = keyboardRig();
    rig.session.setSelection([{ kind: "part", view: VIEW, id: rig.circuit.r1 }]);
    const turned = rotateBatch(rig.ctx(), -1, counterIds())!;
    expect(turned).toMatchObject({ count: 1, blocked: [] });
    expect(turned.batch.find((op) => op.k === "view.place")).toMatchObject({ placement: { c: rig.circuit.r1, rotation_deg: 270, legs: { P1: "a5", P2: "e5" } } });
    expect(rig.doc.commit(turned.batch, { label: turned.label }).ok).toBe(true);
    const placed = rig.ctx().view.placements.find((p) => p.c === rig.circuit.r1)!;
    expect(placed.legs).toEqual({ P1: "a5", P2: "e5" });
    expect(rig.doc.getState().state.nets.some((n) => n.connections.some((x) => x.c === rig.circuit.r1 && x.p === "P2"))).toBe(true);
  });

  it("refuses a seated part, changing nothing, when a turned leg would land in a taken hole", () => {
    const rig = keyboardRig();
    const led = rig.ctx().view.placements.find((p) => p.c === rig.circuit.led)!;
    const legs = { A: "e5", K: "e6" };
    const moved = rig.doc.commit([{ k: "view.place", view: VIEW, placement: { ...led, legs } }, ...legRecipe(rig.doc.getState().state, VIEW, rig.circuit.led, legs, counterIds())], { label: "Move D1" });
    expect(moved.ok).toBe(true);
    rig.session.setSelection([{ kind: "part", view: VIEW, id: rig.circuit.r1 }]);
    const turned = rotateBatch(rig.ctx(), -1, counterIds())!;
    expect(turned).toMatchObject({ batch: [], count: 0, blocked: [rig.circuit.r1] });
  });
});

describe("pins", () => {
  it("lists the electrical pins with their net and the others on it", () => {
    const rig = keyboardRig();
    const entries = pinEntries(rig.doc.getState().state, VIEW);
    const d13 = entries.find((e) => e.part === "U1" && e.pin === "D13")!;
    expect(d13.net).not.toBeNull();
    expect(d13.others.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.part === "BB1")).toBe(false);
    expect(entries.find((e) => e.part === "D1" && e.end.p === "A")?.polarity).toBe("anode");
  });

  it("starts a wire at the first pin that is in no net, and names parts by refdes", () => {
    const rig = keyboardRig();
    const free = firstFreePin(rig.doc.getState().state, VIEW, "brd_uno");
    expect(free).not.toBeNull();
    const state = rig.doc.getState().state;
    expect(pinEntries(state, VIEW).find((e) => e.end.c === "brd_uno" && e.end.p === free!.p)!.net).toBeNull();
    expect(partName(state, "brd_uno")).toBe("U1");
    expect(partName(state, "gone")).toBe("gone");
  });

  it("finds the net of a selected wire or part", () => {
    const rig = keyboardRig();
    const state = rig.doc.getState().state;
    const wire = rig.ctx().view.wires[0]!;
    expect(netOfSelection(state, [{ kind: "wire", view: VIEW, id: wire.id }])).toBe(wire.net);
    expect(netOfSelection(state, [{ kind: "part", view: VIEW, id: "none" }])).toBeNull();
  });
});

describe("placeAtCentre", () => {
  it("puts the part where the view is centred", () => {
    const { project } = projectWithBreadboard();
    const doc = createRecordingDoc(createSession({ state: project, clock: steppingClock(), rnd: seededRandom() }));
    const session = createSessionStore("vw_bb");
    const geom = surfaceGeom(registry.latest(BREADBOARD_REF)!);
    const hole = geom.byName.get("b11")!;
    const viewport = { cx_mm: 10 + hole.xMm, cy_mm: 20 + hole.yMm, k: 8, w: 800, h: 600, dpr: 1 };
    const state = doc.getState().state;
    const ctx: ToolCtx = {
      doc: doc.getState(),
      view: state.views.find((v) => v.id === "vw_bb")!,
      viewport,
      scene: buildDrawList({ state, viewId: "vw_bb", viewport, art: stubArt, resolve: (ref) => resolvePart(state, ref), index: null, prev: null, mode: "illustrated", overlays: [] }).scene,
      selection: [],
      snapMm: 2.54,
      hit: () => null,
      resolve: (ref) => resolvePart(state, ref),
    };
    const placed = placeAtCentre(ctx, { registry, session }, "core.led-5mm");
    if ("refused" in placed) throw new Error(placed.refused);
    expect(placed.refdes).toBe("D1");
    expect(placed.batch.find((op) => op.k === "view.place")).toMatchObject({ placement: { legs: { A: "b11", K: "b12" } } });
  });
});
