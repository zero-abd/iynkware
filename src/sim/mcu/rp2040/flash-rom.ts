import type { RP2040 } from "rp2040js";

const BKPT = 0xbe00;
const FUNCTION_TABLE = 0x14;
/** The two-letter codes of the ROM's flash routines, low byte first. */
const ERASE = 0x4552;
const PROGRAM = 0x5052;

export const BREAK_ERASE = 1;
export const BREAK_PROGRAM = 2;

/** rp2040js does not model the flash chip the ROM routines talk to, so they are replaced by a BKPT that `handleFlashBreak` answers. */
export function patchFlashRoutines(rom: Uint32Array): void {
  const half = new Uint16Array(rom.buffer, rom.byteOffset, rom.length * 2);
  for (let at = half[FUNCTION_TABLE / 2] / 2; half[at] !== 0; at += 2) {
    if (half[at] === ERASE) half[(half[at + 1] & ~1) / 2] = BKPT | BREAK_ERASE;
    if (half[at] === PROGRAM) half[(half[at + 1] & ~1) / 2] = BKPT | BREAK_PROGRAM;
  }
}

/** Does what flash_range_erase or flash_range_program does to the flash array, then returns to the caller. False for any other BKPT. */
export function handleFlashBreak(mcu: RP2040, code: number): boolean {
  const { registers } = mcu.core;
  const [offset, second, count] = registers;
  if (code === BREAK_ERASE) mcu.flash.fill(0xff, offset, offset + second);
  else if (code === BREAK_PROGRAM) for (let i = 0; i < count; i++) mcu.flash[offset + i] &= mcu.readUint8(second + i);
  else return false;
  mcu.core.PC = registers[14] & ~1;
  return true;
}
