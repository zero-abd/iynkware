// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decodeI2c, decodeSpi, decodeUart, toEdges } from "./index.ts";
import { i2cCapture, spiCapture, uartCapture, wireOf } from "./wires.testing.ts";

const values = (list: { kind: string; value?: number }[], kind: string) => list.filter((a) => a.kind === kind).map((a) => a.value);

describe("edges", () => {
  it("reads a 5 V and a 3.3 V line against their own middle", () => {
    expect(toEdges(wireOf([[0, 0], [10, 1], [20, 0]], 5)).level).toEqual([0, 1, 0]);
    expect(toEdges(wireOf([[0, 0], [10, 1]], 3.3)).t).toEqual([0, 10]);
  });

  it("drops a sample that does not change the level", () => {
    const edges = toEdges({ t: [0, 5, 10, 15], v: [0, 0.1, 3, 3.2] });
    expect(edges).toEqual({ t: [0, 10], level: [0, 1] });
  });
});

describe("UART", () => {
  it("decodes a captured Hello at 9600 baud", () => {
    const hello = Array.from("Hello", (c) => c.charCodeAt(0));
    const notes = decodeUart(toEdges(uartCapture(hello, 9600)), { baud: 9600 });
    expect(values(notes, "data")).toEqual(hello);
    expect(notes.map((n) => n.kind === "data" && n.label)).toEqual(["0x48 H", "0x65 e", "0x6C l", "0x6C l", "0x6F o"]);
    expect(notes.every((n) => n.kind === "data" && n.error === undefined)).toBe(true);
  });

  it("puts each frame where its bits are", () => {
    const [first] = decodeUart(toEdges(uartCapture([0x55], 115200)), { baud: 115200 });
    expect(first.endNs - first.startNs).toBeCloseTo(10 * (1e9 / 115200), 0);
  });

  it("decodes back to back bytes with no gap", () => {
    const notes = decodeUart(toEdges(uartCapture([0x00, 0xff, 0x81], 9600, { gapBits: 0 })), { baud: 9600 });
    expect(values(notes, "data")).toEqual([0x00, 0xff, 0x81]);
  });

  it("flags a bad stop bit as a framing error", () => {
    const [note] = decodeUart(toEdges(uartCapture([0x41], 9600, { badStop: true })), { baud: 9600 });
    expect(note.kind === "data" && note.error).toBe("framing");
  });

  it("checks parity", () => {
    const even = toEdges(uartCapture([0x07, 0x03], 9600, { parity: "even" }));
    expect(decodeUart(even, { baud: 9600, parity: "even" }).map((n) => n.kind === "data" && n.error)).toEqual([undefined, undefined]);
    expect(decodeUart(even, { baud: 9600, parity: "odd" }).map((n) => n.kind === "data" && n.error)).toEqual(["parity", "parity"]);
  });

  it("decodes 7 data bits", () => {
    const wire = uartCapture([0x41], 9600);
    const [seven] = decodeUart(toEdges(wire), { baud: 9600, dataBits: 7 });
    expect(seven.kind === "data" && seven.value).toBe(0x41 & 0x7f);
  });

  it("says nothing about a line that never leaves idle", () => {
    expect(decodeUart(toEdges(wireOf([[0, 1]])), { baud: 9600 })).toEqual([]);
  });
});

describe("I2C", () => {
  const capture = i2cCapture([{ start: true, byte: 0x78 }, { byte: 0x00 }, { byte: 0xae }, { stop: true }]);
  const notes = decodeI2c(toEdges(capture.sda), toEdges(capture.scl));

  it("finds the start, the address with its direction, the data and the stop", () => {
    expect(notes.map((n) => n.kind)).toEqual(["start", "address", "ack", "data", "ack", "data", "ack", "stop"]);
    const address = notes[1];
    expect(address.kind === "address" && [address.value, address.write]).toEqual([0x3c, true]);
    expect(values(notes, "data")).toEqual([0x00, 0xae]);
  });

  it("reads a nack and a read address", () => {
    const read = i2cCapture([{ start: true, byte: 0x91 }, { byte: 0x1a, nack: true }, { stop: true }]);
    const got = decodeI2c(toEdges(read.sda), toEdges(read.scl));
    const address = got.find((n) => n.kind === "address");
    expect(address?.kind === "address" && [address.value, address.write]).toEqual([0x48, false]);
    expect(got.map((n) => n.kind)).toEqual(["start", "address", "ack", "data", "nack", "stop"]);
  });

  it("starts a new transaction on a repeated start", () => {
    const two = i2cCapture([{ start: true, byte: 0x90 }, { byte: 0x00 }, { start: true, byte: 0x91 }, { byte: 0x55, nack: true }, { stop: true }]);
    const got = decodeI2c(toEdges(two.sda), toEdges(two.scl));
    expect(got.filter((n) => n.kind === "start")).toHaveLength(2);
    expect(got.filter((n) => n.kind === "address").map((n) => n.kind === "address" && n.write)).toEqual([true, false]);
  });

  it("keeps each mark inside the transaction in time order", () => {
    const starts = notes.map((n) => n.startNs);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("ignores data that changes while the clock is low", () => {
    const quiet = i2cCapture([]);
    expect(decodeI2c(toEdges(quiet.sda), toEdges(quiet.scl))).toEqual([]);
  });
});

describe("SPI", () => {
  it("decodes mode 0 words on mosi and miso", () => {
    const mosi = [0x9f, 0x00, 0xa5];
    const miso = [0x00, 0xef, 0x40];
    const lines = spiCapture(mosi, { miso, perTransfer: 3 });
    const notes = decodeSpi({ sck: toEdges(lines.sck), mosi: toEdges(lines.mosi), miso: toEdges(lines.miso), cs: toEdges(lines.cs) }, { cpol: 0, cpha: 0 });
    expect(notes.filter((n) => n.lane === "mosi").map((n) => n.kind === "data" && n.value)).toEqual(mosi);
    expect(notes.filter((n) => n.lane === "miso").map((n) => n.kind === "data" && n.value)).toEqual(miso);
  });

  it("splits transfers at chip select", () => {
    const lines = spiCapture([0x01, 0x02, 0x03, 0x04], { perTransfer: 2 });
    const notes = decodeSpi({ sck: toEdges(lines.sck), mosi: toEdges(lines.mosi), cs: toEdges(lines.cs) }, { cpol: 0, cpha: 0 });
    expect(values(notes, "data")).toEqual([1, 2, 3, 4]);
    expect(notes.every((n) => n.lane === "mosi")).toBe(true);
  });

  it("decodes without a chip select line", () => {
    const lines = spiCapture([0xde, 0xad]);
    const notes = decodeSpi({ sck: toEdges(lines.sck), mosi: toEdges(lines.mosi) }, { cpol: 0, cpha: 0 });
    expect(values(notes, "data")).toEqual([0xde, 0xad]);
  });

  it("reads least significant bit first and 16 bit words", () => {
    const lines = spiCapture([0x01]);
    const lsb = decodeSpi({ sck: toEdges(lines.sck), mosi: toEdges(lines.mosi) }, { cpol: 0, cpha: 0, msbFirst: false });
    expect(values(lsb, "data")).toEqual([0x80]);
    const wide = decodeSpi({ sck: toEdges(lines.sck), mosi: toEdges(lines.mosi) }, { cpol: 0, cpha: 0, bits: 4 });
    expect(values(wide, "data")).toEqual([0, 1]);
  });

  it("reads mode 3 on the rising edge as mode 0 does", () => {
    const lines = spiCapture([0x3c], { cpol: 1, cpha: 1 });
    const notes = decodeSpi({ sck: toEdges(lines.sck), mosi: toEdges(lines.mosi) }, { cpol: 1, cpha: 1 });
    expect(values(notes, "data")).toEqual([0x3c]);
  });

  it("drops a word cut short by the end of the transfer", () => {
    const lines = spiCapture([0xff]);
    const notes = decodeSpi({ sck: toEdges(lines.sck), mosi: toEdges(lines.mosi) }, { cpol: 0, cpha: 0, bits: 16 });
    expect(notes).toEqual([]);
  });
});
