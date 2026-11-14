// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BUILTIN_DESCRIPTORS } from "../../parts/builtin.ts";
import type { Descriptor } from "../../parts/descriptor.ts";
import { resolvePart } from "../parts-view.ts";
import { blinkCircuit } from "../testing/blink-circuit.ts";
import type { ArtElement } from "../engine/types.ts";
import { boardArt } from "./boards.ts";

const part = (id: string) => (BUILTIN_DESCRIPTORS as Descriptor[]).find((d) => d.id === id)!;
const at = (d: Descriptor, pin: string) => d.pins.find((p) => p.id === pin)!.position!;
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 2);

describe("Uno R3 pin positions", () => {
  const uno = part("core.uno-r3");

  it("sit on the header coordinates of the official board file", () => {
    expect(uno.pins.every((p) => p.position)).toBe(true);
    expect(at(uno, "D0")).toEqual({ x: 63.5, y: 50.8 });
    expect(at(uno, "D7")).toEqual({ x: 45.72, y: 50.8 });
    expect(at(uno, "D8")).toEqual({ x: 41.66, y: 50.8 });
    expect(at(uno, "SCL")).toEqual({ x: 18.8, y: 50.8 });
    expect(at(uno, "NC")).toEqual({ x: 27.94, y: 2.54 });
    expect(at(uno, "VIN")).toEqual({ x: 45.72, y: 2.54 });
    expect(at(uno, "A0")).toEqual({ x: 50.8, y: 2.54 });
    expect(at(uno, "ICSP_1")).toEqual({ x: 63.63, y: 30.48 });
  });

  it("keep the 0.1 inch pitch along each header, with the 160 mil gap between D7 and D8", () => {
    const run = (names: string[]) => names.slice(1).map((n, i) => at(uno, names[i]!).x - at(uno, n).x);
    for (const gap of run(["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"])) near(gap, 2.54);
    for (const gap of run(["D8", "D9", "D10", "D11", "D12", "D13", "GND", "AREF", "SDA", "SCL"])) near(gap, 2.54);
    near(at(uno, "D7").x - at(uno, "D8").x, 4.06);
    for (const gap of run(["A5", "A4", "A3", "A2", "A1", "A0"]).map(Math.abs)) near(gap, 2.54);
    near(at(uno, "A0").x - at(uno, "VIN").x, 5.08);
  });

  it("stay inside the 68.58 by 53.34 mm board", () => {
    for (const p of uno.pins) {
      expect(p.position!.x).toBeGreaterThan(0);
      expect(p.position!.x).toBeLessThan(68.58);
      expect(p.position!.y).toBeGreaterThan(0);
      expect(p.position!.y).toBeLessThan(53.34);
    }
  });

  it("are the pin dots the canvas draws, in the y down frame", () => {
    const shape = resolvePart(blinkCircuit().project, "core.uno-r3");
    expect(shape).toMatchObject({ widthMm: 68.58, heightMm: 53.34 });
    expect(shape.pins.find((p) => p.id === "D13")).toMatchObject({ xMm: 28.96, yMm: 2.54 });
    expect(shape.pins.find((p) => p.id === "P5V")).toMatchObject({ xMm: 38.1, yMm: 50.8 });
  });
});

describe("Nano pin positions", () => {
  const nano = part("core.nano");
  const j1 = nano.connectors!.find((c) => c.id === "J1")!.pins;
  const j2 = nano.connectors!.find((c) => c.id === "J2")!.pins;

  it("run in two rows of fifteen, 2.54 mm apart, 15.24 mm between the rows", () => {
    expect(nano.dimensions?.body).toMatchObject({ w: 43.18, h: 17.78 });
    near(at(nano, "D1").x, 39.37);
    near(at(nano, "D1").y, 16.51);
    near(at(nano, "VIN").y, 1.27);
    for (const row of [j1, j2]) for (let i = 1; i < row.length; i++) near(at(nano, row[i - 1]!).x - at(nano, row[i]!).x, 2.54);
    near(at(nano, "D1").y - at(nano, "VIN").y, 15.24);
    near(at(nano, "D12").x, 3.81);
    near(at(nano, "D13").x, 3.81);
  });
});

describe("boardArt", () => {
  const within = (e: ArtElement, w: number, h: number) => {
    if (e.t === "rect") return e.x + e.w <= w + 7 && e.y + e.h <= h + 0.01 && e.y >= -0.01;
    if (e.t === "circle") return e.cx >= 0 && e.cx <= w && e.cy >= 0 && e.cy <= h;
    return true;
  };

  it("is only for the two boards and grows with the zoom level", () => {
    expect(boardArt("core.resistor", 2)).toBeNull();
    for (const ref of ["core.uno-r3", "core.nano"]) {
      const sizes = ([0, 1, 2] as const).map((lod) => boardArt(ref, lod)!.length);
      expect(sizes[0]).toBe(1);
      expect(sizes[1]).toBeGreaterThan(sizes[0]!);
      expect(sizes[2]).toBeGreaterThan(sizes[1]!);
      expect(sizes[2]).toBeLessThan(150);
    }
  });

  it("puts a socket under every Uno header pin", () => {
    const sockets = boardArt("core.uno-r3", 1)!.filter((e): e is Extract<ArtElement, { t: "rect" }> => e.t === "rect" && e.fill === "var(--color-ink-fixed)");
    const uno = part("core.uno-r3");
    for (const pin of [...["D0", "D7", "D8", "SCL"], ...["NC", "VIN", "A0", "A5"]]) {
      const { x, y } = at(uno, pin);
      const yArt = 53.34 - y;
      expect(sockets.some((s) => x >= s.x && x <= s.x + s.w && yArt >= s.y && yArt <= s.y + s.h), pin).toBe(true);
    }
  });

  it("draws the Nano headers over both pin rows and keeps the art on the board", () => {
    const nano = part("core.nano");
    const sockets = boardArt("core.nano", 1)!.filter((e): e is Extract<ArtElement, { t: "rect" }> => e.t === "rect" && e.fill === "var(--color-ink-fixed)");
    for (const pin of ["D1", "D12", "VIN", "D13"]) {
      const { x, y } = at(nano, pin);
      expect(sockets.some((s) => x >= s.x && x <= s.x + s.w && 17.78 - y >= s.y && 17.78 - y <= s.y + s.h), pin).toBe(true);
    }
    expect(boardArt("core.nano", 2)!.every((e) => within(e, 43.18, 17.78))).toBe(true);
  });
});
