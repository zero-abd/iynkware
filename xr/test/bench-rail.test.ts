/** The pure pieces of the rail (bench/rail): enabled state, ticker lines, the ticker sink, strings. */
import { describe, expect, it } from 'vitest';
import { parity } from '../src/bench/core/text';
import { createBenchFeedback } from '../src/bench/core/feedback';
import { RAIL_STRINGS } from '../src/bench/rail/strings';
import { railEnabled, tickerText, whatOf } from '../src/bench/rail/text';
import { createProjectStore, createTemplateSource } from '../src/project/store';
import { addWire } from '../src/bench/core/actions';

describe('enabled state', () => {
  it('follows canUndo and canRedo of a real store', async () => {
    const store = createProjectStore(await createTemplateSource().load('prj_uno-r3-blink'));
    expect(railEnabled(store.canUndo(), store.canRedo())).toEqual({ undo: false, redo: false });
    const r = addWire(store.doc, { from: { kind: 'hole', surface: 'cmp_bb', hole: 'e10' }, to: { kind: 'hole', surface: 'cmp_bb', hole: 'e15' } });
    if (!r.ok) throw new Error(r.reason);
    store.apply(r.ops, { label: r.label });
    expect(railEnabled(store.canUndo(), store.canRedo())).toEqual({ undo: true, redo: false });
    const u = store.undo();
    expect(u?.ok).toBe(true);
    expect(railEnabled(store.canUndo(), store.canRedo())).toEqual({ undo: false, redo: true });
  });
});

describe('ticker lines', () => {
  it('name what the undo touched, in the person\'s language', () => {
    expect(tickerText('en', 'undo', [{ k: 'wire.remove' }])).toBe('Undid: wire');
    expect(tickerText('en', 'redo', [{ k: 'wire.add' }])).toBe('Redid: wire');
    expect(tickerText('de', 'undo', [{ k: 'wire.set' }])).toBe('Rückgängig: Drahtfarbe');
    expect(tickerText('zh', 'redo', [{ k: 'board.set' }])).toBe('已重做：开发板');
  });
  it('pick the most specific thing', () => {
    expect(whatOf([{ k: 'net.create' }, { k: 'wire.add' }])).toBe('rail.what.wire');
    expect(whatOf([{ k: 'wire.route' }])).toBe('rail.what.wireBend');
    expect(whatOf([{ k: 'view.place' }])).toBe('rail.what.part');
    expect(whatOf([{ k: 'meta.set' }])).toBe('rail.what.change');
  });
});

describe('the ticker sink', () => {
  it('sends every line to the last registered sink and none after it is removed', () => {
    const fb = createBenchFeedback({ input: { pulse: () => undefined } } as never);
    const a: string[] = [];
    const b: string[] = [];
    const offA = fb.onTicker((t) => a.push(t));
    fb.ticker('one');
    const offB = fb.onTicker((t) => b.push(t));
    fb.ticker('two');
    offB();
    fb.ticker('three');
    offA();
    fb.ticker('four');
    expect(a).toEqual(['one', 'three']);
    expect(b).toEqual(['two']);
  });
});

describe('strings', () => {
  it('has every key in every language, with matching placeholders', () => {
    expect(parity(RAIL_STRINGS)).toEqual([]);
  });
});
