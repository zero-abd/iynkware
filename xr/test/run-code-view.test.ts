/**
 * The Code window's line mapper (#311): which sketches it follows, the line it marks from pin edges and time, and the
 * Blink template stepped 10 ms at a time on the inline sim, the highlight moving from `digitalWrite` to `delay` and on.
 */
import { describe, expect, it } from 'vitest';
import { loadTemplate, TEMPLATES } from '@content/projects';
import { validateValue } from '@/project/validate';
import type { Project } from '@/project/generated/types';
import { createTracker, pinKeyOf, planOf, stripComments, type CodePosition } from '../src/run/code-view/mapper';
import { sketchOf } from '../src/run/code-view/source';
import { codeStrings } from '../src/run/code-view/strings';
import { stringProblems } from '../src/run/kit/strings';
import { createSimBridge, inlinePort } from '../src/sim/bridge';

const BLINK = `const int LED_PIN = 13;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(500);  // how long it stays on
  digitalWrite(LED_PIN, LOW);
  delay(500);  // how long it stays off
}
`;

const MS = 1e6;

describe('planOf', () => {
  it('follows Blink: pin 13, the HIGH write and its delay, the LOW write and its delay', () => {
    const p = planOf(BLINK)!;
    expect(p).not.toBeNull();
    expect(p.pin).toBe('13');
    expect(p.initial).toBe(0);
    expect(p.firstEdgeMs).toBe(0);
    expect(p.segments[1]).toMatchObject({ write: 8, ms: 500 });
    expect(p.segments[0]).toMatchObject({ write: 10, ms: 500 });
    expect(p.segments[1].steps.map((s) => [s.line, s.kind])).toEqual([
      [8, 'write'],
      [9, 'delay'],
    ]);
  });

  it('resolves LED_BUILTIN only when the board says what it is, and named delays', () => {
    const nano = BLINK.replace('= 13', '= LED_BUILTIN');
    expect(planOf(nano)).toBeNull();
    expect(planOf(nano, { builtinLed: 13 })?.pin).toBe('13');
    const named = `#define WAIT_MS 250\nconst int LED = 7;\nvoid setup() {\n  Serial.begin(9600);\n}\nvoid loop() {\n  digitalWrite(LED, HIGH);\n  Serial.println("on");\n  delay(WAIT_MS);\n  digitalWrite(LED, LOW);\n  delay(WAIT_MS * 3);\n}\n`;
    expect(planOf(named)).toBeNull(); // `WAIT_MS * 3` is not resolved: no marker rather than a wrong one
    const p = planOf(named.replace('WAIT_MS * 3', '750'))!;
    expect(p.pin).toBe('7');
    expect(p.segments[1].steps.map((s) => s.kind)).toEqual(['write', 'instant', 'delay']);
    expect(p.segments[0].ms).toBe(750);
  });

  it('takes a loop that starts LOW, and a setup delay, from t = 0', () => {
    const p = planOf(`void setup() {\n  pinMode(4, OUTPUT);\n  delay(100);\n}\nvoid loop() {\n  digitalWrite(4, LOW);\n  delay(200);\n  digitalWrite(4, HIGH);\n  delay(300);\n}\n`)!;
    // LOW changes nothing: the first edge is the HIGH write, after setup's 100 ms and the LOW segment's 200 ms.
    expect(p.firstEdgeMs).toBe(300);
    expect(p.pre.filter((s) => s.kind === 'delay').map((s) => [s.line, s.fromMs])).toEqual([
      [3, 0],
      [7, 100],
    ]);
  });

  it('gives no plan where the line cannot be told from one pin', () => {
    const no = [
      BLINK.replace('delay(500);  // how long it stays on', 'delay(wait);'),
      BLINK.replace('digitalWrite(LED_PIN, LOW);', 'digitalWrite(LED_PIN, !digitalRead(LED_PIN));'),
      BLINK.replace('  delay(500);  // how long it stays off', '  if (x) delay(500);'),
      BLINK.replace(/delay\(500\)/g, 'delay(10)'),
      BLINK.replace('digitalWrite(LED_PIN, LOW);', 'digitalWrite(LED_PIN, HIGH);'),
      'void setup() {}\nvoid loop() {}\n',
      `void setup() {\n  pinMode(9, OUTPUT);\n}\nvoid loop() {\n  for (int i = 0; i < 255; i++) {\n    analogWrite(9, i);\n    delay(5);\n  }\n}\n`,
      'int main() { return 0; }',
    ];
    for (const src of no) expect(planOf(src), src).toBeNull();
  });

  it('blanks comments without moving lines', () => {
    const s = 'a(); // x\n/* one\ntwo */ b("//not");\n';
    const out = stripComments(s);
    expect(out.split('\n').length).toBe(s.split('\n').length);
    expect(out).toContain('b("//not");');
    expect(out).not.toMatch(/x|one|two/);
  });

  it('finds the frame key for a sketch pin', () => {
    expect(pinKeyOf('13', { D13: 0, D12: 1 })).toBe('D13');
    expect(pinKeyOf('23', { GPIO23: 0 })).toBe('GPIO23');
    expect(pinKeyOf('D1', { D1: 0 })).toBe('D1');
    expect(pinKeyOf('13', { A0: 0 })).toBeNull();
  });
});

describe('createTracker', () => {
  it('marks nothing at t = 0, the write when the pin changes, then the delay by time', () => {
    const t = createTracker(planOf(BLINK)!);
    expect(t.observe(0, 0).line).toBeNull();
    const first = t.observe(10 * MS, 1);
    expect(first).toMatchObject({ line: 8, wrote: { line: 8, level: 1 } });
    expect(first.delay).toEqual({ line: 9, elapsedMs: 10, ms: 500 });
    expect(t.observe(250 * MS, 1)).toEqual<CodePosition>({ line: 9, wrote: null, delay: { line: 9, elapsedMs: 250, ms: 500 } });
    // Under Step the change shows up a few ms late; the plan puts it at 500 ms.
    expect(t.observe(507 * MS, 0)).toMatchObject({ line: 10, wrote: { line: 10, level: 0 }, delay: { line: 11, elapsedMs: 7 } });
    expect(t.observe(800 * MS, 0)).toMatchObject({ line: 11, delay: { elapsedMs: 300 } });
    expect(t.observe(1000 * MS, 1)).toMatchObject({ line: 8, wrote: { level: 1 } });
  });

  it('starts again after a stop, and marks nothing for a floating pin', () => {
    const t = createTracker(planOf(BLINK)!);
    t.observe(600 * MS, 0);
    expect(t.observe(0, 'Z').line).toBeNull();
    expect(t.observe(20 * MS, 1)).toMatchObject({ line: 8, delay: { elapsedMs: 20 } });
  });
});

const load = async (id: string): Promise<Project> => {
  const r = validateValue(await loadTemplate(id));
  if (!r.ok || !r.doc) throw new Error(`${id} did not load`);
  return r.doc;
};

describe('the Blink template on the inline sim', () => {
  it('moves the marker with each Step: write HIGH, delay, write LOW, delay', async () => {
    const doc = await load('prj_uno-r3-blink');
    const sketch = sketchOf(doc)!;
    expect(sketch.path).toBe('sketch.ino');
    expect(sketch.plan).not.toBeNull();
    const plan = sketch.plan!;
    const track = createTracker(plan);
    const b = createSimBridge({ port: inlinePort({ wallMs: () => 0, schedule: () => undefined }) });
    let key: string | null = null;
    b.onFrame((f) => {
      key ??= pinKeyOf(plan.pin, f.pins);
      if (key) track.observe(f.atNs, f.pins[key]);
    });
    expect((await b.load(doc)).ok).toBe(true);
    const lines: (number | null)[] = [];
    for (let i = 0; i < 110; i++) {
      await b.step(10);
      lines.push(track.position.line);
    }
    await b.dispose();
    expect(key).toBe('D13');
    const at = (ms: number) => lines[ms / 10 - 1];
    expect(at(10)).toBe(8);
    expect(at(20)).toBe(9);
    expect(at(490)).toBe(9);
    expect(at(510)).toBe(10);
    expect(at(520)).toBe(11);
    expect(at(1010)).toBe(8);
    expect(track.position.delay?.line).toBe(9);
  });

  it('follows the Arduino Blink templates and leaves the rest unmarked', async () => {
    const followed: string[] = [];
    for (const entry of TEMPLATES) {
      const doc = await load(entry.id).catch(() => null);
      if (doc && sketchOf(doc)?.plan) followed.push(entry.id);
    }
    expect(followed).toEqual(expect.arrayContaining(['prj_uno-r3-blink', 'prj_nano-blink', 'prj_uno-r4-blink']));
    expect(followed).not.toContain('prj_uno-r3-button');
  });
});

describe('the Code window strings', () => {
  it('has every key in six languages, the same placeholders, no exclamation marks', () => {
    expect(stringProblems(codeStrings.table)).toEqual([]);
  });
});
