import { FLASH_BASE, buildUf2 } from "./uf2.ts";

const VECTORS = FLASH_BASE + 0x100;
const VECTOR_COUNT = 16 + 26;
const CODE_BASE = VECTORS + VECTOR_COUNT * 4;
const STACK_TOP = 0x20042000;
const ALIGN_NOP = 0xbf00;

export const SIO = 0xd0000000;
export const IO_BANK0 = 0x40014000;
export const TIMER = 0x40054000;
export const UART0 = 0x40034000;
export const ADC = 0x4004c000;
export const PWM = 0x40050000;
export const I2C0 = 0x40044000;
const NVIC_ISER = 0xe000e100;

type Cond = "eq" | "ne" | "cs" | "cc" | "mi" | "pl";
const COND: Record<Cond, number> = { eq: 0, ne: 1, cs: 2, cc: 3, mi: 4, pl: 5 };

/** A Thumb assembler for the dozen instructions the test programs need, with labels and a literal pool behind the code. */
export class Asm {
  private readonly code: number[] = [];
  private readonly labels = new Map<string, number>();
  private readonly branches: { at: number; label: string; cond: Cond | null }[] = [];
  private readonly literals: { at: number; value: number }[] = [];

  private emit(half: number): void {
    this.code.push(half & 0xffff);
  }

  label(name: string): this {
    this.labels.set(name, this.code.length);
    return this;
  }

  movs(rd: number, imm: number): this {
    this.emit(0x2000 | (rd << 8) | imm);
    return this;
  }

  /** Loads any 32-bit constant: a MOVS when it fits, else from the literal pool. */
  imm(rd: number, value: number): this {
    if (value >= 0 && value < 256) return this.movs(rd, value);
    this.literals.push({ at: this.code.length, value: value >>> 0 });
    this.emit(0x4800 | (rd << 8));
    return this;
  }

  mov(rd: number, rm: number): this {
    this.emit(0x1c00 | (rm << 3) | rd);
    return this;
  }

  adds(rd: number, imm: number): this {
    this.emit(0x3000 | (rd << 8) | imm);
    return this;
  }

  addsReg(rd: number, rn: number, rm: number): this {
    this.emit(0x1800 | (rm << 6) | (rn << 3) | rd);
    return this;
  }

  subsReg(rd: number, rn: number, rm: number): this {
    this.emit(0x1a00 | (rm << 6) | (rn << 3) | rd);
    return this;
  }

  cmpImm(rn: number, imm: number): this {
    this.emit(0x2800 | (rn << 8) | imm);
    return this;
  }

  andsReg(rdn: number, rm: number): this {
    this.emit(0x4000 | (rm << 3) | rdn);
    return this;
  }

  cmp(rn: number, rm: number): this {
    this.emit(0x4280 | (rm << 3) | rn);
    return this;
  }

  lsls(rd: number, rm: number, imm: number): this {
    this.emit((imm << 6) | (rm << 3) | rd);
    return this;
  }

  /** STR rt, [rn, #offset] with a word offset of 0 to 124. */
  str(rt: number, rn: number, offset = 0): this {
    this.emit(0x6000 | ((offset >> 2) << 6) | (rn << 3) | rt);
    return this;
  }

  ldr(rt: number, rn: number, offset = 0): this {
    this.emit(0x6800 | ((offset >> 2) << 6) | (rn << 3) | rt);
    return this;
  }

  strb(rt: number, rn: number, offset = 0): this {
    this.emit(0x7000 | (offset << 6) | (rn << 3) | rt);
    return this;
  }

  b(label: string, cond: Cond | null = null): this {
    this.branches.push({ at: this.code.length, label, cond });
    this.emit(0);
    return this;
  }

  bkpt(code: number): this {
    this.emit(0xbe00 | code);
    return this;
  }

  wfi(): this {
    this.emit(0xbf30);
    return this;
  }

  wfe(): this {
    this.emit(0xbf20);
    return this;
  }

  cpsie(): this {
    this.emit(0xb662);
    return this;
  }

  bxLr(): this {
    this.emit(0x4770);
    return this;
  }

  /** The halfwords with every branch and literal resolved, for code that starts at `base`. */
  assemble(base: number): number[] {
    const out = [...this.code];
    for (const { at, label, cond } of this.branches) {
      const target = this.labels.get(label);
      if (target === undefined) throw new Error(`no label ${label}`);
      const offset = target - (at + 2);
      out[at] = cond === null ? 0xe000 | (offset & 0x7ff) : 0xd000 | (COND[cond] << 8) | (offset & 0xff);
    }
    if (this.literals.length > 0) {
      if (((base >> 1) + out.length) % 2 !== 0) out.push(ALIGN_NOP);
      for (const { at, value } of this.literals) {
        const slot = out.length;
        out.push(value & 0xffff, value >>> 16);
        const reach = ((base >> 1) + slot - (((base >> 1) + at + 2) & ~1)) / 2;
        if (reach > 255) throw new Error("a literal is out of reach");
        out[at] |= reach;
      }
    }
    return out;
  }
}

function image(main: Asm, handlers: Record<number, Asm> = {}): Uint8Array {
  const parts: { name: string; asm: Asm }[] = [{ name: "reset", asm: main }, ...Object.entries(handlers).map(([irq, asm]) => ({ name: `irq${irq}`, asm }))];
  const halves: number[] = [];
  const entry: Record<string, number> = {};
  for (const { name, asm } of parts) {
    if (halves.length % 2 !== 0) halves.push(ALIGN_NOP);
    entry[name] = CODE_BASE + halves.length * 2;
    halves.push(...asm.assemble(CODE_BASE + halves.length * 2));
  }
  const hang = CODE_BASE + halves.length * 2;
  halves.push(0xe7fe);
  const bytes = new Uint8Array(VECTOR_COUNT * 4 + halves.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, STACK_TOP, true);
  for (let vector = 1; vector < VECTOR_COUNT; vector++) view.setUint32(vector * 4, hang | 1, true);
  view.setUint32(4, entry.reset | 1, true);
  for (const irq of Object.keys(handlers)) view.setUint32((16 + Number(irq)) * 4, entry[`irq${irq}`] | 1, true);
  halves.forEach((half, i) => view.setUint16(VECTOR_COUNT * 4 + i * 2, half, true));
  return buildUf2([{ address: VECTORS, data: bytes }]);
}

const FUNCSEL_SIO = 5;
const FUNCSEL_PWM = 4;
const SIO_OUT_SET = 0x14;
const SIO_OUT_CLR = 0x18;
const SIO_OUT_XOR = 0x1c;
const SIO_OE_SET = 0x24;
const TIMER_RAWL = 0x28;

/** GP15 and GP25 on the SIO function, as outputs. Leaves the SIO base in r0 and the pin mask in r1. */
function pinsToOutputs(a: Asm, ...pins: number[]): void {
  a.imm(0, SIO).imm(1, pins.reduce((mask, pin) => mask | (1 << pin), 0)).movs(3, FUNCSEL_SIO);
  for (const pin of pins) a.imm(2, IO_BANK0 + pin * 8 + 4).str(3, 2);
  a.str(1, 0, SIO_OE_SET);
}

/** Waits `us` microseconds by reading the timer in a loop, as a program that calls busy_wait_us does. Clobbers r4 to r7. */
function busyWait(a: Asm, id: string, us: number): void {
  a.imm(4, TIMER + TIMER_RAWL).imm(7, us).ldr(5, 4).label(`wait${id}`).ldr(6, 4).subsReg(6, 6, 5).cmp(6, 7).b(`wait${id}`, "cc");
}

/** Writes the decimal digits of r`reg` to UART0 (base in r1) by repeated subtraction, one digit per divisor. Clobbers r3 to r5. */
function printDecimal(a: Asm, id: string, reg: number, divisors: number[]): void {
  divisors.forEach((divisor, i) => {
    a.movs(4, 0).imm(5, divisor).label(`digit${id}${i}`).cmp(reg, 5).b(`done${id}${i}`, "cc").subsReg(reg, reg, 5).adds(4, 1).b(`digit${id}${i}`);
    a.label(`done${id}${i}`).adds(4, 0x30).str(4, 1);
  });
}

/** Toggles GP15 and GP25 every `halfPeriodUs`, waiting in a timer-polling loop. */
export function blinkPoll(halfPeriodUs: number): Uint8Array {
  const a = new Asm();
  pinsToOutputs(a, 15, 25);
  a.label("loop").str(1, 0, SIO_OUT_XOR);
  busyWait(a, "", halfPeriodUs);
  a.b("loop");
  return image(a);
}

/** Toggles GP15 and GP25 from the TIMER alarm 0 interrupt every `halfPeriodUs`, sleeping with WFI between. */
export function blinkWfi(halfPeriodUs: number): Uint8Array {
  const a = new Asm();
  pinsToOutputs(a, 15, 25);
  a.imm(4, TIMER).movs(5, 1).str(5, 4, 0x38).imm(5, NVIC_ISER).movs(6, 1).str(6, 5).ldr(6, 4, TIMER_RAWL).imm(7, halfPeriodUs).addsReg(6, 6, 7).str(6, 4, 0x10);
  a.cpsie().label("sleep").wfi().b("sleep");
  const irq = new Asm();
  irq.imm(4, TIMER).movs(5, 1).str(5, 4, 0x34).imm(0, SIO).imm(1, (1 << 15) | (1 << 25)).str(1, 0, SIO_OUT_XOR);
  irq.ldr(6, 4, TIMER_RAWL).imm(7, halfPeriodUs).addsReg(6, 6, 7).str(6, 4, 0x10).bxLr();
  return image(a, { 0: irq });
}

/** The ADC value from which `adcUart` drives GP15 high: about 1.2 V. */
const ADC_ON = 1500;

/** Reads ADC0 every `periodUs`, prints "adc <value>" on UART0 and drives GP15 high while the value is 1500 or more. */
export function adcUart(periodUs: number): Uint8Array {
  const a = new Asm();
  pinsToOutputs(a, 15);
  a.imm(1, UART0).imm(2, 0x301).str(2, 1, 0x30).imm(0, ADC).movs(2, 1).str(2, 0);
  a.label("loop").movs(2, 5).str(2, 0);
  a.label("ready").ldr(2, 0).lsls(2, 2, 23).b("ready", "pl");
  a.ldr(3, 0, 4).mov(7, 3);
  for (const ch of "adc ") a.movs(2, ch.charCodeAt(0)).str(2, 1);
  printDecimal(a, "v", 3, [1000, 100, 10, 1]);
  a.movs(2, 10).str(2, 1);
  a.imm(6, SIO).imm(2, 1 << 15).imm(5, ADC_ON).cmp(7, 5).b("low", "cc").str(2, 6, SIO_OUT_SET).b("next");
  a.label("low").str(2, 6, SIO_OUT_CLR).label("next");
  busyWait(a, "x", periodUs);
  a.b("loop");
  return image(a);
}

/** GP14 on PWM slice 7, channel A: 25 percent duty with a count of 1000 and no divider, which is 125 kHz at 125 MHz. */
export function pwm25(): Uint8Array {
  const a = new Asm();
  a.imm(2, IO_BANK0 + 14 * 8 + 4).movs(3, FUNCSEL_PWM).str(3, 2);
  a.imm(0, PWM + 7 * 0x14).movs(1, 0x10).str(1, 0, 4).imm(1, 999).str(1, 0, 0x10).movs(1, 250).str(1, 0, 0xc).movs(1, 1).str(1, 0);
  a.label("sleep").wfi().b("sleep");
  return image(a);
}

/** Reads register 0x75 of the I2C device at 0x48 on GP4 and GP5 and prints "i2c <value>" on UART0. */
export function i2cRead(): Uint8Array {
  const a = new Asm();
  const funcselI2c = 3;
  a.imm(1, UART0).imm(2, 0x301).str(2, 1, 0x30);
  a.movs(3, funcselI2c).imm(2, IO_BANK0 + 4 * 8 + 4).str(3, 2).imm(2, IO_BANK0 + 5 * 8 + 4).str(3, 2);
  a.imm(0, I2C0).movs(2, 0x63).str(2, 0, 0).movs(2, 0x48).str(2, 0, 4).imm(2, 625).str(2, 0, 0x14).str(2, 0, 0x18).movs(2, 1).str(2, 0, 0x6c);
  a.movs(2, 0x75).str(2, 0, 0x10).imm(2, 0x700).str(2, 0, 0x10);
  a.label("rx").ldr(2, 0, 0x78).cmpImm(2, 0).b("rx", "eq");
  a.ldr(3, 0, 0x10).movs(2, 0xff).andsReg(3, 2);
  for (const ch of "i2c ") a.movs(2, ch.charCodeAt(0)).str(2, 1);
  printDecimal(a, "i", 3, [100, 10, 1]);
  a.movs(2, 10).str(2, 1);
  a.label("sleep").wfi().b("sleep");
  return image(a);
}

/** Executes BKPT #0, which is what a failed assert or a panic does. */
export function breakpoint(): Uint8Array {
  const a = new Asm();
  a.bkpt(0);
  return image(a);
}

/** Sends "hi" on UART0 and stops. */
export function sayHi(): Uint8Array {
  const a = new Asm();
  a.imm(1, UART0).imm(2, 0x301).str(2, 1, 0x30);
  for (const ch of "hi\n") a.movs(2, ch.charCodeAt(0)).str(2, 1);
  a.label("sleep").wfi().b("sleep");
  return image(a);
}

/** The fixture files, by name; scripts/gen-rp2040-fixtures.mjs writes them to src/sim/mcu/rp2040/fixtures. */
export function fixtures(): Record<string, Uint8Array> {
  return {
    "blink-poll.uf2": blinkPoll(250_000),
    "blink-wfi.uf2": blinkWfi(250_000),
    "adc-uart.uf2": adcUart(10_000),
    "pwm.uf2": pwm25(),
    "i2c-read.uf2": i2cRead(),
    "breakpoint.uf2": breakpoint(),
    "say-hi.uf2": sayHi(),
  };
}
