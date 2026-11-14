import { describe, expect, it } from "vitest";
import { ZOOM_MAX } from "../engine/constants.ts";
import { createUiStore, flowLensAffordable } from "./ui.ts";

const KEY = "iynk:studio:ui:prj_a";
const memory = (initial?: string) => {
  const data = new Map<string, string>(initial === undefined ? [] : [[KEY, initial]]);
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
const viewport = { cx_mm: 1, cy_mm: 2, k: 4, w: 800, h: 600, dpr: 2 };

describe("createUiStore", () => {
  it("gives defaults when storage throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const store = createUiStore("prj_a", storage);
    expect(store.getState()).toMatchObject({ leftRail: "palette", snapMm: 2.54, viewports: {} });
    expect(() => store.set("gridOn", false)).not.toThrow();
    expect(store.getState().gridOn).toBe(false);
  });

  it("gives defaults for bad JSON or no storage", () => {
    expect(createUiStore("prj_a", memory("{nope")).getState().dock).toBe("code");
    expect(createUiStore("prj_a", memory("42")).getState().dock).toBe("code");
    expect(createUiStore("prj_a", undefined).getState().dock).toBe("code");
  });

  it("drops unknown keys and bad values and keeps good ones", () => {
    const store = createUiStore("prj_a", memory(JSON.stringify({ dock: "serial", leftRail: "nope", extra: 1, gridOn: "yes" })));
    const state = store.getState();
    expect(state).toMatchObject({ dock: "serial", leftRail: "palette", gridOn: true });
    expect(state).not.toHaveProperty("extra");
  });

  it("has the flow lens on, and keeps the choice and drops a value that is not a boolean", () => {
    expect(createUiStore("prj_a", memory(), {}).getState().flowLens).toBe(true);
    expect(createUiStore("prj_a", memory(JSON.stringify({ flowLens: false }))).getState().flowLens).toBe(false);
    expect(createUiStore("prj_a", memory(JSON.stringify({ flowLens: "no" })), {}).getState().flowLens).toBe(true);
  });

  it("starts the flow lens off on a low-end device and keeps the choice made there", () => {
    const weak = { deviceMemory: 2, hardwareConcurrency: 8 };
    expect(createUiStore("prj_a", memory(), weak).getState().flowLens).toBe(false);
    expect(createUiStore("prj_a", memory(JSON.stringify({ flowLens: true })), weak).getState().flowLens).toBe(true);
    const storage = memory();
    createUiStore("prj_a", storage, weak).set("flowLens", true);
    expect(createUiStore("prj_a", storage, weak).getState().flowLens).toBe(true);
    expect(createUiStore("prj_a", memory(JSON.stringify({ flowLens: "no" })), weak).getState().flowLens).toBe(false);
  });

  it("calls a device low-end at 4 cores or 4 GB, and fast when it says nothing", () => {
    expect(flowLensAffordable({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe(true);
    expect(flowLensAffordable({ deviceMemory: 4, hardwareConcurrency: 8 })).toBe(false);
    expect(flowLensAffordable({ deviceMemory: 8, hardwareConcurrency: 4 })).toBe(false);
    expect(flowLensAffordable({ hardwareConcurrency: 6 })).toBe(true);
    expect(flowLensAffordable({})).toBe(true);
  });

  it("clamps the snap size on read and on write", () => {
    expect(createUiStore("prj_a", memory(JSON.stringify({ snapMm: 99 }))).getState().snapMm).toBe(25.4);
    const store = createUiStore("prj_a", memory());
    store.set("snapMm", 0.01);
    expect(store.getState().snapMm).toBe(0.1);
  });

  it("drops viewports with a non-finite field and clamps zoom", () => {
    const raw = {
      viewports: {
        ok: viewport,
        nan: { ...viewport, cx_mm: null },
        text: { ...viewport, k: "4" },
        far: { ...viewport, k: 9999 },
      },
    };
    const { viewports } = createUiStore("prj_a", memory(JSON.stringify(raw))).getState();
    expect(Object.keys(viewports)).toEqual(["ok", "far"]);
    expect(viewports.far!.k).toBe(ZOOM_MAX);
  });

  it("keeps at most 16 viewports", () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`vw_${i}`, viewport]));
    expect(Object.keys(createUiStore("prj_a", memory(JSON.stringify({ viewports: many }))).getState().viewports)).toHaveLength(16);
  });

  it("writes to the project key and reads it back", () => {
    const storage = memory();
    createUiStore("prj_a", storage).set("dock", "serial");
    expect(storage.data.has(KEY)).toBe(true);
    expect(createUiStore("prj_a", storage).getState().dock).toBe("serial");
  });
});
