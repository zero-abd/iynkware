// @vitest-environment node
import { describe, expect, it } from "vitest";
import { rangerEcho } from "./hc-sr04.ts";

describe("hc-sr04 model", () => {
  it("answers a trigger of 10 us or more after the 200 us burst, with the round trip at 343 m/s", () => {
    const echo = rangerEcho(10, 10);
    expect(echo?.delayUs).toBe(200);
    expect(echo?.widthUs).toBeCloseTo(20 / 0.0343, 9);
  });

  it("ignores a trigger shorter than 10 us", () => {
    expect(rangerEcho(9.99, 10)).toBeNull();
  });

  it("holds ECHO for the 38 ms timeout when nothing is within 2 to 400 cm", () => {
    for (const cm of [1.9, 400.1, 1000]) expect(rangerEcho(10, cm)?.widthUs).toBe(38_000);
    expect(rangerEcho(10, 2)?.widthUs).toBeCloseTo(4 / 0.0343, 9);
    expect(rangerEcho(10, 400)?.widthUs).toBeCloseTo(800 / 0.0343, 9);
  });
});
