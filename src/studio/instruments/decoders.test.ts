import { describe, expect, it } from "vitest";
import { type Wire } from "../../sim/decode/edges.ts";
import { i2cCapture, spiCapture, uartCapture } from "../../sim/decode/wires.testing.ts";
import type { CaptureFrame } from "../../sim/probe/capture.ts";
import { annotate, decoderSettings, lineId, ROLES } from "./decoders.ts";

const frameOf = (wires: Record<string, Wire>, endNs: number): CaptureFrame => ({
  startNs: 0,
  endNs,
  channels: Object.entries(wires).map(([id, w]) => ({ id, kind: "digital", t: Float64Array.from(w.t as ArrayLike<number>), v: Float64Array.from(w.v as ArrayLike<number>), zoh: true })),
  dropped: {},
  notes: [],
});

const values = (notes: { kind: string; value?: number }[]) => notes.filter((n) => n.kind === "data").map((n) => n.value);

describe("decoderSettings", () => {
  it("is off at 9600 baud with no parity", () => {
    expect(decoderSettings(undefined)).toEqual({ protocol: "off", baud: 9600, parity: "none", spiMode: 0, lines: [undefined, undefined, undefined] });
  });

  it("keeps what is saved and drops junk", () => {
    const s = decoderSettings({ protocol: "spi", baud: 1, parity: "odd", spiMode: 3, lines: ["net_a", "", 4] });
    expect(s).toEqual({ protocol: "spi", baud: 9600, parity: "odd", spiMode: 3, lines: ["net_a", undefined, undefined] });
  });

  it("names the lines of each protocol", () => {
    expect(ROLES.i2c).toEqual(["SDA", "SCL"]);
    expect(lineId("ins_x", 0)).toBe("ins_x");
    expect(lineId("ins_x", 2)).toBe("ins_x:2");
  });
});

describe("annotate", () => {
  it("reads a UART line", () => {
    const wire = uartCapture([0x68, 0x69], 9600);
    const notes = annotate(frameOf({ a: wire }, 3e6), ["a"], decoderSettings({ protocol: "uart" }));
    expect(values(notes)).toEqual([0x68, 0x69]);
  });

  it("leaves out a UART frame the window cuts off", () => {
    const wire = uartCapture([0x68, 0x69], 9600);
    const notes = annotate(frameOf({ a: wire }, 1.5e6), ["a"], decoderSettings({ protocol: "uart" }));
    expect(values(notes)).toEqual([0x68]);
  });

  it("reads I2C from the first two lines and needs both", () => {
    const { sda, scl } = i2cCapture([{ start: true, byte: 0xa0 }, { byte: 0x42 }, { stop: true }]);
    const frame = frameOf({ a: sda, b: scl }, 1e6);
    const s = decoderSettings({ protocol: "i2c" });
    expect(values(annotate(frame, ["a", "b"], s))).toEqual([0x42]);
    expect(annotate(frame, ["a", ""], s)).toEqual([]);
  });

  it("reads SPI in the mode chosen", () => {
    const lines = spiCapture([0xc3], { cpol: 1, cpha: 1 });
    const frame = frameOf({ a: lines.sck, b: lines.mosi }, 1e6);
    expect(values(annotate(frame, ["a", "b"], decoderSettings({ protocol: "spi", spiMode: 3 })))).toEqual([0xc3]);
    expect(annotate(frame, ["a", ""], decoderSettings({ protocol: "spi", spiMode: 3 }))).toEqual([]);
  });

  it("marks nothing while the decoder is off", () => {
    expect(annotate(frameOf({ a: uartCapture([1], 9600) }, 1e6), ["a"], decoderSettings(undefined))).toEqual([]);
  });
});
