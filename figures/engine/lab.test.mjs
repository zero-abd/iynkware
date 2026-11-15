import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CATALOGUE, buildCatalogue, labIds, serialize } from './lab-catalogue.mjs';
import { buildFigure, loadFigure } from './testkit.mjs';

// Lab items (docs/FIGURES-LAB.md): each page mounts on its own, reports the state a tutor needs, names a mistake when
// one holds, and figures/lab/catalogue.json matches the item files.
const open = (id, query = '') => loadFigure(buildFigure(`lab/${id}`), { path: `/figures/lab/${id}.html`, query, frozenClock: true });

let page;
afterEach(() => { page?.close(); page = null; });

describe('lab catalogue', () => {
  it('is up to date with the item files', async () => {
    expect(readFileSync(CATALOGUE, 'utf8')).toBe(serialize(await buildCatalogue()));
  });

  it('lists every report key each page sends, and every page mounts cleanly', async () => {
    const cat = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
    expect(cat.items.map((i) => i.id)).toEqual(labIds());
    for (const item of cat.items) {
      page = await open(item.id);
      expect(page.notes(), item.id).toEqual([]);
      expect(Object.keys(page.lab.report()).sort(), item.id).toEqual([...item.report].sort());
      expect(item.mistakes.length, item.id).toBeGreaterThan(0);
      expect(item.actions.length, item.id).toBeGreaterThan(0);
      page.close(); page = null;
    }
  });
});

describe('the host patch', () => {
  it('refuses unknown keys and bad values and changes nothing', async () => {
    page = await open('bench-power-supply');
    const L = page.lab;
    expect(L.accept({ volts: 3 })).toMatch(/unknown key/);
    expect(L.accept({ vSet: 99, on: true })).toMatch(/vSet/);
    expect(L.report().on).toBe(false);
    expect(L.accept({ vSet: 7.5 })).toBe(true);
    expect(L.report().vSet).toBe(7.5);
  });
});

describe('Bunsen burner', () => {
  it('names gas left on without a flame', async () => {
    page = await open('bunsen-burner');
    const L = page.lab;
    expect(L.accept({ lit: true })).toMatch(/needs the gas/);
    L.accept({ gasOn: true });
    L.advance(1);
    expect(L.report().mistake).toBe(null);
    L.advance(1.5);
    expect(L.report()).toMatchObject({ gasOn: true, lit: false, flame: 'none', mistake: 'gas-unlit' });
  });

  it('will not light with the collar open, and gives a flame for the collar', async () => {
    page = await open('bunsen-burner', 'collar=open');
    const L = page.lab;
    L.accept({ gasOn: true });
    L.press('light');
    expect(L.report()).toMatchObject({ lit: false, mistake: 'light-collar-open' });
    // once the collar moves, the failed light is history: what is left is gas on and unlit
    L.accept({ collar: 'half' });
    L.advance(2.5);
    expect(L.report().mistake).toBe('gas-unlit');
    L.accept({ collar: 'closed' });
    L.press('light');
    expect(L.report()).toMatchObject({ lit: true, flame: 'luminous', mistake: null });
    L.accept({ collar: 'open' });
    expect(L.report().flame).toBe('roaring');
    L.advance(21);
    expect(L.report().mistake).toBe('blue-flame-idle');
    L.accept({ gasOn: false });
    expect(L.report()).toMatchObject({ lit: false, flame: 'none', mistake: null });
  });
});

describe('bench power supply', () => {
  it('runs CV until the load wants more than the limit, then CC', async () => {
    page = await open('bench-power-supply');
    const L = page.lab;
    L.accept({ on: true, vSet: 5, iSet: 0.5, load: 'r100' });
    expect(L.report()).toMatchObject({ mode: 'CV', vOut: 5, iOut: 0.05, mistake: null });
    L.accept({ load: 'r10', vSet: 12, iSet: 0.5 });
    expect(L.report()).toMatchObject({ mode: 'CC', iOut: 0.5, vOut: 5, pLoadW: 2.5, loadHot: false });
    L.accept({ iSet: 2 });
    expect(L.report()).toMatchObject({ mode: 'CV', iOut: 1.2, pLoadW: 14.4, loadHot: true, mistake: 'resistor-overload' });
    L.accept({ load: 'short' });
    expect(L.report()).toMatchObject({ mode: 'CC', iOut: 2, mistake: 'short-high-limit' });
    L.accept({ load: 'r100', iSet: 5, vSet: 5 });
    expect(L.report().mistake).toBe('limit-at-max');
    L.press('power');
    expect(L.report()).toMatchObject({ on: false, mode: null, vOut: 0, mistake: null });
  });
});

describe('pendulum', () => {
  it('swings with T = 2π√(L/g), longer for big swings, and counts the swings', async () => {
    page = await open('pendulum-stand', 'length=400&amplitude=10');
    const L = page.lab;
    expect(L.report()).toMatchObject({ periodSmallS: 1.27, swinging: false, swings: 0 });
    L.press('swing');
    L.advance(6.5);
    expect(L.report()).toMatchObject({ swinging: true, swings: 5, mistake: null });
    L.accept({ amplitude: 45 });
    expect(L.report().periodS).toBeGreaterThan(1.3);
    expect(L.report().mistake).toBe('large-angle');
    L.accept({ bob: 'wood' });
    expect(L.report()).toMatchObject({ bobGrams: 5, periodSmallS: 1.27 });
  });
});

describe('glassware', () => {
  it('beaker: heating empty, heating too full, overfilled', async () => {
    page = await open('beaker-250');
    const L = page.lab;
    L.press('empty');
    L.press('heat');
    expect(L.report()).toMatchObject({ heat: true, volume: 0, mistake: 'heating-empty' });
    L.accept({ volume: 200 });
    expect(L.report().mistake).toBe('heating-too-full');
    L.accept({ heat: false, volume: 300 });
    expect(L.report().mistake).toBe('overfilled');
    L.accept({ volume: 100, heat: true });
    L.advance(40);
    expect(L.report()).toMatchObject({ tempC: 100, boiling: true, mistake: null });
  });

  it('conical flask: swirling too full, and the swirl ends by itself', async () => {
    page = await open('erlenmeyer-250', 'volume=200');
    const L = page.lab;
    L.press('swirl');
    expect(L.report()).toMatchObject({ swirling: true, mistake: 'swirl-too-full' });
    L.advance(3.5);
    expect(L.report()).toMatchObject({ swirling: false, mistake: null });
  });
});

describe('soldering station', () => {
  it('heats the tip toward the dial and names an iron left out of its stand', async () => {
    page = await open('soldering-station');
    const L = page.lab;
    L.press('power');
    L.advance(30);
    expect(L.report()).toMatchObject({ on: true, tipC: 330, heating: false, mistake: null });
    L.press('iron');
    L.advance(16);
    expect(L.report()).toMatchObject({ inHolder: false, mistake: 'iron-left-out' });
    L.press('iron');
    L.accept({ tempSet: 450 });
    expect(L.report().mistake).toBe('too-hot');
    L.accept({ tempSet: 330, sponge: 'dry' });
    expect(L.report().mistake).toBe('dry-sponge');
  });
});

describe('a lab item as a bench prop', () => {
  it('stands on a lesson mat beside the circuit, pressable, with its params', async () => {
    const root = resolve(import.meta.dirname, '..', '..');
    const src = ['figures/engine/lab.js', 'figures/lab/beaker-250.js'].map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
    const html = buildFigure('boards/uno-r3') + `<script>${src}</script>`;
    page = await loadFigure(html, { path: '/figures/boards/uno-r3.html' });
    const B = page.bench;
    expect(B.props['beaker-250']).toBeTruthy();
    B.md.circuits.light.props.push({ id: 'BKR', prop: 'beaker-250', at: [150, -30], volume: 200 });
    expect(B.accept({ view: 'breadboard', circuit: 'light' })).toBe(true);
    expect(page.win.document.getElementById('art').innerHTML).toContain('data-id="BKR"');
    B.accept({ params: { BKR: { liquid: 'permanganate' } } });
    expect(B.st.cparams.BKR).toEqual({ liquid: 'permanganate' });
    expect(page.lab.st).toBe(null);
    expect(page.notes()).toEqual([]);
  });
});
