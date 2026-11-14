// The pin each bit of a Verilog top-level port lands on. A lesson's XDC or QSF names the pins it uses; a design that
// uses a board port the map leaves out gets the board's own pins, matched by name from the pins the project's board has.
import type { BoardProfile } from '../../../sim/boards/profiles';
import { digitNet } from './nets';

export type PortMap = Record<string, string[]>;

const SEGMENTS = 'ABCDEFG';
const PMOD_PINS = [1, 2, 3, 4, 7, 8, 9, 10];

/** Where the lesson catalogue's pin names are not the port name followed by the bit number. */
function catalogueName(boardId: string, port: string, bit: number): string | undefined {
  if (boardId === 'basys3') {
    if (port === 'led') return `LD${bit}`;
    if (port === 'seg') return `C${SEGMENTS[bit]}`;
    if (/^J[ABC]$/.test(port)) return `${port}${PMOD_PINS[bit]}`;
  }
  if (boardId === 'de10-lite') {
    const hex = /^HEX(\d)$/.exec(port);
    if (hex) return digitNet(Number(hex[1]), bit);
    if (port === 'ARDUINO_IO') return bit < 14 ? `D${bit}` : bit === 14 ? 'SDA' : 'SCL';
  }
  return undefined;
}

/**
 * The map for the ports of `profile` that the board's `pins` carry, `''` for a bit with no pin. Port names are matched
 * to pin ids ignoring case (`sw` bit 3 is `SW3`); the clock is not a signal and is left out.
 */
export function defaultPorts(profile: BoardProfile, pins: Iterable<string>): PortMap {
  const byLower = new Map([...pins].map((id) => [id.toLowerCase(), id]));
  const map: PortMap = {};
  for (const { name, width } of profile.fpga?.ports ?? []) {
    if (name === profile.fpga?.clockPort) continue;
    const catalogue = Array.from({ length: width }, (_, bit) => catalogueName(profile.id, name, bit)?.toLowerCase());
    const found = catalogue.map((named, bit) => {
      const plain = (width === 1 ? name : `${name}${bit}`).toLowerCase();
      // `JA2` is the catalogue's name for bit 1 of JA, so it is not also the plain name of bit 2.
      return (named && byLower.get(named)) || (catalogue.includes(plain) ? '' : byLower.get(plain)) || '';
    });
    if (found.some(Boolean)) map[name] = found;
  }
  return map;
}

/** The ports the project names, then the board's pins for every other port of the board. */
export function portMap(profile: BoardProfile, pins: Iterable<string>, explicit: Readonly<Record<string, readonly string[] | undefined>> = {}): PortMap {
  const named = Object.fromEntries(Object.entries(explicit).flatMap(([port, names]) => (names ? [[port, [...names]]] : [])));
  return { ...defaultPorts(profile, pins), ...named };
}
