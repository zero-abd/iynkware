import { describe, expect, it } from "vitest";
import { BUILTIN_DESCRIPTORS } from "../../parts/builtin.ts";
import type { Descriptor } from "../../parts/descriptor.ts";
import { fallbackSpec } from "../../parts/fallback.ts";
import type { ArtElement } from "../engine/types.ts";
import { partArt } from "./parts.ts";

const HAND_DRAWN = ["core.bme280-module", "core.caster-ball", "core.chassis-2wd", "core.signal-source", "core.slide-switch", "core.wheel-65", "core.fsr402", "core.rgb-led"];
const byId = new Map((BUILTIN_DESCRIPTORS as Descriptor[]).map((d) => [d.id, d]));

type Box = { x0: number; y0: number; x1: number; y1: number };

function boxOf(e: ArtElement): Box | null {
  switch (e.t) {
    case "rect":
      return { x0: e.x, y0: e.y, x1: e.x + e.w, y1: e.y + e.h };
    case "circle":
      return { x0: e.cx - e.r, y0: e.cy - e.r, x1: e.cx + e.r, y1: e.cy + e.r };
    case "ellipse":
      return { x0: e.cx - e.rx, y0: e.cy - e.ry, x1: e.cx + e.rx, y1: e.cy + e.ry };
    case "path": {
      const n = e.d.match(/-?\d*\.?\d+/g)!.map(Number);
      const xs = n.filter((_, i) => i % 2 === 0);
      const ys = n.filter((_, i) => i % 2 === 1);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    default:
      return null;
  }
}

describe("hand-drawn part art", () => {
  for (const id of HAND_DRAWN) {
    const spec = fallbackSpec(byId.get(id)!);
    const art = partArt(id, 2)!;
    const boxes = art.map(boxOf).filter((b): b is Box => b !== null);

    it(`${id} is drawn at the closest zoom only`, () => {
      expect(art.length).toBeGreaterThan(0);
      expect(partArt(id, 1)).toBeNull();
      expect(partArt(id, 0)).toBeNull();
    });

    it(`${id} stays on its body, give or take a lead's width`, () => {
      const slack = 2;
      for (const b of boxes) {
        expect(b.x0).toBeGreaterThanOrEqual(-slack);
        expect(b.y0).toBeGreaterThanOrEqual(-slack);
        expect(b.x1).toBeLessThanOrEqual(spec.body_mm.w + slack);
        expect(b.y1).toBeLessThanOrEqual(spec.body_mm.h + slack);
      }
    });

    it(`${id} reaches every electrical pin the canvas draws`, () => {
      const electrical = spec.pins.filter((p) => !["MOUNT", "DECK", "SHAFT"].includes(p.id));
      for (const pin of electrical) {
        const x = pin.x_mm;
        const y = spec.body_mm.h - pin.y_mm;
        const hit = boxes.some((b) => b.x0 - 0.3 <= x && x <= b.x1 + 0.3 && b.y0 - 0.3 <= y && y <= b.y1 + 0.3);
        expect(hit, `${id} pin ${pin.id} at ${x}, ${y}`).toBe(true);
      }
    });
  }

  it("has nothing for a part drawn some other way", () => {
    expect(partArt("core.led-5mm", 2)).toBeNull();
    expect(partArt("core.uno-r3", 2)).toBeNull();
  });
});
