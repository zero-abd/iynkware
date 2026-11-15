import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chipOps, codeView, renderStarter, stepValues } from '../../src/learn/code';
import { tokenize } from '../../src/learn/code/tokens';
import type { Project } from '../../src/contracts/project';
import { createProjectStore, createTemplateSource } from '../../src/project/store';

const load = async () => (await createTemplateSource().load('prj_uno-r3-blink'))!;
const sourceOf = (doc: Project) => doc.sources.find((s) => s.id === doc.guide!.starter!.source)!.content;
const valueOf = (doc: Project, id: string) => doc.parameters.find((p) => p.id === id)!.value;
const lineText = (v: NonNullable<ReturnType<typeof codeView>>, n: number) => v.lines.find((l) => l.n === n)!.spans.map((s) => s.text).join('');

describe('codeView', () => {
  it('shows Blink with chip spans at the delays', async () => {
    const v = codeView(await load())!;
    expect(v.sourceId).toBe('src_sketch');
    expect(v.language).toBe('arduino-cpp');
    expect(v.lines.map((l) => l.n)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(lineText(v, 9)).toBe('  delay(500);  // how long it stays on');
    const chips = v.lines.flatMap((l) => l.spans.filter((s) => s.kind === 'chip').map((s) => ({ n: l.n, text: s.text, chip: s.chip })));
    expect(chips).toEqual([
      { n: 9, text: '500', chip: 'par_on' },
      { n: 11, text: '500', chip: 'par_off' },
    ]);
    const kinds = Object.fromEntries(v.lines[8]!.spans.map((s) => [s.text.trim(), s.kind]));
    expect(kinds['delay']).toBe('function');
    expect(kinds['// how long it stays on']).toBe('comment');
  });

  it('has a chip for each parameter with options, values and the delay unit', async () => {
    const v = codeView(await load())!;
    expect(v.chips.map((c) => c.param).sort()).toEqual(['par_color', 'par_off', 'par_on', 'par_resistor']);
    const on = v.chips.find((c) => c.param === 'par_on')!;
    expect(on).toMatchObject({ name: 'on', kind: 'number', value: 500, unit: 'ms', inCode: true });
    expect(on.options.map((o) => o.value)).toEqual([100, 250, 500, 1000, 2000]);
    expect(on.label.en).toBe('On for');
    const color = v.chips.find((c) => c.param === 'par_color')!;
    expect(color).toMatchObject({ kind: 'choice', value: 'red', inCode: false });
    expect(color.options.map((o) => o.value)).toEqual(['red', 'yellow', 'green', 'blue', 'white']);
    expect(v.chips.find((c) => c.param === 'par_resistor')!.options.map((o) => o.value)).toEqual([220, 1000, 10000]);
  });

  it('adds a value outside the steps and keeps within the range', () => {
    const p = { id: 'p', name: 'p', kind: 'number', value: 150, min: 50, max: 1000, step: 50 } as never;
    expect(stepValues(p)).toEqual([100, 150, 250, 500, 1000]);
  });

  it('drops the slots when the source was edited elsewhere', async () => {
    const doc = await load();
    const store = createProjectStore(doc);
    const id = doc.guide!.starter!.source;
    expect(store.apply({ k: 'source.edit', id, baseSeq: store.doc.revision, pos: 0, del: 0, ins: '// mine\n' }).ok).toBe(true);
    const v = codeView(store.doc)!;
    expect(v.lines.some((l) => l.spans.some((s) => s.kind === 'chip'))).toBe(false);
    expect(v.chips.every((c) => !c.inCode)).toBe(true);
    // The chips still change the circuit parameters, and leave the code alone.
    const ops = chipOps(store.doc, 'par_on', 100);
    expect(ops.map((o) => o.k)).toEqual(['param.set']);
  });

  it('is null without a starter', async () => {
    const doc = await load();
    expect(codeView({ ...doc, guide: { ...doc.guide!, starter: undefined } } as Project)).toBeNull();
  });
});

describe('chipOps', () => {
  it('changes the source and the parameter in one undo, and finds the slot again', async () => {
    const store = createProjectStore(await load());
    const ops = chipOps(store.doc, 'par_on', 100);
    expect(ops.map((o) => o.k)).toEqual(['source.edit', 'param.set']);
    expect(store.apply(ops, { label: 'chip' }).ok).toBe(true);
    expect(sourceOf(store.doc)).toContain('delay(100);  // how long it stays on');
    expect(sourceOf(store.doc)).toContain('delay(500);  // how long it stays off');
    expect(valueOf(store.doc, 'par_on')).toBe(100);

    expect(store.apply(chipOps(store.doc, 'par_on', 2000)).ok).toBe(true);
    expect(sourceOf(store.doc)).toContain('delay(2000);  // how long it stays on');
    expect(store.apply(chipOps(store.doc, 'par_off', 250)).ok).toBe(true);
    expect(sourceOf(store.doc)).toContain('delay(250);  // how long it stays off');
    expect(codeView(store.doc)!.chips.every((c) => c.kind === 'choice' || c.inCode)).toBe(true);

  });

  it('undoes a change of each slot (one undo each)', async () => {
    const store = createProjectStore(await load());
    store.apply(chipOps(store.doc, 'par_on', 100));
    store.apply(chipOps(store.doc, 'par_off', 250));
    store.undo();
    expect(sourceOf(store.doc)).toContain('delay(500);  // how long it stays off');
    expect(valueOf(store.doc, 'par_off')).toBe(500);
    store.undo();
    expect(sourceOf(store.doc)).toContain('delay(500);  // how long it stays on');
    expect(valueOf(store.doc, 'par_on')).toBe(500);
  });

  it('is empty for an unchanged value, an unknown chip or a value it does not offer', async () => {
    const doc = await load();
    expect(chipOps(doc, 'par_on', 500)).toEqual([]);
    expect(chipOps(doc, 'par_nope', 1)).toEqual([]);
    expect(chipOps(doc, 'par_color', 'purple')).toEqual([]);
  });

  it('clamps a number to its range and step', async () => {
    const doc = await load();
    expect(chipOps(doc, 'par_on', 99999)[1]).toMatchObject({ k: 'param.set', parameter: { value: 2000 } });
    expect(chipOps(doc, 'par_on', 120)[1]).toMatchObject({ parameter: { value: 100 } });
  });

  it('sets a choice that has no slot: the parameter only', async () => {
    const store = createProjectStore(await load());
    const ops = chipOps(store.doc, 'par_resistor', 1000);
    expect(ops.map((o) => o.k)).toEqual(['param.set']);
    expect(store.apply(ops).ok).toBe(true);
    expect(valueOf(store.doc, 'par_resistor')).toBe(1000);
    expect(store.apply(chipOps(store.doc, 'par_color', 'green')).ok).toBe(true);
  });
});

describe('tokenize', () => {
  it('colours C and Python', () => {
    const c = tokenize('int x = 5; // hi', 'arduino-cpp');
    expect([c[0], c[8], c[11]]).toEqual(['type', 'number', 'comment']);
    const py = tokenize('# hi\nprint("a")', 'micropython');
    expect([py[0], py[5], py[11]]).toEqual(['comment', 'function', 'string']);
  });
});

function templates(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? templates(p) : p.endsWith('.project.json') ? [p] : [];
  });
}

describe('every lesson template', () => {
  it('renders to its source and gets a view', () => {
    const root = join(__dirname, '../../../content/projects/boards');
    const bad: string[] = [];
    let n = 0;
    for (const file of templates(root)) {
      const doc = JSON.parse(readFileSync(file, 'utf8')) as Project;
      const starter = doc.guide?.starter;
      if (!starter) continue;
      n++;
      const source = doc.sources.find((s) => s.id === starter.source);
      const { code } = renderStarter(starter, doc.parameters, Object.fromEntries(doc.parameters.map((p) => [p.id, p.value])));
      if (code !== source?.content) bad.push(file);
      const v = codeView(doc);
      expect(v).not.toBeNull();
      if (code === source?.content) expect(v!.lines.map((l) => l.spans.map((s) => s.text).join('')).join('\n') + '\n').toBe(code.endsWith('\n') ? code : code + '\n');
    }
    expect(n).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
});
