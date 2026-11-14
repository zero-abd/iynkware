import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildFigure, loadFigure } from './testkit.mjs';

const BOARDS = readdirSync(resolve(import.meta.dirname, '../boards')).map((f) => f.replace('.js', ''));
const open = (id) => loadFigure(buildFigure(`boards/${id}`), { path: `/figures/boards/${id}.html` });
const schematic = (page, circuit) => {
  page.bench.accept({ circuit, view: 'schematic' });
  const art = page.win.document.getElementById('art');
  return {
    ids: [...new Set([...art.querySelectorAll('[data-act="bb"][data-id]')].map((e) => e.dataset.id))],
    text: [...art.querySelectorAll('text')].map((t) => t.textContent),
  };
};

let page;
afterEach(() => { page?.close(); page = null; });

describe('schematic', () => {
  it.each(BOARDS)('%s: draws every part of every lesson circuit', async (id) => {
    page = await open(id);
    for (const [key, c] of Object.entries(page.bench.md.circuits || {})) {
      const { ids } = schematic(page, key);
      expect(ids.sort(), `${id}/${key}`).toEqual((c.parts || []).map((p) => p.id).sort());
    }
    expect(page.notes()).toEqual([]);
  });

  it('shows a servo with its three pins and the board pins that reach them', async () => {
    page = await open('uno-r3');
    const { ids, text } = schematic(page, 'servo');
    expect(ids).toEqual(['SRV1']);
    expect(text).toEqual(expect.arrayContaining(['D9', '5V', 'GND', 'V+', 'SIG']));
  });

  it('chains a resistor and an LED in series and names the net a block pin shares with a row', async () => {
    page = await open('uno-r3');
    const { text } = schematic(page, 'heat');
    // RES1 ends where Q1's base pin is: both carry the same net name
    expect(text.filter((t) => t === 'N1')).toHaveLength(2);
  });

  it('names the socket net a plugged part reaches', async () => {
    page = await open('uno-r3');
    const { text } = schematic(page, 'stepper');
    expect(text).toEqual(expect.arrayContaining(['DRV1.OUT1', 'DRV1.OUT4']));
  });

  it('redraws a switch when it is pressed', async () => {
    page = await open('uno-r3');
    const drawn = () => {
      schematic(page, 'button');
      return page.win.document.querySelector('#art [data-act="bb"][data-id="BTN1"]').innerHTML;
    };
    const open1 = drawn();
    expect(drawn()).toBe(open1);
    page.bench.accept({ params: { BTN1: { pressed: 1 } } });
    expect(drawn()).not.toBe(open1);
  });
});
