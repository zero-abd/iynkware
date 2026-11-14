// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FLASH_BASE, FLASH_BYTES, RP2040_FAMILY, buildUf2, checkUf2, flashOf, parseUf2 } from "./uf2.ts";

const bytesOf = (n: number, start = 0): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (start + i) & 0xff);

describe("parseUf2", () => {
  it("reads back what buildUf2 packed, in 256 byte blocks", () => {
    const file = buildUf2([{ address: FLASH_BASE + 0x100, data: bytesOf(600) }]);
    expect(file.length).toBe(3 * 512);
    const parsed = parseUf2(file);
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.value.bytes).toBe(600);
    expect(parsed.value.segments.map((s) => [s.address - FLASH_BASE, s.data.length])).toEqual([
      [0x100, 256],
      [0x200, 256],
      [0x300, 88],
    ]);
    const flash = flashOf(parsed.value);
    expect(flash.length).toBe(FLASH_BYTES);
    expect(Array.from(flash.subarray(0x100, 0x100 + 600))).toEqual(Array.from(bytesOf(600)));
    expect(flash[0]).toBe(0xff);
  });

  it("skips blocks marked not-main-flash and refuses a file with nothing else", () => {
    const file = buildUf2([{ address: FLASH_BASE, data: bytesOf(16) }]);
    new DataView(file.buffer).setUint32(8, 0x1 | 0x2000, true);
    expect(checkUf2(file)).toMatchObject({ ok: false, error: { kind: "uf2-no-blocks" } });
  });

  it("names why a file cannot run on a Pico", () => {
    const good = buildUf2([{ address: FLASH_BASE, data: bytesOf(16) }]);
    const kind = (file: Uint8Array) => {
      const parsed = parseUf2(file);
      return parsed.ok ? "ok" : parsed.error.kind;
    };
    expect(kind(good)).toBe("ok");
    expect(kind(good.subarray(0, 500))).toBe("uf2-bad-block");
    expect(kind(new Uint8Array(0))).toBe("uf2-bad-block");
    const brokenEnd = good.slice();
    brokenEnd[511] ^= 0xff;
    expect(kind(brokenEnd)).toBe("uf2-bad-block");
    expect(kind(buildUf2([{ address: FLASH_BASE, data: bytesOf(16) }], 0xe48bff57))).toBe("uf2-wrong-family");
    expect(kind(buildUf2([{ address: 0x20000000, data: bytesOf(16) }]))).toBe("uf2-out-of-flash");
    expect(kind(buildUf2([{ address: FLASH_BASE + FLASH_BYTES - 8, data: bytesOf(16) }]))).toBe("uf2-out-of-flash");
    expect(kind(new Uint8Array(9 * 1024 * 1024))).toBe("uf2-too-large");
    const tooBig = good.slice();
    new DataView(tooBig.buffer).setUint32(16, 477, true);
    expect(kind(tooBig)).toBe("uf2-bad-block");
  });

  it("refuses a file whose first blocks hold no program", () => {
    const file = buildUf2([{ address: FLASH_BASE + 0x2000, data: bytesOf(16) }]);
    expect(checkUf2(file)).toMatchObject({ ok: false, error: { kind: "uf2-no-vectors" } });
    const withVectors = buildUf2([{ address: FLASH_BASE + 0x100, data: Uint8Array.of(0, 0x20, 0x04, 0x20, 1, 1, 0, 0x10) }]);
    expect(checkUf2(withVectors)).toEqual({ ok: true, bytes: 8 });
  });

  it("accepts a file that carries no family id", () => {
    const file = buildUf2([{ address: FLASH_BASE, data: bytesOf(16) }]);
    new DataView(file.buffer).setUint32(8, 0, true);
    new DataView(file.buffer).setUint32(28, 0, true);
    expect(parseUf2(file)).toMatchObject({ ok: true, value: { bytes: 16 } });
    expect(RP2040_FAMILY).toBe(0xe48bff56);
  });
});
