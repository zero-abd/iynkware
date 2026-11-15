/** The data tab's channels (src/lab/data/channels.ts) over a real physics lab. */
import { describe, expect, it } from 'vitest';
import { createLabContext } from '../../src/lab/context';
import { boundsOf, channelsOf, defaultY, TIME, valueOf } from '../../src/lab/data/channels';
import { DATA_TEXT } from '../../src/lab/data';
import { l6Problems } from '../../src/lab/text';

describe('data channels', () => {
  it('lists time and the pendulum’s numbers, defaults Y to its angle, and reads them as it swings', () => {
    const lab = createLabContext(() => 'en');
    lab.open('physics');
    const s = lab.store;
    const list = channelsOf(s.items(), (id) => s.report(id), 'en', 'Time (s)');
    expect(list[0]).toEqual({ id: TIME, label: 'Time (s)' });
    const labels = list.map((c) => c.label).join(' | ');
    expect(labels).toMatch(/angle \(°\)/);
    expect(labels).toMatch(/period \(s\)/);
    expect(labels).toMatch(/length \(mm\)/);
    const y = defaultY(list);
    expect(y).toMatch(/:angleDeg$/);
    const id = s.byKind('pendulum-stand')!.id;
    s.apply(id, { type: 'swing' });
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      s.step(50);
      seen.add(valueOf(y, s.now, (x) => s.get(x), (x) => s.report(x))!);
    }
    expect(seen.size).toBeGreaterThan(10);
    expect(valueOf(TIME, 2000, () => undefined, () => null)).toBe(2);
  });

  it('bounds never collapse, and the strings are in six languages', () => {
    expect(boundsOf([])).toEqual([0, 1]);
    const [a, b] = boundsOf([3, 3]);
    expect(b - a).toBeGreaterThan(1);
    expect(l6Problems(DATA_TEXT)).toEqual([]);
  });
});
