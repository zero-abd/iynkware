import { describe, expect, it } from "vitest";
import { BUILTIN_DESCRIPTORS } from "../../parts/builtin.ts";
import { fallbackSpec } from "../../parts/fallback.ts";
import type { FallbackSpec } from "../../parts/fallback.ts";
import type { Descriptor } from "../../parts/descriptor.ts";
import { ART_DATA } from "./data/art-data.ts";
import { boardArt } from "./boards.ts";
import { fallbackArt, unknownPartArt } from "./fallback.ts";
import { createArtProvider, loadFigureArt } from "./figure-art.ts";

const byId = new Map((BUILTIN_DESCRIPTORS as Descriptor[]).map((d) => [d.id, d]));
const specOf = (defRef: string): FallbackSpec | null => {
  const d = byId.get(defRef);
  return d ? fallbackSpec(d) : null;
};
const provider = createArtProvider({ spec: specOf });

describe("loadFigureArt", () => {
  it("reads the extracted art by key", () => {
    expect(loadFigureArt("led")).toBe(ART_DATA.led.elements);
  });

  it("returns null for a key with no art", () => {
    expect(loadFigureArt("slide-switch")).toBeNull();
  });
});

describe("createArtProvider", () => {
  it("returns the extracted art at level 2 in illustrated mode", () => {
    expect(provider.get("core.led-5mm", 2, "illustrated")).toBe(ART_DATA.led.elements);
  });

  it("draws the Uno and the Nano by hand in illustrated mode and by fallback in simple mode", () => {
    for (const ref of ["core.uno-r3", "core.nano"]) {
      expect(provider.get(ref, 2, "illustrated")).toEqual(boardArt(ref, 2));
      expect(provider.get(ref, 2, "simple")).toEqual(fallbackArt(specOf(ref)!, 2));
    }
  });

  it("returns fallback art in simple mode", () => {
    const spec = specOf("core.led-5mm")!;
    expect(provider.get("core.led-5mm", 2, "simple")).toEqual(fallbackArt(spec, 2));
  });

  it("returns fallback art below level 2", () => {
    const spec = specOf("core.resistor")!;
    expect(provider.get("core.resistor", 1, "illustrated")).toEqual(fallbackArt(spec, 1));
    expect(provider.get("core.resistor", 0, "illustrated")).toEqual(fallbackArt(spec, 0));
  });

  it("draws a part with a descriptor and no art of its own by fallback in every mode", () => {
    const spec = specOf("core.pico")!;
    expect(provider.get("core.pico", 2, "illustrated")).toEqual(fallbackArt(spec, 2));
    expect(provider.get("core.pico", 2, "simple")).toEqual(fallbackArt(spec, 2));
  });

  it("draws a hand-drawn part at level 2 in illustrated mode only", () => {
    const spec = specOf("core.slide-switch")!;
    expect(provider.get("core.slide-switch", 2, "illustrated")).not.toEqual(fallbackArt(spec, 2));
    expect(provider.get("core.slide-switch", 2, "simple")).toEqual(fallbackArt(spec, 2));
    expect(provider.get("core.slide-switch", 1, "illustrated")).toEqual(fallbackArt(spec, 1));
  });

  it("draws an unknown definition as the unknown part", () => {
    const art = provider.get("core.mystery", 2, "illustrated");
    expect(art.some((e) => e.t === "text" && e.s === "Unknown part")).toBe(true);
    expect(art).toHaveLength(unknownPartArt({ renderer: "generic-box", label: "", showPinLabels: false, body_mm: { w: 10.16, h: 10.16 }, bounds_mm: { w: 10.16, h: 10.16 }, pins: [] }, "").length);
  });
});
