/**
 * Compiled firmware on the emulated chips, through the bridge over the real handler (inline, fake wall clock): iynk's
 * Pico blink UF2 toggles GP15 and an Uno hex toggles D13. The UF2 is iynk's own fixture; the hex is built here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import type { Project } from '@/project/generated/types';
import pico from '@/studio/starters/pico.project.json';
import { validateValue } from '@/project/validate';
import type { ProgramImage } from '../src/contracts/sim';
import { createSimBridge, inlinePort } from '../src/sim/bridge';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function rig(pin: 'GP15' | 'D13') {
  const tasks: Array<() => void> = [];
  const clock = { wall: 0 };
  const bridge = createSimBridge({ port: inlinePort({ wallMs: () => clock.wall, schedule: (fn) => void tasks.push(fn) }) });
  const levels: number[] = [];
  bridge.onFrame((f) => {
    const level = f.pins[pin];
    if (typeof level === 'number' && level !== levels.at(-1)) levels.push(level);
  });
  const tick = async (ms: number) => {
    clock.wall += ms;
    for (const task of tasks.splice(0)) task();
    await settle();
  };
  return { bridge, tick, levels };
}

/** An Intel hex of 16-bit words at address 0. */
function hexOf(words: number[]): string {
  const bytes = words.flatMap((w) => [w & 0xff, w >> 8]);
  const record = (type: number, data: number[]) => {
    const body = [data.length, 0, 0, type, ...data];
    const sum = (256 - (body.reduce((a, b) => a + b, 0) % 256)) % 256;
    return ':' + [...body, sum].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  return [record(0, bytes), record(1, [])].join('\n');
}

/** Sets DDRB.5, then toggles PINB.5 (D13) about every 16 ms: a 16-bit countdown of four cycles a step, at 16 MHz. */
const TOGGLE = [
  0xe200, // ldi r16, 0x20
  0xb904, // out DDRB, r16
  0xb903, // loop: out PINB, r16
  0x5081, // wait: subi r24, 1
  0x4090, // sbci r25, 0
  0xf7e9, // brne wait
  0xcffa, // rjmp loop
];

/** Paces the run until the pin has shown both levels (a frame is one in a thirtieth of a simulated second). */
async function toggled(r: { tick: (ms: number) => Promise<void>; levels: number[] }) {
  for (let i = 0; i < 60 && new Set(r.levels).size < 2; i++) await r.tick(100);
}

describe('compiled firmware in the headset worker', () => {
  let uno: Project;
  beforeAll(async () => {
    const report = validateValue(await loadTemplate('prj_uno-r3-blink'));
    if (!report.ok || !report.doc) throw new Error('the Blink template did not load');
    uno = report.doc;
  });

  it('runs a Pico UF2 blink: GP15 toggles', async () => {
    const r = rig('GP15');
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), '../src/sim/mcu/rp2040/fixtures/blink-poll.uf2')));
    const loaded = await r.bridge.load(pico as unknown as Project, { program: { kind: 'uf2', bytes } });
    expect(loaded.ok).toBe(true);
    await r.bridge.run();
    await toggled(r);
    expect(new Set(r.levels)).toEqual(new Set([0, 1]));
    await r.bridge.dispose();
  });

  it('runs an Uno hex: D13 toggles', async () => {
    const r = rig('D13');
    const program: ProgramImage = { kind: 'hex', hex: hexOf(TOGGLE) };
    const loaded = await r.bridge.load(uno, { program });
    expect(loaded.ok).toBe(true);
    await r.bridge.run();
    await toggled(r);
    expect(new Set(r.levels)).toEqual(new Set([0, 1]));
    await r.bridge.dispose();
  });

  it('refuses a hex on a Pico board with a message, without a crash', async () => {
    const r = rig('GP15');
    const program: ProgramImage = { kind: 'hex', hex: hexOf(TOGGLE) };
    await expect(r.bridge.load(pico as unknown as Project, { program })).rejects.toThrow(/AVR engine/);
    await r.bridge.dispose();
  });
});
