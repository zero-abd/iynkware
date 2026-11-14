// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lessonSession } from "../../project/session.testing.ts";
import { createSessionStore } from "../stores/session.ts";
import { createRecordingDoc } from "../testing/recording-doc.ts";
import { createToolHost } from "../tools/host.ts";
import type { PartOperator } from "../tools/operate.ts";
import type { Tool } from "../tools/types.ts";
import { GESTURE_SETTLE_MS, TOUCH_WORK_K } from "./constants.ts";
import { createEditorEngine } from "./engine.ts";
import { miniProject, resolveShape, stubArt, VIEW_ID } from "./testing/mini-scene.ts";
import { createNullRenderer } from "./types.ts";
import { pxToMm } from "./viewport.ts";

const W = 800;
const H = 400;

function setup(operator?: PartOperator, onRunChange?: (fn: () => void) => () => void) {
  const doc = createRecordingDoc(lessonSession({}, miniProject(20, 0)));
  const session = createSessionStore(VIEW_ID);
  const renderer = createNullRenderer();
  const host = createToolHost({ doc, session });
  const engine = createEditorEngine({
    doc,
    session,
    renderer,
    art: stubArt,
    resolve: resolveShape,
    host,
    ...(operator && { operator }),
    ...(onRunChange && { onRunChange }),
    snapMm: () => 2.54,
    artMode: () => "illustrated",
    mountOptions: { locale: "en", theme: "light", reduceMotion: false },
  });
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0, toJSON: () => ({}) });
  document.body.append(el);
  engine.mount(el);
  return { doc, session, renderer, host, engine, el };
}

function pointer(type: string, x: number, y: number, init: PointerEventInit = {}) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...init });
  Object.assign(e, { pointerId: init.pointerId ?? 1, pointerType: init.pointerType ?? "mouse" });
  return e as unknown as PointerEvent;
}

function wheel(x: number, y: number, init: WheelEventInit) {
  return new WheelEvent("wheel", { clientX: x, clientY: y, bubbles: true, cancelable: true, ...init });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("EditorEngine", () => {
  it("mounts the renderer, fits the content and publishes the viewport", () => {
    const { engine, renderer, session } = setup();
    expect(renderer.calls[0]).toMatchObject({ method: "mount" });
    const v = engine.viewport();
    expect(v).toMatchObject({ w: W, h: H });
    const px = (mm: number, c: number, size: number) => (mm - c) * v.k + size / 2;
    expect(px(-0.5, v.cx_mm, W)).toBeGreaterThan(0);
    expect(px(190.5, v.cx_mm, W)).toBeLessThan(W);
    expect(session.getState().viewports[VIEW_ID]).toEqual(v);
    expect(engine.scene().items.length).toBeGreaterThan(0);
  });

  it("zooms with the wheel around the cursor", () => {
    const { engine, el } = setup();
    const at = { x: 300, y: 120 };
    const under = pxToMm(engine.viewport(), at);
    const before = engine.viewport().k;
    el.dispatchEvent(wheel(at.x, at.y, { deltaY: -100 }));
    expect(engine.viewport().k).toBeGreaterThan(before);
    const now = pxToMm(engine.viewport(), at);
    expect(now.x).toBeCloseTo(under.x, 6);
    expect(now.y).toBeCloseTo(under.y, 6);
    el.dispatchEvent(wheel(at.x, at.y, { deltaY: 100 }));
    expect(engine.viewport().k).toBeCloseTo(before, 6);
  });

  it("pans with a trackpad scroll and with the middle button", () => {
    const { engine, el } = setup();
    const start = engine.viewport();
    el.dispatchEvent(wheel(10, 10, { deltaX: 3.5, deltaY: 12.25 }));
    expect(engine.viewport().cx_mm).toBeCloseTo(start.cx_mm + 3.5 / start.k, 9);
    expect(engine.viewport().cy_mm).toBeCloseTo(start.cy_mm + 12.25 / start.k, 9);
    const mid = engine.viewport();
    el.dispatchEvent(pointer("pointerdown", 100, 100, { button: 1 }));
    el.dispatchEvent(pointer("pointermove", 140, 90, { button: 1, buttons: 4 }));
    el.dispatchEvent(pointer("pointerup", 140, 90, { button: 1 }));
    expect(engine.viewport().cx_mm).toBeCloseTo(mid.cx_mm - 40 / mid.k, 9);
    expect(engine.viewport().cy_mm).toBeCloseTo(mid.cy_mm + 10 / mid.k, 9);
  });

  it("shows the pointer the active tool asks for", () => {
    const { el, host } = setup();
    host.register({ id: "select", cursor: () => "crosshair", pointer: () => ({ kind: "none" }), key: () => ({ kind: "none" }), preview: () => [] });
    el.dispatchEvent(pointer("pointermove", 100, 100));
    expect(el.style.cursor).toBe("crosshair");
  });

  it("works the cursor out again when the scene changes under a parked pointer", () => {
    const { engine, el, host } = setup();
    let cursor = "default";
    host.register({ id: "select", cursor: () => cursor, pointer: () => ({ kind: "none" }), key: () => ({ kind: "none" }), preview: () => [] });
    el.dispatchEvent(pointer("pointermove", 100, 100));
    expect(el.style.cursor).toBe("default");
    cursor = "crosshair";
    engine.rebuild();
    expect(el.style.cursor).toBe("crosshair");
  });

  describe("with a finger", () => {
    const finger = { pointerType: "touch", pointerId: 1 };
    const recorded = (host: ReturnType<typeof setup>["host"]) => {
      const events: string[] = [];
      host.register({
        id: "select",
        cursor: () => "default",
        pointer: (e) => {
          events.push(e.type);
          return { kind: "none" };
        },
        key: () => ({ kind: "none" }),
        preview: () => [],
      });
      return events;
    };

    it("pans the canvas when a finger drags over empty ground, and drops the gesture the tool had begun", () => {
      const { engine, el, host } = setup();
      const events = recorded(host);
      const v = engine.viewport();
      const empty = { x: W / 2, y: (60 - v.cy_mm) * v.k + H / 2 };
      el.dispatchEvent(pointer("pointerdown", empty.x, empty.y, finger));
      el.dispatchEvent(pointer("pointermove", empty.x + 40, empty.y + 10, finger));
      el.dispatchEvent(pointer("pointerup", empty.x + 40, empty.y + 10, finger));
      expect(engine.viewport().cx_mm).toBeCloseTo(v.cx_mm - 40 / v.k, 9);
      expect(engine.viewport().cy_mm).toBeCloseTo(v.cy_mm - 10 / v.k, 9);
      expect(events).toEqual(["down", "cancel"]);
    });

    it("passes a tap on to the tool as it would a click", () => {
      const { engine, el, host } = setup();
      const events = recorded(host);
      const v = engine.viewport();
      const empty = { x: W / 2, y: (60 - v.cy_mm) * v.k + H / 2 };
      el.dispatchEvent(pointer("pointerdown", empty.x, empty.y, finger));
      el.dispatchEvent(pointer("pointerup", empty.x + 2, empty.y, finger));
      expect(events).toEqual(["down", "up"]);
      expect(engine.viewport()).toEqual(v);
    });

    it("leaves a drag that starts on a pin to the tools", () => {
      const { engine, el, host } = setup();
      const events = recorded(host);
      const v = engine.viewport();
      const pin = { x: (0 - v.cx_mm) * v.k + W / 2, y: (1.5 - v.cy_mm) * v.k + H / 2 };
      el.dispatchEvent(pointer("pointerdown", pin.x, pin.y, finger));
      el.dispatchEvent(pointer("pointermove", pin.x + 60, pin.y, finger));
      el.dispatchEvent(pointer("pointerup", pin.x + 60, pin.y, finger));
      expect(events).toEqual(["down", "move", "up"]);
      expect(engine.viewport()).toEqual(v);
    });

    it("looks for the hole and not the part under the finger while a wire is being made", () => {
      const { engine, host, session } = setup();
      host.register({ id: "wire", cursor: () => "crosshair", pointer: () => ({ kind: "none" }), key: () => ({ kind: "none" }), preview: () => [] });
      const spy = vi.spyOn(engine, "hit");
      engine.hitFor(10, 10, "touch");
      expect(spy).toHaveBeenLastCalledWith(10, 10, expect.any(Number), true);
      host.setTool("wire");
      expect(session.getState().tool).toBe("wire");
      engine.hitFor(10, 10, "touch");
      expect(spy).toHaveBeenLastCalledWith(10, 10, expect.any(Number), false);
    });

    it("zooms to working scale on the first tap with a part in hand, and places on the next", () => {
      const { engine, el, host, session } = setup();
      const events: string[] = [];
      host.register({
        id: "place",
        cursor: () => "copy",
        pointer: (e) => {
          events.push(e.type);
          return { kind: "none" };
        },
        key: () => ({ kind: "none" }),
        preview: () => [],
      });
      session.armPart("core.resistor");
      host.setTool("place");
      const v = engine.viewport();
      expect(v.k).toBeLessThan(TOUCH_WORK_K);
      const at = { x: 300, y: 120 };
      const under = pxToMm(v, at);
      el.dispatchEvent(pointer("pointerdown", at.x, at.y, finger));
      el.dispatchEvent(pointer("pointerup", at.x, at.y, finger));
      expect(events).toEqual([]);
      expect(engine.viewport()).toMatchObject({ k: TOUCH_WORK_K, cx_mm: under.x, cy_mm: under.y });
      expect(session.getState().status).toEqual({ key: "edit.place.zoomed" });
      el.dispatchEvent(pointer("pointerdown", W / 2, H / 2, finger));
      el.dispatchEvent(pointer("pointerup", W / 2, H / 2, finger));
      expect(events).toEqual(["down", "up"]);
    });
  });

  it("pans on Space plus a primary drag without calling the tool", () => {
    const { engine, el, host } = setup();
    const spy = vi.spyOn(host, "pointer");
    const start = engine.viewport();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    el.dispatchEvent(pointer("pointerdown", 50, 50));
    el.dispatchEvent(pointer("pointermove", 80, 50, { buttons: 1 }));
    el.dispatchEvent(pointer("pointerup", 80, 50));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    expect(engine.viewport().cx_mm).toBeCloseTo(start.cx_mm - 30 / start.k, 9);
    expect(spy).not.toHaveBeenCalled();
  });

  it("fits all, fits the selection and falls back when the selection is empty", () => {
    const { engine, session } = setup();
    session.setSelection([{ kind: "part", view: VIEW_ID, id: "cmp_0" }]);
    engine.fitSelection();
    const one = engine.viewport();
    expect(one.cx_mm).toBeCloseTo(5, 6);
    session.setSelection([]);
    engine.fitSelection();
    const all = engine.viewport();
    expect(all.k).toBeLessThan(one.k);
    engine.zoomBy(3);
    engine.fit();
    expect(engine.viewport()).toEqual(all);
  });

  it("selects the part under a click and clears on an empty click", () => {
    const { engine, session, el } = setup();
    const v = engine.viewport();
    const px = (x: number, y: number) => ({ x: (x - v.cx_mm) * v.k + W / 2, y: (y - v.cy_mm) * v.k + H / 2 });
    const body = px(5, 1.5);
    el.dispatchEvent(pointer("pointerdown", body.x, body.y));
    el.dispatchEvent(pointer("pointerup", body.x, body.y));
    expect(session.getState().selection).toEqual([{ kind: "part", view: VIEW_ID, id: "cmp_0" }]);
    const other = px(25, 1.5);
    el.dispatchEvent(pointer("pointerdown", other.x, other.y, { shiftKey: true }));
    el.dispatchEvent(pointer("pointerup", other.x, other.y, { shiftKey: true }));
    expect(session.getState().selection.map((s) => s.id)).toEqual(["cmp_0", "cmp_1"]);
    const empty = px(5, 60);
    el.dispatchEvent(pointer("pointerdown", empty.x, empty.y));
    el.dispatchEvent(pointer("pointerup", empty.x, empty.y));
    expect(session.getState().selection).toEqual([]);
  });

  it("leaves the selection and the document alone when an empty canvas is dragged", () => {
    const { engine, session, doc, el } = setup();
    const v = engine.viewport();
    const empty = { x: W / 2, y: (60 - v.cy_mm) * v.k + H / 2 };
    session.setSelection([{ kind: "part", view: VIEW_ID, id: "cmp_0" }]);
    el.dispatchEvent(pointer("pointerdown", empty.x, empty.y));
    el.dispatchEvent(pointer("pointermove", empty.x + 60, empty.y + 5, { buttons: 1 }));
    el.dispatchEvent(pointer("pointerup", empty.x + 60, empty.y + 5));
    expect(session.getState().selection).toHaveLength(1);
    expect(doc.commits).toHaveLength(0);
  });

  it("hits pins at 12 px and parts, and finds pins at the smallest part size", () => {
    const { engine } = setup();
    const v = engine.viewport();
    const pin = { x: (0 - v.cx_mm) * v.k + W / 2, y: (1.5 - v.cy_mm) * v.k + H / 2 };
    expect(engine.hit(pin.x - 12, pin.y, 12)).toEqual({ kind: "pin", c: "cmp_0", p: "1" });
    engine.zoomBy(2 / v.k);
    vi.advanceTimersByTime(GESTURE_SETTLE_MS);
    const small = engine.viewport();
    const at = { x: (0 - small.cx_mm) * small.k + W / 2, y: (1.5 - small.cy_mm) * small.k + H / 2 };
    expect(engine.scene().items.find((i) => i.id === "cmp_0")?.lod).toBe(0);
    expect(engine.hit(at.x, at.y, 12)).toEqual({ kind: "pin", c: "cmp_0", p: "1" });
  });

  it("sends a tool commit through the host and redraws after the change", () => {
    const { engine, el, host, doc, renderer } = setup();
    const tool: Tool = {
      id: "select",
      cursor: () => "default",
      pointer: (e) => (e.type === "up" ? { kind: "commit", batch: [{ k: "view.place", view: VIEW_ID, placement: { c: "cmp_0", x_mm: 0, y_mm: 30 } }], label: "Move" } : { kind: "none" }),
      key: () => ({ kind: "none" }),
      preview: () => [],
    };
    host.register(tool);
    const v = engine.viewport();
    const p = { x: (5 - v.cx_mm) * v.k + W / 2, y: (1.5 - v.cy_mm) * v.k + H / 2 };
    const draws = renderer.calls.filter((c) => c.method === "draw").length;
    el.dispatchEvent(pointer("pointerdown", p.x, p.y));
    el.dispatchEvent(pointer("pointerup", p.x, p.y));
    expect(doc.commits).toHaveLength(1);
    expect(renderer.calls.filter((c) => c.method === "draw").length).toBeGreaterThan(draws);
    expect(engine.scene().items.find((i) => i.id === "cmp_0")?.yMm).toBe(30);
  });

  it("cancels a one-pointer gesture when a second finger lands, then pinch-zooms", () => {
    const { engine, el, host } = setup();
    const events: string[] = [];
    host.register({
      id: "select",
      cursor: () => "default",
      pointer: (e) => {
        events.push(e.type);
        return { kind: "none" };
      },
      key: () => ({ kind: "none" }),
      preview: () => [],
    });
    const touch = (id: number) => ({ pointerType: "touch", pointerId: id });
    el.dispatchEvent(pointer("pointerdown", 300, 200, touch(1)));
    el.dispatchEvent(pointer("pointerdown", 500, 200, touch(2)));
    expect(events).toEqual(["down", "cancel"]);
    const k = engine.viewport().k;
    el.dispatchEvent(pointer("pointermove", 200, 200, touch(1)));
    el.dispatchEvent(pointer("pointermove", 600, 200, touch(2)));
    expect(engine.viewport().k).toBeGreaterThan(k);
    el.dispatchEvent(pointer("pointerup", 200, 200, touch(1)));
    el.dispatchEvent(pointer("pointerup", 600, 200, touch(2)));
    expect(events).toEqual(["down", "cancel"]);
  });

  it("rebuilds the scene a moment after a gesture settles", () => {
    const { engine, renderer } = setup();
    const draws = () => renderer.calls.filter((c) => c.method === "draw").length;
    const before = draws();
    engine.panBy(30, 0);
    engine.panBy(30, 0);
    expect(draws()).toBe(before);
    vi.advanceTimersByTime(GESTURE_SETTLE_MS);
    expect(draws()).toBe(before + 1);
  });

  it("removes its listeners and the renderer on dispose", () => {
    const { engine, el, renderer } = setup();
    engine.dispose();
    expect(renderer.calls.at(-1)).toMatchObject({ method: "dispose" });
    const k = engine.viewport().k;
    el.dispatchEvent(wheel(10, 10, { deltaY: -100 }));
    expect(engine.viewport().k).toBe(k);
  });

  it("copes with a canvas of zero size", () => {
    const doc = createRecordingDoc(lessonSession({}, miniProject()));
    const session = createSessionStore(VIEW_ID);
    const engine = createEditorEngine({
      doc, session, renderer: createNullRenderer(), art: stubArt, resolve: resolveShape, host: createToolHost({ doc, session }),
      snapMm: () => 1, artMode: () => "simple", mountOptions: { locale: "en", theme: "light", reduceMotion: false },
    });
    engine.mount(document.createElement("div"));
    engine.fit();
    expect(Number.isFinite(engine.viewport().k)).toBe(true);
  });

  describe("with a part operator", () => {
    const stub = (takes: boolean) => ({
      hover: vi.fn(() => (takes ? "pointer" : null)),
      down: vi.fn(() => takes),
      move: vi.fn(),
      up: vi.fn(),
      overlays: () => [],
      subscribe: () => () => {},
    });

    it("gives a press it takes to the operator alone, follows the drag and lets go on release", () => {
      const op = stub(true);
      const { el, host } = setup(op);
      const spy = vi.spyOn(host, "pointer");
      el.dispatchEvent(pointer("pointerdown", 100, 100));
      el.dispatchEvent(pointer("pointermove", 120, 90, { buttons: 1 }));
      el.dispatchEvent(pointer("pointerup", 120, 90));
      expect(op.down).toHaveBeenCalledTimes(1);
      expect(op.move).toHaveBeenCalledTimes(1);
      expect(op.up).toHaveBeenCalledTimes(1);
      expect(spy).not.toHaveBeenCalled();
    });

    it("leaves a press it does not take to the tools", () => {
      const op = stub(false);
      const { el, host } = setup(op);
      const spy = vi.spyOn(host, "pointer");
      el.dispatchEvent(pointer("pointerdown", 100, 100));
      el.dispatchEvent(pointer("pointerup", 100, 100));
      expect(spy).toHaveBeenCalledTimes(2);
      expect(op.up).not.toHaveBeenCalled();
    });

    it("shows the pointer the operator asks for over a part it can work", () => {
      const { el, host } = setup(stub(true));
      host.register({ id: "select", cursor: () => "default", pointer: () => ({ kind: "none" }), key: () => ({ kind: "none" }), preview: () => [] });
      el.dispatchEvent(pointer("pointermove", 100, 100));
      expect(el.style.cursor).toBe("pointer");
    });

    it("works the cursor out again for a parked mouse when the run starts or stops", () => {
      let takes = false;
      let tell = () => {};
      const op = { ...stub(false), hover: vi.fn(() => (takes ? "pointer" : null)) };
      const { el, host } = setup(op, (fn) => {
        tell = fn;
        return () => {};
      });
      host.register({ id: "select", cursor: () => "default", pointer: () => ({ kind: "none" }), key: () => ({ kind: "none" }), preview: () => [] });
      el.dispatchEvent(pointer("pointermove", 100, 100));
      expect(el.style.cursor).toBe("default");
      takes = true;
      tell();
      expect(el.style.cursor).toBe("pointer");
      takes = false;
      tell();
      expect(el.style.cursor).toBe("default");
    });

    it("leaves the cursor alone for a pointer that has left the canvas", () => {
      let tell = () => {};
      const { el, host } = setup(stub(true), (fn) => {
        tell = fn;
        return () => {};
      });
      host.register({ id: "select", cursor: () => "default", pointer: () => ({ kind: "none" }), key: () => ({ kind: "none" }), preview: () => [] });
      el.dispatchEvent(pointer("pointermove", 100, 100));
      el.dispatchEvent(pointer("pointerleave", 100, 100));
      el.style.cursor = "";
      tell();
      expect(el.style.cursor).toBe("default");
    });

    it("does not take a middle-button press, which pans", () => {
      const op = stub(true);
      const { el } = setup(op);
      el.dispatchEvent(pointer("pointerdown", 100, 100, { button: 1 }));
      expect(op.down).not.toHaveBeenCalled();
    });
  });
});
