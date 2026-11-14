// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildFrame, type CaptureSpec } from "./capture.ts";
import type { TraceChunk } from "./tap.ts";

function chunk(id: string, t: number[], v: number[], staircase = false): TraceChunk {
  return { id, from: 0, to: t[t.length - 1], t: Float64Array.from(t), v: Float64Array.from(v), dropped: 0, staircase };
}

/** A 1 kHz sine sampled every 20 us for 10 ms. */
const sine = chunk(
  "a",
  Array.from({ length: 501 }, (_, i) => i * 20_000),
  Array.from({ length: 501 }, (_, i) => Math.sin(2 * Math.PI * 1000 * i * 20e-6)),
);

const spec = (over: Partial<CaptureSpec> = {}): CaptureSpec => ({ channels: [{ id: "a", kind: "analog" }], timeBaseNs: 2_000_000, ...over });

describe("buildFrame", () => {
  it("shows the newest time base when nothing triggers", () => {
    const frame = buildFrame({ a: sine }, spec(), 10_000_000);
    expect(frame.startNs).toBe(8_000_000);
    expect(frame.triggeredAt).toBeUndefined();
  });

  it("starts at the newest rising edge whose whole window is already recorded", () => {
    const frame = buildFrame({ a: sine }, spec({ trigger: { channel: "a", edge: "rising", level: 0 } }), 10_000_000);
    expect(frame.triggeredAt).toBe(7_020_000);
    expect(frame.endNs).toBe(9_020_000);
  });

  it("triggers on the falling edge half a period earlier", () => {
    const frame = buildFrame({ a: sine }, spec({ trigger: { channel: "a", edge: "falling", level: 0 } }), 10_000_000);
    expect(frame.triggeredAt).toBe(7_500_000);
  });

  it("does not trigger above the signal", () => {
    expect(buildFrame({ a: sine }, spec({ trigger: { channel: "a", edge: "rising", level: 2 } }), 10_000_000).triggeredAt).toBeUndefined();
  });

  it("joins the points of a waveform and holds the steps of an event trace", () => {
    const held = chunk("d", [0, 5], [0, 1], true);
    const frame = buildFrame({ a: sine, d: held }, spec({ channels: [{ id: "a", kind: "analog" }, { id: "d", kind: "digital" }] }), 10_000_000);
    expect(frame.channels.map((c) => c.zoh)).toEqual([false, true]);
  });
});
