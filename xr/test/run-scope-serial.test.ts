/** Run tools, scope and serial (xr/src/run/tools): the trace buffer, divisions and projection, the line buffer, the keypad, the key grid. */
import { describe, expect, it } from 'vitest';
import { stringProblems } from '../src/run/kit/strings';
import { cellAt, faceXY, layoutCells } from '../src/run/tools/grid';
import {
  columnsOf,
  createSweep,
  createTraceBuffer,
  DEFAULT_TIME_STEP,
  DEFAULT_VOLT_STEP,
  DIVS_Y,
  project,
  rowOf,
  stepBy,
  TIME_STEPS,
  timeText,
  VOLT_STEPS,
  voltsText,
} from '../src/run/tools/scope/trace';
import { scopeStrings } from '../src/run/tools/scope/strings';
import { applyKey, createLineBuffer, KEYS, MAX_DRAFT, visible, wrapLine } from '../src/run/tools/serial/lines';
import { serialStrings } from '../src/run/tools/serial/strings';

const MS = 1e6;

describe('the trace buffer', () => {
  it('keeps samples in time order on their grid', () => {
    const t = createTraceBuffer(16);
    t.push(0, 100 * MS, [0, 0, 5, 5], false);
    expect(t.length).toBe(4);
    expect(t.timeAt(2)).toBe(200 * MS);
    expect(t.valueAt(2)).toBe(5);
    expect(t.lastNs).toBe(300 * MS);
    t.push(400 * MS, 100 * MS, [0], false);
    expect(t.length).toBe(5);
    expect(t.valueAt(4)).toBe(0);
  });

  it('drops the oldest past its capacity', () => {
    const t = createTraceBuffer(4);
    t.push(0, MS, [1, 2, 3, 4, 5, 6], false);
    expect(t.length).toBe(4);
    expect(t.valueAt(0)).toBe(3);
    expect(t.valueAt(3)).toBe(6);
    expect(t.timeAt(0)).toBe(2 * MS);
  });

  it('is replaced by a full frame, and by a grid that starts before its newest sample (a new run)', () => {
    const t = createTraceBuffer(16);
    t.push(0, MS, [1, 2, 3], false);
    t.push(0, MS, [9], true);
    expect(t.length).toBe(1);
    expect(t.valueAt(0)).toBe(9);
    t.push(10 * MS, MS, [1, 2, 3], false);
    t.push(0, MS, [7, 8], false);
    expect(t.length).toBe(2);
    expect(t.valueAt(1)).toBe(8);
  });

  it('finds the first sample at or after a time', () => {
    const t = createTraceBuffer(8);
    t.push(0, 10, [0, 1, 2, 3, 4], false);
    expect(t.firstAtOrAfter(-5)).toBe(0);
    expect(t.firstAtOrAfter(20)).toBe(2);
    expect(t.firstAtOrAfter(21)).toBe(3);
    expect(t.firstAtOrAfter(1000)).toBe(5);
  });
});

describe('projecting a window onto columns', () => {
  const square = () => {
    const t = createTraceBuffer(64);
    // 0 V for 400 ms, 5 V for 400 ms, 0 V again, one sample per 100 ms.
    t.push(0, 100 * MS, [0, 0, 0, 0, 5, 5, 5, 5, 0, 0], false);
    return t;
  };

  it('shows the lowest and highest value held in each column, so an edge is a vertical span', () => {
    const out = columnsOf(10);
    project(square(), 1000 * MS, 1000 * MS, out);
    expect(Array.from(out.has)).toEqual(Array(10).fill(1));
    expect(Array.from(out.hi).slice(0, 4)).toEqual([0, 0, 0, 0]);
    // The column that holds the rise has both values.
    expect(out.lo[4]).toBe(0);
    expect(out.hi[4]).toBe(5);
    expect(out.hi[6]).toBe(5);
    expect(out.lo[6]).toBe(5);
    expect(out.last[9]).toBe(0);
  });

  it('is empty before the first sample and holds the last value to the end of the window', () => {
    const t = createTraceBuffer(8);
    t.push(500 * MS, 100 * MS, [3, 4], false);
    const out = columnsOf(10);
    project(t, 1000 * MS, 1000 * MS, out);
    expect(Array.from(out.has)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
    expect(out.last[9]).toBe(4);
    expect(out.lo[9]).toBe(4);
    expect(out.hi[9]).toBe(4);
  });

  it('shows a window of part of the trace, taking the held value at its start', () => {
    const out = columnsOf(4);
    project(square(), 700 * MS, 400 * MS, out);
    // 300 ms to 700 ms: 0 V at 300 ms (held from 0), then 5 V from 400 ms.
    expect(out.first[0]).toBe(0);
    expect(out.hi[1]).toBe(5);
    expect(out.lo[3]).toBe(5);
    expect(out.last[3]).toBe(5);
  });

  it('has nothing for an empty trace', () => {
    const out = columnsOf(5);
    project(createTraceBuffer(4), 100, 100, out);
    expect(Array.from(out.has)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('the divisions', () => {
  it('step by one and stop at the ends', () => {
    expect(stepBy(TIME_STEPS, 0, -1)).toBe(0);
    expect(stepBy(TIME_STEPS, TIME_STEPS.length - 1, 1)).toBe(TIME_STEPS.length - 1);
    expect(stepBy(VOLT_STEPS, 3, 1)).toBe(4);
    expect(TIME_STEPS[DEFAULT_TIME_STEP]).toBe(100);
    expect(VOLT_STEPS[DEFAULT_VOLT_STEP]).toBe(1);
    expect([...TIME_STEPS].sort((a, b) => a - b)).toEqual([...TIME_STEPS]);
    expect([...VOLT_STEPS].sort((a, b) => a - b)).toEqual([...VOLT_STEPS]);
  });

  it('are written with their unit and the language mark', () => {
    expect(timeText(100, 'en')).toBe('100 ms');
    expect(timeText(1000, 'en')).toBe('1 s');
    expect(timeText(0.5, 'en')).toBe('500 µs');
    expect(voltsText(1, 'en')).toBe('1 V');
    expect(voltsText(0.5, 'en')).toBe('500 mV');
    expect(voltsText(0.1, 'en')).toBe('100 mV');
    expect(voltsText(2, 'de')).toBe('2 V');
  });

  it('put zero one division above the bottom, so 0 to 5 V shows whole at 1 V per division', () => {
    expect(rowOf(0, 1)).toBeCloseTo(1 - 1 / DIVS_Y);
    expect(rowOf(5, 1)).toBeGreaterThan(0);
    expect(rowOf(5, 1)).toBeLessThan(rowOf(0, 1));
    expect(rowOf(5, 0.5)).toBeLessThan(0);
  });

  it('freeze one sweep and follow again', () => {
    const s = createSweep();
    expect(s.endNs(500)).toBe(500);
    expect(s.toggle(500)).toBe(true);
    expect(s.endNs(900)).toBe(500);
    expect(s.frozen).toBe(true);
    expect(s.toggle(900)).toBe(false);
    expect(s.endNs(900)).toBe(900);
    s.toggle(10);
    s.reset();
    expect(s.frozen).toBe(false);
  });
});

describe('the serial line buffer', () => {
  it('joins pieces into lines and keeps the open one', () => {
    const b = createLineBuffer(40, 100);
    b.push('Hel');
    expect(b.lines()).toEqual(['Hel']);
    b.push('lo\nWor');
    expect(b.lines()).toEqual(['Hello', 'Wor']);
    b.push('ld\n');
    expect(b.lines()).toEqual(['Hello', 'World']);
    b.push('');
    expect(b.lines()).toEqual(['Hello', 'World']);
  });

  it('handles CRLF, a lone CR and blank lines', () => {
    const b = createLineBuffer(40, 100);
    b.push('a\r\nb\rc\n\nd');
    expect(b.lines()).toEqual(['a', 'bc', '', 'd']);
  });

  it('wraps long lines to the columns', () => {
    expect(wrapLine('abcdef', 4)).toEqual(['abcd', 'ef']);
    expect(wrapLine('', 4)).toEqual(['']);
    const b = createLineBuffer(5, 100);
    b.push('0123456789\n');
    expect(b.lines()).toEqual(['01234', '56789']);
  });

  it('keeps only the last lines and counts what it dropped', () => {
    const b = createLineBuffer(40, 10);
    for (let i = 0; i < 50; i++) b.push(`line ${i}\n`);
    expect(b.lines().length).toBeLessThanOrEqual(10);
    expect(b.lines().at(-1)).toBe('line 49');
    expect(b.dropped).toBeGreaterThan(0);
  });

  it('counts its changes and clears', () => {
    const b = createLineBuffer();
    const v = b.version;
    b.push('x');
    expect(b.version).toBeGreaterThan(v);
    b.clear();
    expect(b.lines()).toEqual([]);
  });

  it('shows a page ending at the newest, or scrolled back and clamped', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `l${i}`);
    expect(visible(lines, 14, 0).rows).toEqual(lines.slice(16));
    expect(visible(lines, 14, 4).rows).toEqual(lines.slice(12, 26));
    expect(visible(lines, 14, 999)).toEqual({ rows: lines.slice(0, 14), back: 16 });
    expect(visible(lines, 14, -3).back).toBe(0);
    expect(visible(['a', 'b'], 14, 5)).toEqual({ rows: ['a', 'b'], back: 0 });
  });
});

describe('the keypad', () => {
  it('builds a draft, deletes, and sends it with a newline', () => {
    let draft = '';
    for (const k of ['1', '2', '.', '5'] as const) draft = applyKey(draft, k).draft;
    expect(draft).toBe('12.5');
    draft = applyKey(draft, 'back').draft;
    expect(draft).toBe('12.');
    draft = applyKey(draft, ' ').draft;
    draft = applyKey(draft, '-').draft;
    expect(draft).toBe('12. -');
    const sent = applyKey(draft, 'send');
    expect(sent).toEqual({ draft: '', send: '12. -\n' });
    expect(applyKey('', 'send').send).toBe('\n');
    expect(applyKey('', 'back').draft).toBe('');
  });

  it('stops growing at the draft limit and has every key once', () => {
    let draft = '';
    for (let i = 0; i < MAX_DRAFT + 5; i++) draft = applyKey(draft, '7').draft;
    expect(draft.length).toBe(MAX_DRAFT);
    expect(new Set(KEYS).size).toBe(KEYS.length);
    for (const d of '0123456789') expect(KEYS).toContain(d);
  });
});

describe('a strip of keys', () => {
  const rows = [
    [['a', 1], ['b', 2], ['', 1], ['c', 1]],
    [['d', 1]],
  ] as const;
  const cells = layoutCells(1, 0.5, rows, 0.1);

  it('shares a row by weight with gaps, skipping blanks', () => {
    expect(cells.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    const [a, b, c, d] = cells;
    // 1 - 3 gaps of 0.1 = 0.7 over weight 5.
    expect(a!.w).toBeCloseTo(0.14);
    expect(b!.w).toBeCloseTo(0.28);
    expect(b!.x).toBeCloseTo(0.24);
    expect(c!.x).toBeCloseTo(0.86);
    expect(d!.w).toBeCloseTo(1);
    expect(d!.y).toBeCloseTo(0.3);
    expect(a!.h).toBeCloseTo(0.2);
  });

  it('finds the key under a point, and none between keys', () => {
    expect(cellAt(cells, 0.05, 0.1)?.id).toBe('a');
    expect(cellAt(cells, 0.3, 0.1)?.id).toBe('b');
    expect(cellAt(cells, 0.15, 0.1)).toBeNull();
    expect(cellAt(cells, 0.5, 0.4)?.id).toBe('d');
    expect(cellAt(cells, 0.5, 0.25)).toBeNull();
  });

  it('turns a plane-local point into the face frame, y down', () => {
    expect(faceXY(0, 0, 1, 0.5)).toEqual({ x: 0.5, y: 0.25 });
    expect(faceXY(-0.5, 0.25, 1, 0.5)).toEqual({ x: 0, y: 0 });
  });
});

describe('the words', () => {
  it('are in six languages with the same placeholders', () => {
    expect(stringProblems(scopeStrings.table)).toEqual([]);
    expect(stringProblems(serialStrings.table)).toEqual([]);
  });
});
