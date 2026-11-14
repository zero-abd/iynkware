// The bridge (figures/engine/embed.js) as a host drives it: a stand-in parent window, messages in, messages out.
import { afterEach, describe, expect, it } from 'vitest';
import { buildFigure, loadFigure } from './testkit.mjs';

let page;
afterEach(() => { page?.close(); page = null; });
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const last = (type) => page.sent.filter((m) => m.type === type).at(-1);
const uno = () => loadFigure(buildFigure('boards/uno-r3'), { path: '/figures/boards/uno-r3.html', query: 'view=power', host: true });
const shown = (id) => {
  const b = page.win.document.querySelector(`#btns .act[data-id="${id}"]`);
  return page.win.getComputedStyle(b.closest('.stepwrap')).display !== 'none';
};

describe('chrome: the host hides the figure buttons it draws itself', () => {
  it('hides the named buttons, lists them as hidden in ready, and shows them all again', async () => {
    page = await uno();
    await tick();
    const ids = last('ready').buttons.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['power', 'upload', 'break', 'view', 'strip']));
    page.post({ type: 'chrome', hide: ['power', 'break', 'view'] });
    expect(shown('power')).toBe(false);
    expect(shown('break')).toBe(false);
    expect(shown('strip')).toBe(true);
    page.post({ type: 'hello' });
    await tick();
    const listed = last('ready').buttons;
    expect(listed.map((b) => b.id)).toEqual(ids);
    expect(listed.filter((b) => b.hidden).map((b) => b.id)).toEqual(['power', 'break', 'view']);
    // See-through and Labels stay
    expect(page.win.getComputedStyle(page.win.document.getElementById('xrb')).display).not.toBe('none');
    page.post({ type: 'chrome', hide: [] });
    expect(ids.every(shown)).toBe(true);
    page.post({ type: 'hello' });
    await tick();
    expect(last('ready').buttons.some((b) => b.hidden)).toBe(false);
    expect(page.sent.filter((m) => m.type === 'error')).toEqual([]);
  });

  it('a hidden button is still pressed by id, its picker too', async () => {
    page = await uno();
    page.post({ type: 'chrome', hide: ['power', 'break'] });
    page.post({ type: 'press', id: 'power', choice: 'usb' });
    expect(page.bench.report().power).toBe('usb');
    page.post({ type: 'press', id: 'break', choice: 'repair' });
    expect(page.sent.filter((m) => m.type === 'error')).toEqual([]);
    expect(shown('power')).toBe(false);
  });

  it('refuses ids it has no button for, and anything that is not a list of ids', async () => {
    page = await uno();
    page.post({ type: 'chrome', hide: ['power', 'xr', 'nope', 'teleport'] });
    expect(shown('power')).toBe(false);
    expect(last('error').message).toMatch(/chrome: no button "nope", "teleport"/);
    page.post({ type: 'chrome', hide: 'power' });
    expect(last('error').message).toMatch(/chrome: hide must be a list of button ids/);
    expect(shown('power')).toBe(false);
  });
});

describe('chrome: See-through, Labels and the HUD', () => {
  const visible = (el) => page.win.getComputedStyle(el).display !== 'none';
  const doc = () => page.win.document;

  it('hides the See-through switch and the stats a host draws itself, and the host still drives See-through', async () => {
    page = await uno();
    await tick();
    expect(last('ready').switches.map((s) => s.id)).toEqual(['xr', 'labels']);
    page.post({ type: 'chrome', hide: ['power', 'xr', 'stats'] });
    expect(visible(doc().getElementById('xrb'))).toBe(false);
    expect(visible(doc().getElementById('lblb'))).toBe(true);
    expect(visible(doc().getElementById('stats'))).toBe(false);
    expect(shown('power')).toBe(false);
    page.post({ type: 'xr', on: true });
    await tick(900);
    expect(doc().getElementById('xrb').getAttribute('aria-pressed')).toBe('true');
    page.post({ type: 'hello' });
    await tick();
    expect(last('ready').switches).toEqual([
      expect.objectContaining({ id: 'xr', hidden: true }),
      expect.not.objectContaining({ hidden: true }),
    ]);
    page.post({ type: 'chrome', hide: [] });
    expect(visible(doc().getElementById('xrb'))).toBe(true);
    expect(visible(doc().getElementById('stats'))).toBe(true);
    expect(page.sent.filter((m) => m.type === 'error')).toEqual([]);
  });

  it('hides the zoom chip and the toast for a host that shows the figure on its own (the landing page)', async () => {
    page = await uno();
    await tick();
    const zoom = () => doc().querySelector('.zchip'), toast = () => doc().getElementById('toast');
    expect(zoom()).not.toBeNull();
    page.post({ type: 'chrome', hide: ['zoom', 'toast'] });
    expect(visible(zoom())).toBe(false);
    expect(visible(toast())).toBe(false);
    expect(page.sent.filter((m) => m.type === 'error')).toEqual([]);
    page.post({ type: 'chrome', hide: [] });
    expect(visible(zoom())).toBe(true);
    expect(visible(toast())).toBe(true);
  });
});

describe('ready', () => {
  it('gives a button labelled from a template its English label filled in', async () => {
    page = await uno();
    await tick();
    const reset = last('ready').buttons.find((b) => b.id === 'ctl-reset');
    expect(reset).toMatchObject({ en: 'Press RESET', label: 'Press RESET' });
  });
});

describe('hold: the host hears how long a part is pressed', () => {
  const press = (target, type) => target.dispatchEvent(new page.win.MouseEvent(type, { bubbles: true, button: 0 }));
  const holds = () => page.sent.filter((m) => m.type === 'hold').map(({ id, down }) => ({ id, down }));
  const button = () => page.win.document.querySelector('#art [data-act="bb"][data-id="BTN1"]');

  it('sends down with the press and up with the release, for a breadboard button', async () => {
    page = await loadFigure(buildFigure('boards/uno-r3'), { path: '/figures/boards/uno-r3.html', query: 'view=breadboard&circuit=button', host: true });
    press(button(), 'pointerdown');
    expect(holds()).toEqual([{ id: 'BTN1', down: true }]);
    expect(page.bench.report().meas.BTN1.closed).toBe(true);
    press(page.win, 'pointerup');
    expect(holds()).toEqual([{ id: 'BTN1', down: true }, { id: 'BTN1', down: false }]);
    expect(page.bench.report().meas.BTN1.closed).toBe(false);
  });

  it('does not echo the host pressing the button through params, which still moves it', async () => {
    page = await loadFigure(buildFigure('boards/uno-r3'), { path: '/figures/boards/uno-r3.html', query: 'view=breadboard&circuit=button', host: true });
    page.post({ type: 'set', state: { params: { BTN1: { pressed: 1 } } } });
    expect(page.bench.report().meas.BTN1.closed).toBe(true);
    page.post({ type: 'set', state: { params: { BTN1: { pressed: 0 } } } });
    expect(page.bench.report().meas.BTN1.closed).toBe(false);
    expect(holds()).toEqual([]);
  });

  it('presses an on-board button when params say pressed', async () => {
    page = await loadFigure(buildFigure('boards/microbit-v2'), { path: '/figures/boards/microbit-v2.html', host: true });
    const B = page.bench;
    const sw = B.md.parts.find((p) => p.control && p.control.action === 'input');
    page.post({ type: 'set', state: { params: { [sw.id]: { pressed: 1 } } } });
    expect(B.st.ctl[sw.id]).toBe(1);
    page.post({ type: 'set', state: { params: { [sw.id]: { pressed: 0 } } } });
    expect(B.st.ctl[sw.id]).toBe(0);
  });
});
