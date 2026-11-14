/** ProjectStore.as(author): the co-builder's ops on its own undo stack, attributed `ai`. */
import { describe, expect, it } from 'vitest';
import type { CoAuthor } from '../src/contracts/assistant';
import type { DocChange, Op } from '../src/contracts/project';
import { createProjectStore, createTemplateSource } from '../src/project/store';

const ai: CoAuthor = { actor: 'usr_cobuilder', kind: 'ai', model: 'test-model' };

async function setup() {
  const doc = await createTemplateSource().load('prj_drone-quad5');
  const store = createProjectStore(doc);
  const [p1, p2] = doc.parameters;
  const set = (p: typeof p1, value: string): Op => ({ k: 'param.set', parameter: { ...p!, value } }) as Op;
  const valueOf = (id: string) => store.doc.parameters.find((p) => p.id === id)!.value;
  return { store, doc, p1: p1!, p2: p2!, set, valueOf };
}

describe('ProjectStore.as', () => {
  it('keeps the co-builder op when the person undoes, and the reverse', async () => {
    const { store, p1, p2, set, valueOf } = await setup();
    const ch = store.as(ai);
    store.apply(set(p1, 'person'), { label: 'person' });
    expect(ch.apply(set(p2, 'robot'), { label: 'robot' }).ok).toBe(true);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(valueOf(p1.id)).toBe(p1.value);
    expect(valueOf(p2.id)).toBe('robot');
    expect(store.canUndo()).toBe(false);
    expect(ch.canUndo()).toBe(true);
    ch.undo();
    expect(valueOf(p2.id)).toBe(p2.value);
    expect(ch.canUndo()).toBe(false);
  });

  it('undoes only its own entry, even when the person acted last', async () => {
    const { store, p1, p2, set, valueOf } = await setup();
    const ch = store.as(ai);
    ch.apply(set(p2, 'robot'));
    store.apply(set(p1, 'person'));
    expect(ch.undo()?.ok).toBe(true);
    expect(valueOf(p1.id)).toBe('person');
    expect(valueOf(p2.id)).toBe(p2.value);
    expect(store.canUndo()).toBe(true);
  });

  it('emits changes with origin ai, and the person stays local', async () => {
    const { store, p2, set } = await setup();
    const seen: DocChange[] = [];
    store.subscribe((c) => seen.push(c));
    store.as(ai).apply(set(p2, 'x'), { label: 'x', proposal: 'prp_1' });
    expect(seen.at(-1)?.origin).toBe('ai');
    store.apply(set(p2, 'y'));
    expect(seen.at(-1)?.origin).toBe('local');
  });

  it('forgets every stack on open and follows the new session', async () => {
    const { store, doc, p1, p2, set } = await setup();
    const ch = store.as(ai);
    ch.apply(set(p2, 'robot'));
    store.apply(set(p1, 'person'));
    store.open(doc);
    expect(ch.canUndo()).toBe(false);
    expect(store.canUndo()).toBe(false);
    ch.apply(set(p2, 'again'));
    expect(ch.canUndo()).toBe(true);
  });
});
