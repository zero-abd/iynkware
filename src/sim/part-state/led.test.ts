// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ledLamps } from "./led.ts";
import { ctxOf } from "./testing.ts";

describe("LED from the solver's current", () => {
  it("is lit on steady current, takes a PWM pin's duty as its brightness, and is off under half a milliamp", () => {
    expect(ledLamps()(ctxOf("core.led-5mm@1.0.0", { amps: { p1: 0.009 } }))).toMatchObject({ kind: "led", lit: true, brightness: 1 });
    const pwm = ctxOf("core.led-5mm@1.0.0", { amps: { p1: 0.004 }, signals: { A: { level: 1, duty: 0.25, hz: 490 } } });
    expect(ledLamps()(pwm)).toMatchObject({ lit: true, brightness: 0.25 });
    expect(ledLamps()(ctxOf("core.led-5mm@1.0.0", { amps: { p1: 0.0001 } }))).toMatchObject({ lit: false, brightness: 0 });
  });

  it("leaves the board's pin levels to decide when there is no solver", () => {
    expect(ledLamps()(ctxOf("core.led-5mm@1.0.0"))).toBeNull();
  });

  it("names the lit lamps of a traffic light", () => {
    const state = ledLamps(["R", "Y", "G"])(ctxOf("core.traffic-light@1.0.0", { amps: { "p1:R": 0, "p1:Y": 0.012, "p1:G": 0.008 } }));
    expect(state).toMatchObject({ lit: true, lamps: ["Y", "G"] });
    expect(ledLamps(["R", "Y", "G"])(ctxOf("core.traffic-light@1.0.0", { amps: { "p1:R": 0, "p1:Y": 0, "p1:G": 0 } }))).toMatchObject({ lit: false, lamps: [] });
  });
});
