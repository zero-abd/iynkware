import { type Annotation, type Edges, levelAt } from "./edges.ts";

export interface UartConfig {
  baud: number;
  dataBits?: number;
  parity?: "none" | "even" | "odd";
  stopBits?: number;
}

const NS_PER_S = 1e9;

const printable = (byte: number): string => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : "");

const hex = (value: number, bits: number): string => `0x${value.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), "0")}`;

/**
 * Frames of an idle-high line: a start bit, the data bits least significant first, an optional parity bit and the stop
 * bits. Each bit is read at its middle. A frame whose start bit is gone by its middle is a glitch and is skipped.
 */
export function decodeUart(line: Edges, { baud, dataBits = 8, parity = "none", stopBits = 1 }: UartConfig, lane = "rx"): Annotation[] {
  const bitNs = NS_PER_S / baud;
  const parityBits = parity === "none" ? 0 : 1;
  const frameBits = 1 + dataBits + parityBits + stopBits;
  const out: Annotation[] = [];
  let from = -Infinity;
  for (let i = 1; i < line.t.length; i++) {
    const start = line.t[i];
    if (line.level[i] !== 0 || start < from) continue;
    const at = (bit: number) => levelAt(line, start + (bit + 0.5) * bitNs);
    if (at(0) !== 0) continue;
    let value = 0;
    let ones = 0;
    for (let b = 0; b < dataBits; b++) {
      const bit = at(1 + b);
      value |= bit << b;
      ones += bit;
    }
    let error: "framing" | "parity" | undefined;
    if (parityBits === 1 && at(1 + dataBits) !== (parity === "even" ? ones % 2 : (ones + 1) % 2)) error = "parity";
    for (let s = 0; s < stopBits; s++) if (at(1 + dataBits + parityBits + s) !== 1) error = "framing";
    const text = printable(value);
    out.push({ kind: "data", lane, startNs: start, endNs: start + frameBits * bitNs, value, label: text === "" ? hex(value, dataBits) : `${hex(value, dataBits)} ${text}`, ...(error && { error }) });
    from = start + (frameBits - 0.5) * bitNs;
  }
  return out;
}
