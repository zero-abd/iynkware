import { type Annotation, type Edges, type Level, levelAt } from "./edges.ts";

export interface SpiConfig {
  /** Clock level while idle. */
  cpol: Level;
  /** 0: data is read on the first clock edge of a bit, 1: on the second. */
  cpha: Level;
  bits?: number;
  msbFirst?: boolean;
  /** Chip select pulls low to start a transfer. */
  csActiveLow?: boolean;
}

export interface SpiLines {
  sck: Edges;
  mosi?: Edges;
  miso?: Edges;
  cs?: Edges;
}

const hex = (value: number, bits: number): string => `0x${value.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), "0")}`;

/** Times the clock changes to the level that reads a bit: rising when idle low in mode 0 and 3, falling for 1 and 2. */
function sampleTimes(sck: Edges, { cpol, cpha }: SpiConfig): number[] {
  const wanted: Level = (cpol === 0) === (cpha === 0) ? 1 : 0;
  return sck.t.filter((_, i) => i > 0 && sck.level[i] === wanted);
}

function word(line: Edges, times: number[], bits: number, msbFirst: boolean): number {
  let value = 0;
  times.forEach((t, i) => {
    const bit = levelAt(line, t);
    value |= bit << (msbFirst ? bits - 1 - i : i);
  });
  return value;
}

/**
 * Words of `bits` bits read on the active clock edge. With a chip select, only edges while it is asserted count and a
 * short word at the end of a transfer is dropped; without one, the clock edges are cut into words from the first.
 */
export function decodeSpi({ sck, mosi, miso, cs }: SpiLines, config: SpiConfig): Annotation[] {
  const bits = config.bits ?? 8;
  const msbFirst = config.msbFirst ?? true;
  const activeLow = config.csActiveLow ?? true;
  const edges = sampleTimes(sck, config);
  const windows: number[][] = [];
  if (cs) {
    const active: Level = activeLow ? 0 : 1;
    let begin: number | null = null;
    const take = (end: number) => {
      if (begin !== null) windows.push(edges.filter((t) => t >= begin! && t < end));
      begin = null;
    };
    cs.t.forEach((t, i) => {
      take(t);
      if (cs.level[i] === active) begin = t;
    });
    take(Infinity);
  } else {
    windows.push(edges);
  }
  const out: Annotation[] = [];
  for (const window of windows) {
    for (let from = 0; from + bits <= window.length; from += bits) {
      const times = window.slice(from, from + bits);
      const gap = bits > 1 ? (times[bits - 1] - times[0]) / (bits - 1) : 0;
      const startNs = times[0] - gap / 2;
      const endNs = times[bits - 1] + gap / 2;
      for (const [lane, line] of [["mosi", mosi], ["miso", miso]] as const) {
        if (!line) continue;
        const value = word(line, times, bits, msbFirst);
        out.push({ kind: "data", lane, startNs, endNs, value, label: hex(value, bits) });
      }
    }
  }
  return out;
}
