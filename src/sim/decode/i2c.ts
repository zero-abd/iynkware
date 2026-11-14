import { type Annotation, type Edges, type Level, levelAt } from "./edges.ts";

interface Change {
  t: number;
  line: "sda" | "scl";
  level: Level;
}

const hex = (value: number): string => `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;

/** Every change of either line in time order; at one instant the clock goes first, so a data change with it is read after the clock. */
function changes(sda: Edges, scl: Edges): Change[] {
  const list: Change[] = [];
  sda.t.forEach((t, i) => i > 0 && list.push({ t, line: "sda", level: sda.level[i] }));
  scl.t.forEach((t, i) => i > 0 && list.push({ t, line: "scl", level: scl.level[i] }));
  return list.sort((a, b) => a.t - b.t || (a.line === b.line ? 0 : a.line === "scl" ? -1 : 1));
}

/**
 * A start is the data line falling while the clock is high, a stop the data line rising while it is high. Between them
 * each clock rise carries one bit: eight data bits, then the acknowledge bit, which the receiver pulls low. The first
 * byte after a start is the 7 bit address and the read or write bit. Ten bit addresses are read as two ordinary bytes.
 */
export function decodeI2c(sda: Edges, scl: Edges, lane = "i2c"): Annotation[] {
  const out: Annotation[] = [];
  let inside = false;
  let bits: { level: Level; t: number }[] = [];
  let first = true;
  let bitStart = 0;
  const list = changes(sda, scl);
  for (let i = 0; i < list.length; i++) {
    const { t, line, level } = list[i];
    if (line === "sda") {
      if (levelAt(scl, t) === 0) continue;
      if (level === 0) {
        out.push({ kind: "start", lane, startNs: t, endNs: t });
        inside = true;
        first = true;
        bits = [];
      } else if (inside) {
        out.push({ kind: "stop", lane, startNs: t, endNs: t });
        inside = false;
        bits = [];
      }
      continue;
    }
    if (!inside) continue;
    if (level === 1) {
      bits.push({ level: levelAt(sda, t), t });
      if (bits.length === 1) bitStart = t;
      if (bits.length < 9) continue;
      const value = bits.slice(0, 8).reduce((byte, b) => (byte << 1) | b.level, 0);
      const endNs = bits[7].t;
      if (first) {
        const write = (value & 1) === 0;
        out.push({ kind: "address", lane, startNs: bitStart, endNs, value: value >> 1, write, label: `${hex(value >> 1)} ${write ? "W" : "R"}` });
      } else {
        out.push({ kind: "data", lane, startNs: bitStart, endNs, value, label: hex(value) });
      }
      out.push({ kind: bits[8].level === 0 ? "ack" : "nack", lane, startNs: bits[8].t, endNs: bits[8].t });
      first = false;
      bits = [];
    }
  }
  return out;
}
