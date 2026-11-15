/** give_substance (src/agent/tools/chem.ts) and the stockroom lookup (src/lab/substances/data.ts). */
import { describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import { createAssistantService, instantPresence } from '../../src/assistant/service';
import { createProjectStore, createTemplateSource } from '../../src/project/store';
import { createLabContext } from '../../src/lab/context';
import { createCalloutList, createConversation } from '../../src/agent/bubbles/model';
import { createCoach } from '../../src/agent/coach/coach';
import { createBridge } from '../../src/agent/bridge/bridge';
import { intentOf, scriptedBrain } from '../../src/agent/bridge/scripted';
import { callTool, createTools, type CompanionMode, type ToolHost } from '../../src/agent/tools/catalog';
import { containerOf, findSubstance, SUBSTANCES } from '../../src/lab/substances/data';
import { substanceSpot } from '../../src/agent/tools/chem';
import { LAB_LAYOUTS } from '../../src/lab/experiments/list';

async function setup(mode: CompanionMode = 'build') {
  const project = createProjectStore(await loadTemplate('prj_uno-r3-blink'));
  const assistant = createAssistantService({ project, templates: createTemplateSource(), lang: () => 'en', presence: instantPresence });
  const lab = createLabContext(() => 'en');
  let m = mode;
  const conversation = createConversation();
  const coach = createCoach(() => 0);
  const host: ToolHost = { lang: () => 'en', assistant, project, guide: () => null, lab: () => lab, callouts: createCalloutList(() => 0), conversation, observations: (n) => coach.recent(n), mode: () => m, setMode: (x) => (m = x) };
  const tools = createTools(host);
  const bridge = createBridge({ tools, host, conversation, coach, fallback: scriptedBrain() });
  const said = () => conversation.turns.filter((t) => t.who === 'agent').at(-1)?.text ?? '';
  return { lab, call: (n: string, a: unknown = {}) => callTool(tools, n, a), bridge, said };
}

describe('stockroom', () => {
  it('finds substances by name, formula and everyday word, and picks the container', () => {
    expect(findSubstance('copper sulfate')?.id).toBe('copper-sulfate');
    expect(findSubstance('CuSO4')?.id).toBe('copper-sulfate');
    expect(findSubstance('some vinegar')?.id).toBe('acetic-acid');
    expect(findSubstance('baking soda')?.id).toBe('sodium-bicarbonate');
    expect(findSubstance('HCl')?.id).toBe('hydrochloric-acid');
    expect(findSubstance('unobtainium')).toBeNull();
    expect(containerOf(findSubstance('salt')!)).toBe('dish');
    expect(containerOf(findSubstance('NaOH')!)).toBe('beaker');
    expect(new Set(SUBSTANCES.map((s) => s.id)).size).toBe(SUBSTANCES.length);
    for (let n = 0; n < 8; n++) expect(Math.abs(substanceSpot(n).x)).toBeLessThan(450);
  });
});

describe('give_substance', () => {
  it('opens the chemistry lab and puts a beaker, a dish or an element jar on the bench', async () => {
    const s = await setup();
    expect(await s.call('give_substance', { name: 'copper sulfate' })).toEqual(expect.objectContaining({ ok: true, container: 'beaker', formula: 'CuSO₄' }));
    expect(s.lab.store.lab).toBe('chemistry');
    expect(await s.call('give_substance', { name: 'baking soda' })).toEqual(expect.objectContaining({ ok: true, container: 'dish' }));
    expect(await s.call('give_substance', { name: 'Na' })).toEqual(expect.objectContaining({ ok: true, container: 'jar', gave: 'Na' }));
    const kinds = s.lab.store.items().map((i) => i.kind);
    // the two given, beside the dish of salt the chemistry lab lays out by its spatula
    expect(kinds.filter((k) => k === 'substance')).toHaveLength(2 + LAB_LAYOUTS.chemistry.filter((k) => k.kind === 'substance').length);
    expect(kinds).toContain('element-sample');
    const no = await s.call('give_substance', { name: 'unobtainium' });
    expect(no.ok).toBe(false);
    expect((no.stock as string[]).length).toBe(SUBSTANCES.length);
  });

  it('is refused in Assist mode', async () => {
    const s = await setup('assist');
    expect(await s.call('give_substance', { name: 'water' })).toEqual(expect.objectContaining({ ok: false, mode: 'assist' }));
  });

  it('typed: "give me copper sulfate", then "give me baking soda"', async () => {
    expect(intentOf('give me some copper sulfate')).toEqual({ kind: 'give', name: 'copper sulfate' });
    const s = await setup();
    await s.bridge.ask('give me copper sulfate');
    expect(s.said()).toBe('Here is CuSO₄, in a beaker on the right.');
    await s.bridge.ask('give me baking soda');
    expect(s.said()).toBe('Here is NaHCO₃, in a dish on the right.');
    await s.bridge.ask('give me unobtainium');
    expect(s.said()).toMatch(/^The stockroom has no/);
  });
});
