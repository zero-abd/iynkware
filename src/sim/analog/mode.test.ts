// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PartLayers } from "./live.ts";
import { pickAnalogOptions } from "./mode.ts";

const layers = (...elements: string[]): ReadonlyMap<string, PartLayers> =>
  new Map([["p", { elements: elements.map((element) => ({ kind: "element" as const, layerId: element, element, terminals: {}, params: {} })), drives: [] }]]);
const DC = { mode: "dc-event", stepNs: 1000 } as const;

describe("pickAnalogOptions", () => {
  it("goes transient for a capacitor, an inductor or a waveform source when the backend can step", () => {
    for (const kind of ["capacitor", "inductor", "waveform_source"]) expect(pickAnalogOptions(DC, layers(kind), { transient: true }).mode).toBe("transient");
  });

  it("keeps a resistive circuit on operating points", () => {
    expect(pickAnalogOptions(DC, layers("res", "led"), { transient: true })).toEqual(DC);
  });

  it("never asks a backend that cannot step to", () => {
    expect(pickAnalogOptions(DC, layers("capacitor"), { transient: false })).toEqual(DC);
    expect(pickAnalogOptions({ mode: "transient", stepNs: 500 }, layers("res"), { transient: false })).toEqual({ mode: "dc-event", stepNs: 500 });
  });
});
