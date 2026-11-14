import { parseFailure, type ParseError } from "../hex.ts";

/** The UF2 family id of the RP2040. */
export const RP2040_FAMILY = 0xe48bff56;
export const FLASH_BASE = 0x10000000;
/** The flash of a Raspberry Pi Pico. */
export const FLASH_BYTES = 2 * 1024 * 1024;

/** The boot ROM jumps to the second stage loader in the first 256 bytes of flash; the program's vector table follows. */
export const BOOT2_BYTES = 256;
const BOOT2_CRC_AT = BOOT2_BYTES - 4;
const SRAM_START = 0x20000000;
const SRAM_END = 0x20042000;
const BLOCK = 512;
const PAYLOAD_MAX = 476;
const MAGIC_0 = 0x0a324655;
const MAGIC_1 = 0x9e5d5157;
const MAGIC_END = 0x0ab16f30;
const FLAG_NOT_MAIN_FLASH = 0x00000001;
const FLAG_FAMILY_ID = 0x00002000;
/** A full 2 MiB flash is 8192 blocks; a file may carry a little more than that. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export interface Uf2Segment {
  address: number;
  data: Uint8Array;
}

export interface Uf2Image {
  segments: Uf2Segment[];
  /** Payload bytes in the file. */
  bytes: number;
}

export type Uf2Result = { ok: true; value: Uf2Image } | { ok: false; error: ParseError };

/** Reads a UF2 file made for the RP2040 into the flash blocks it carries. Blocks marked not-main-flash are skipped. */
export function parseUf2(file: Uint8Array): Uf2Result {
  if (file.length === 0 || file.length % BLOCK !== 0) return parseFailure("uf2-bad-block", "the file is not a whole number of 512 byte blocks");
  if (file.length > MAX_FILE_BYTES) return parseFailure("uf2-too-large", "the UF2 file is too large");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const segments: Uf2Segment[] = [];
  let bytes = 0;
  for (let at = 0; at < file.length; at += BLOCK) {
    if (view.getUint32(at, true) !== MAGIC_0 || view.getUint32(at + 4, true) !== MAGIC_1 || view.getUint32(at + BLOCK - 4, true) !== MAGIC_END) {
      return parseFailure("uf2-bad-block", "a block does not start and end with the UF2 markers", at);
    }
    const flags = view.getUint32(at + 8, true);
    if (flags & FLAG_NOT_MAIN_FLASH) continue;
    if (flags & FLAG_FAMILY_ID && view.getUint32(at + 28, true) !== RP2040_FAMILY) return parseFailure("uf2-wrong-family", "the UF2 file is for another chip", at);
    const address = view.getUint32(at + 12, true);
    const size = view.getUint32(at + 16, true);
    if (size > PAYLOAD_MAX) return parseFailure("uf2-bad-block", "a block carries more than 476 bytes", at);
    if (address < FLASH_BASE || address + size > FLASH_BASE + FLASH_BYTES) return parseFailure("uf2-out-of-flash", "a block writes outside the flash of the Pico", at);
    segments.push({ address, data: file.slice(at + 32, at + 32 + size) });
    bytes += size;
  }
  if (segments.length === 0) return parseFailure("uf2-no-blocks", "the UF2 file has no flash blocks");
  return { ok: true, value: { segments, bytes } };
}

/** The 2 MiB flash a Pico holds after the file is copied to it: erased bytes are 0xFF. */
export function flashOf(image: Uf2Image): Uint8Array {
  const flash = new Uint8Array(FLASH_BYTES).fill(0xff);
  for (const { address, data } of image.segments) flash.set(data, address - FLASH_BASE);
  return flash;
}

/** CRC-32/MPEG-2, the checksum the boot ROM checks the second stage loader with. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  return crc >>> 0;
}

/** True when the first 256 bytes of flash are a second stage loader the boot ROM would accept. */
export const hasBoot2 = (flash: Uint8Array): boolean =>
  new DataView(flash.buffer, flash.byteOffset + BOOT2_CRC_AT, 4).getUint32(0, true) === crc32(flash.subarray(0, BOOT2_CRC_AT));

/** A flash with a second stage loader, or a vector table right after the first 256 bytes whose stack pointer is in RAM. */
export function hasProgram(flash: Uint8Array): boolean {
  if (hasBoot2(flash)) return true;
  const sp = new DataView(flash.buffer, flash.byteOffset + BOOT2_BYTES, 4).getUint32(0, true);
  return sp >= SRAM_START && sp <= SRAM_END;
}

/** What an import shows the person: the payload size, or why the file cannot run on a Pico. */
export function checkUf2(file: Uint8Array): { ok: true; bytes: number } | { ok: false; error: ParseError } {
  const parsed = parseUf2(file);
  if (!parsed.ok) return parsed;
  return hasProgram(flashOf(parsed.value)) ? { ok: true, bytes: parsed.value.bytes } : parseFailure("uf2-no-vectors", "the program has no vector table at the start of flash");
}

/** Packs segments into 256 byte UF2 blocks, as the pico-sdk's tools do. */
export function buildUf2(segments: readonly Uf2Segment[], family = RP2040_FAMILY): Uint8Array<ArrayBuffer> {
  const chunks: Uf2Segment[] = [];
  for (const { address, data } of segments) {
    for (let at = 0; at < data.length; at += 256) chunks.push({ address: address + at, data: data.subarray(at, at + 256) });
  }
  const out = new Uint8Array(chunks.length * BLOCK);
  const view = new DataView(out.buffer);
  chunks.forEach(({ address, data }, index) => {
    const at = index * BLOCK;
    view.setUint32(at, MAGIC_0, true);
    view.setUint32(at + 4, MAGIC_1, true);
    view.setUint32(at + 8, FLAG_FAMILY_ID, true);
    view.setUint32(at + 12, address, true);
    view.setUint32(at + 16, data.length, true);
    view.setUint32(at + 20, index, true);
    view.setUint32(at + 24, chunks.length, true);
    view.setUint32(at + 28, family, true);
    out.set(data, at + 32);
    view.setUint32(at + BLOCK - 4, MAGIC_END, true);
  });
  return out;
}
