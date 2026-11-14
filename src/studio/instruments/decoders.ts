import type { Instrument } from "../../project/generated/types.ts";
import { type Annotation, decodeI2c, decodeSpi, decodeUart, toEdges } from "../../sim/decode/index.ts";
import type { CaptureFrame } from "../../sim/probe/capture.ts";

export type Protocol = "off" | "uart" | "i2c" | "spi";

/** The signals of each protocol in the order the logic analyser's lines are given; the first is the line the instrument was added on. */
export const ROLES: Record<Exclude<Protocol, "off">, readonly string[]> = {
  uart: ["RX"],
  i2c: ["SDA", "SCL"],
  spi: ["SCK", "MOSI", "MISO", "CS"],
};

export const PROTOCOLS: readonly Protocol[] = ["off", "uart", "i2c", "spi"];
export const MAX_LINES = 4;

export interface DecoderSettings {
  protocol: Protocol;
  baud: number;
  parity: "none" | "even" | "odd";
  spiMode: 0 | 1 | 2 | 3;
  /** Net of each role after the first, by role index minus one; undefined for a role left empty. */
  lines: (string | undefined)[];
}

export function decoderSettings(settings: Instrument["settings"]): DecoderSettings {
  const raw = (settings ?? {}) as Record<string, unknown>;
  const baud = typeof raw.baud === "number" && raw.baud >= 50 && raw.baud <= 3e6 ? raw.baud : 9600;
  const lines = Array.isArray(raw.lines) ? raw.lines.slice(0, MAX_LINES - 1).map((n) => (typeof n === "string" && n !== "" ? n : undefined)) : [];
  return {
    protocol: PROTOCOLS.find((p) => p === raw.protocol) ?? "off",
    baud,
    parity: raw.parity === "even" || raw.parity === "odd" ? raw.parity : "none",
    spiMode: raw.spiMode === 1 || raw.spiMode === 2 || raw.spiMode === 3 ? raw.spiMode : 0,
    lines: Array.from({ length: MAX_LINES - 1 }, (_, i) => lines[i]),
  };
}

/** The probe id of a line: the instrument's own for the first, `<id>:<n>` after it. */
export const lineId = (instrumentId: string, role: number): string => (role === 0 ? instrumentId : `${instrumentId}:${role}`);

/** Marks for the bytes in the window of `frame`, reading the lines named by `ids` (by role; a missing line is an empty string). A mark that runs past the window is a frame cut by its end and is left out. */
export function annotate(frame: CaptureFrame, ids: readonly string[], s: DecoderSettings): Annotation[] {
  if (s.protocol === "off") return [];
  const edges = (role: number) => {
    const c = frame.channels.find((ch) => ch.id === ids[role]);
    return c ? toEdges(c) : undefined;
  };
  let notes: Annotation[] = [];
  if (s.protocol === "uart") {
    const rx = edges(0);
    if (rx) notes = decodeUart(rx, { baud: s.baud, parity: s.parity });
  } else if (s.protocol === "i2c") {
    const [sda, scl] = [edges(0), edges(1)];
    if (sda && scl) notes = decodeI2c(sda, scl);
  } else {
    const [sck, mosi, miso, cs] = [edges(0), edges(1), edges(2), edges(3)];
    if (sck && (mosi || miso)) notes = decodeSpi({ sck, mosi, miso, cs }, { cpol: s.spiMode >= 2 ? 1 : 0, cpha: s.spiMode % 2 === 1 ? 1 : 0 });
  }
  return notes.filter((n) => n.endNs <= frame.endNs);
}
