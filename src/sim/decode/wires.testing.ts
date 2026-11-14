import type { Level, Wire } from "./edges.ts";

/** Builds a recorded line from `[t, level]` changes, with volts at `high` and 0. */
export function wireOf(changes: readonly (readonly [number, Level])[], high = 3.3): Wire {
  return { t: Float64Array.from(changes.map(([t]) => t)), v: Float64Array.from(changes.map(([, l]) => l * high)) };
}

/** An 8N1 byte stream at `baud`, the way a logic analyser captures a UART line. */
export function uartCapture(bytes: readonly number[], baud: number, o: { parity?: "even" | "odd"; badStop?: boolean; gapBits?: number; high?: number } = {}): Wire {
  const bit = 1e9 / baud;
  const changes: [number, Level][] = [[0, 1]];
  let t = 2 * bit;
  for (const byte of bytes) {
    const bits: Level[] = [0, ...Array.from({ length: 8 }, (_, i) => ((byte >> i) & 1) as Level)];
    if (o.parity) {
      const ones = bits.slice(1).reduce<number>((n, b) => n + b, 0);
      bits.push((o.parity === "even" ? ones % 2 : (ones + 1) % 2) as Level);
    }
    bits.push(o.badStop ? 0 : 1);
    for (const b of bits) {
      changes.push([t, b]);
      t += bit;
    }
    changes.push([t, 1]);
    t += (o.gapBits ?? 2) * bit;
  }
  return wireOf(changes, o.high);
}

export interface I2cStep {
  start?: true;
  stop?: true;
  byte?: number;
  nack?: true;
}

/** The two lines of an I2C master and slave doing `steps` at a 100 kHz clock, with data changing a quarter period after the clock falls. */
export function i2cCapture(steps: readonly I2cStep[]): { sda: Wire; scl: Wire } {
  const quarter = 2500;
  const sda: [number, Level][] = [[0, 1]];
  const scl: [number, Level][] = [[0, 1]];
  let t = 4 * quarter;
  let held = 1;
  const data = (at: number, level: Level) => {
    if (level !== held) sda.push([at, level]);
    held = level;
  };
  for (const step of steps) {
    if (step.start) {
      if (scl[scl.length - 1][1] === 0) {
        data(t, 1);
        scl.push([t + quarter, 1]);
        t += 2 * quarter;
      }
      data(t, 0);
      t += quarter;
      scl.push([t, 0]);
      t += quarter;
    }
    if (step.byte !== undefined) {
      const bits: Level[] = [...Array.from({ length: 8 }, (_, i) => ((step.byte! >> (7 - i)) & 1) as Level), step.nack ? 1 : 0];
      for (const bit of bits) {
        data(t, bit);
        scl.push([t + quarter, 1], [t + 3 * quarter, 0]);
        t += 4 * quarter;
      }
    }
    if (step.stop) {
      data(t, 0);
      t += quarter;
      scl.push([t, 1]);
      t += quarter;
      data(t, 1);
      t += 2 * quarter;
    }
  }
  return { sda: wireOf(sda), scl: wireOf(scl) };
}

/** `words` clocked out on mosi (and miso, when given) in SPI mode 0, MSB first, with chip select low for each group of `perTransfer` words. */
export function spiCapture(mosi: readonly number[], o: { miso?: readonly number[]; perTransfer?: number; cpol?: Level; cpha?: Level } = {}): { sck: Wire; mosi: Wire; miso: Wire; cs: Wire } {
  const cpol = o.cpol ?? 0;
  const cpha = o.cpha ?? 0;
  const half = 500;
  const per = o.perTransfer ?? mosi.length;
  const sck: [number, Level][] = [[0, cpol]];
  const out: [number, Level][] = [[0, 0]];
  const back: [number, Level][] = [[0, 0]];
  const cs: [number, Level][] = [[0, 1]];
  let t = 4 * half;
  const drive = (line: [number, Level][], at: number, level: Level) => {
    if (line[line.length - 1][1] !== level) line.push([at, level]);
  };
  mosi.forEach((word, w) => {
    if (w % per === 0) {
      cs.push([t, 0]);
      t += 2 * half;
    }
    for (let i = 7; i >= 0; i--) {
      const lead = t;
      const trail = t + half;
      const first = cpha === 0 ? lead - half : lead;
      drive(out, first, ((word >> i) & 1) as Level);
      drive(back, first, (((o.miso?.[w] ?? 0) >> i) & 1) as Level);
      sck.push([lead, (cpol ^ 1) as Level], [trail, cpol]);
      t += 2 * half;
    }
    if ((w + 1) % per === 0 || w === mosi.length - 1) {
      t += half;
      cs.push([t, 1]);
      t += 2 * half;
    }
  });
  return { sck: wireOf(sck), mosi: wireOf(out), miso: wireOf(back), cs: wireOf(cs) };
}
