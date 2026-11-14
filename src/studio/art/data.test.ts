// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ART_DATA } from "./data/art-data.ts";

const PAGES: Record<string, string> = {
  led: "parts/led.html",
  resistor: "parts/resistor.html",
  "push-button": "parts/push-button.html",
  "piezo-buzzer": "parts/piezo-buzzer.html",
  potentiometer: "parts/potentiometer.html",
  "capacitor-ceramic": "parts/capacitor-ceramic.html",
  "capacitor-electrolytic": "parts/capacitor-electrolytic.html",
  inductor: "parts/inductor.html",
  lm358: "parts/lm358.html",
  ne555: "parts/ne555.html",
  "zener-1n4733a": "parts/zener-1n4733a.html",
  "aa-holder-4": "parts/aa-holder-4.html",
  "dc-motor": "parts/dc-motor.html",
  "diode-1n4007": "parts/diode-1n4007.html",
  fan: "parts/fan.html",
  "hc-sr04": "modules/hc-sr04.html",
  ldr: "parts/ldr.html",
  "lipo-2s": "parts/lipo-2s.html",
  mpu6050: "parts/mpu6050.html",
  multimeter: "parts/multimeter.html",
  nema17: "parts/nema17.html",
  "npn-2n2222": "parts/npn-2n2222.html",
  "servo-sg90": "parts/servo-sg90.html",
  "soil-moisture": "modules/soil-moisture.html",
  ssd1306: "parts/ssd1306.html",
  "stepper-28byj48": "parts/stepper-28byj48.html",
  tip120: "parts/tip120.html",
  tmp36: "parts/tmp36.html",
  "traffic-light": "parts/traffic-light.html",
  "tt-motor": "parts/tt-motor.html",
  uln2003: "modules/uln2003.html",
  a4988: "modules/a4988.html",
  l298n: "modules/l298n.html",
  lm2596: "modules/lm2596.html",
  pca9685: "modules/pca9685.html",
  "qtr-8rc": "modules/qtr-8rc.html",
  tb6612fng: "modules/tb6612fng.html",
};
const KEYS = Object.keys(PAGES);
const MAX_ELEMENTS = 150;
const PATH = /^[MLZ0-9.,\s-]+$/;
const COLOUR = /^(#[0-9a-f]{3,8}|var\(--(?:color|studio)-[a-z0-9-]+\))$/;
const UNSAFE = /filter|script|foreignobject|href|url\(|\bon[a-z]+\s*=|javascript:/i;

describe("ART_DATA", () => {
  it("has the extracted parts", () => {
    expect(Object.keys(ART_DATA).sort()).toEqual([...KEYS].sort());
  });

  it("prints the element count per entry", () => {
    for (const [key, a] of Object.entries(ART_DATA)) console.log(`${key}: ${a.elements.length} elements`);
  });

  describe.each(KEYS)("%s", (key) => {
    const art = ART_DATA[key];

    it("holds at most 150 elements", () => {
      expect(art.elements.length).toBeGreaterThan(0);
      expect(art.elements.length).toBeLessThanOrEqual(MAX_ELEMENTS);
    });

    it("uses only path, circle, rect and ellipse", () => {
      for (const e of art.elements) expect(["path", "circle", "rect", "ellipse"]).toContain(e.t);
    });

    it("carries no reference, script or event attribute in any string", () => {
      expect(UNSAFE.test(JSON.stringify(art))).toBe(false);
    });

    it("has path data and colours of the expected shape", () => {
      for (const e of art.elements) {
        if (e.t === "text") throw new Error("text in extracted art");
        if (e.t === "path") expect(e.d).toMatch(PATH);
        if (e.fill) expect(e.fill).toMatch(COLOUR);
        if (e.stroke) expect(e.stroke).toMatch(COLOUR);
      }
    });

    it("has a viewBox in millimetres", () => {
      expect(art.viewBox).toMatch(/^0 0 [\d.]+ [\d.]+$/);
    });

    it("was extracted from the current figure page", () => {
      const page = readFileSync(new URL(`../../../public/figures/${PAGES[key]}`, import.meta.url));
      expect(art.sourceSha256).toBe(createHash("sha256").update(page).digest("hex"));
    });
  });
});
