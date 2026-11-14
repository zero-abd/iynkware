/** Step targets: the anchors a step names, from its English text and the document, on real lessons. */
import { builtinRegistry } from '@/parts/builtin';
import { describe, expect, it } from 'vitest';
import type { Project } from '../../src/contracts/project';
import { loadTemplate } from '../../src/learn/content';
import { stepTargets } from '../../src/learn/session';

const parts = builtinRegistry();
const describePart = (ref: string, version?: string) => (version ? parts.get(ref, version) : parts.latest(ref));
const load = async (id: string) => (await loadTemplate(id)) as Project;
/** Each step's targets as short strings: `pin:<part>/<pin>[label]` or `part:<part>[label]`. */
const short = (doc: Project) =>
  (doc.guide?.steps ?? []).map((t) =>
    stepTargets(doc, typeof t === 'string' ? t : (t.en ?? ''), describePart).map((h) => {
      const t2 = h.target;
      const where = t2.kind === 'pin' ? `pin:${t2.part}/${t2.pin}` : t2.kind === 'part' ? `part:${t2.part}` : JSON.stringify(t2);
      return h.label === undefined ? where : `${where}[${h.label}]`;
    }),
  );

describe('step targets', () => {
  it('lights what every Uno Blink step names', async () => {
    const steps = short(await load('prj_uno-r3-blink'));
    expect(steps).toHaveLength(4);
    for (const s of steps) expect(s.length).toBeGreaterThan(0);
    // "Follow the wire from D13 into the breadboard: it reaches the resistor, then the LED's long leg."
    expect(steps[0]).toEqual(['pin:brd_main/D13[D13]', 'part:cmp_led1', 'part:cmp_res1', 'part:cmp_bb', 'pin:cmp_led1/A[+]']);
    // "Press Run. The breadboard LED and L blink together ..."
    expect(steps[1]).toEqual(['part:cmp_led1', 'part:cmp_bb']);
    // "Change On for and Off for, and run again ...": the LED to watch.
    expect(steps[2]).toEqual(['part:cmp_led1']);
    // "Pick 10 kΩ: the LED is barely lit ..."
    expect(steps[3]).toEqual(['part:cmp_led1', 'part:cmp_res1']);
  });

  it('lights the pins and parts of the Uno button lesson', async () => {
    const doc = await load('prj_uno-r3-button');
    const steps = short(doc);
    for (const s of steps) expect(s.length).toBeGreaterThan(0);
    // "Follow 5V to one side of the button and D2 to the other. The 10 kΩ resistor ties D2 to GND."
    expect(steps[0]).toEqual(['pin:brd_main/D2[D2]', 'pin:brd_main/GND[GND]', 'pin:brd_main/P5V[5V]', 'part:cmp_res1', 'part:cmp_res2', 'part:cmp_btn1']);
  });

  it('lights the ESP32 blink lesson by GPIO name and EN, never by a bare header number', async () => {
    const steps = short(await load('prj_esp32-devkitc-blink'));
    // "Wire GPIO23 to the resistor, the resistor to the LED's long leg (anode), and the short leg (cathode) to GND."
    expect(steps[0]).toEqual(['pin:brd_main/GND[GND]', 'pin:brd_main/GPIO23[GPIO23]', 'part:cmp_led1', 'part:cmp_r1', 'pin:cmp_led1/A[+]', 'pin:cmp_led1/K[−]']);
    // "Set the on and off times with the chips in the code." names nothing on the bench.
    expect(steps[1]).toEqual([]);
    expect(steps[2]).toEqual(['part:cmp_led1']);
    expect(steps[3]).toEqual(['pin:brd_main/EN[EN]']);
  });

  it('labels the LED legs and reads a refdes', async () => {
    const doc = await load('prj_uno-r3-blink');
    const t = stepTargets(doc, 'Put the short leg (cathode) of LED1 to GND, and pin 13 to RES1.', describePart);
    expect(t.map((h) => [h.target, h.label])).toEqual([
      [{ kind: 'pin', part: 'brd_main', pin: 'GND' }, 'GND'],
      [{ kind: 'pin', part: 'brd_main', pin: 'D13' }, 'D13'],
      [{ kind: 'part', part: 'cmp_led1' }, 'LED1'],
      [{ kind: 'part', part: 'cmp_res1' }, 'RES1'],
      [{ kind: 'pin', part: 'cmp_led1', pin: 'K' }, '−'],
    ]);
    expect(stepTargets(doc, 'Read the lede and think about it.', describePart)).toEqual([]);
  });
});
