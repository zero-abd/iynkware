/**
 * Onboarding: a short, skippable guided start. Grab a part, draw a wire, press Run, open the menu, move a panel,
 * Recentre and Exit. One world-locked shell panel with the step, one or two lines worded for hands or controllers,
 * dots ("2 of 6"), Back, Next and Skip. Each step advances on its real event (`detect.ts`). Starts by itself on the
 * first immersive entry (Home hands that entry to the `onboarding` slot), and stays reachable from the Getting started
 * tile and the menu row. Logic: `steps.ts`; words: `strings.ts`.
 */
import type { FeatureModule, XrApp } from '../../contracts/app';
import { LANGS, type Lang, type LocalizedText, type Unsubscribe } from '../../contracts/common';
import { dmm } from '../../look/type';
import { placeAhead, shellButton, shellPanel, shellText, type ShellPanel } from '../../shell/kit';
import { detect } from './detect';
import { COUNTED, createMachine, inputKind, markSeen, wasSeen, type Machine } from './steps';
import { t } from './strings';

const D = 1.0;
const W = 640;
const H = 330;
const BTN_W = 170;
const BTN_H = 62;
const TICK_MS = 700;
/** Home calls the entry's `open` on the first immersive entry; a call within this long of entering is that one. */
const AUTO_WINDOW_MS = 6000;

const all = (key: Parameters<typeof t>[1]): LocalizedText => Object.fromEntries(LANGS.map((l: Lang) => [l, t(l, key)])) as LocalizedText;

function startOnboarding(app: XrApp, onClosed: () => void): Unsubscribe {
  const machine: Machine = createMachine((how) => {
    markSeen(how);
    close();
  });
  const lang = () => app.settings.lang.value;
  const panel: ShellPanel = shellPanel(app, { id: 'onboarding', w: dmm(W, D), h: dmm(H, D), distanceM: D, title: t(lang(), 'title'), kicker: t(lang(), 'kicker'), poke: true });
  const body = shellText({ w: panel.inner, h: dmm(150, D), distanceM: D });
  const count = shellText({ w: dmm(200, D), h: dmm(40, D), distanceM: D });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tick: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const draw = () => {
    timer = null;
    if (closed) return;
    const l = lang();
    const kind = inputKind(app.input.sources.value);
    const step = machine.step;
    panel.clear();
    const bodyY = panel.top - dmm(80, D);
    const barY = -dmm(H / 2 - 56, D);
    if (step === 'ready') {
      panel.setTitle(t(l, 'ready'), t(l, 'kicker'));
      panel.add(body, 0, bodyY);
      body.set(t(l, 'readyBody'), { role: 'body' });
      const lessons = shellButton(app, { id: 'onboarding/lessons', w: dmm(BTN_W + 40, D), h: dmm(BTN_H, D), distanceM: D, poke: true, onSelect: () => later(() => (machine.done(), app.lessons.showCatalogue())) }, { label: t(l, 'lessons'), icon: 'book' });
      const done = shellButton(app, { id: 'onboarding/done', w: dmm(BTN_W, D), h: dmm(BTN_H, D), distanceM: D, poke: true, onSelect: () => later(() => machine.done()) }, { label: t(l, 'done'), primary: true });
      panel.add(lessons, -dmm(110, D), barY);
      panel.add(done, dmm(150, D), barY);
      return;
    }
    panel.setTitle(`${machine.ticked ? '✓ ' : ''}${t(l, `${step}.title` as 'grab.title')}`, t(l, 'kicker'));
    panel.add(body, 0, bodyY);
    body.set(t(l, `${step}.${kind}` as 'grab.hands'), { role: 'body' });
    panel.add(count, -panel.inner / 2 + dmm(100, D), barY + dmm(BTN_H / 2 + 26, D));
    count.set(t(l, 'count', { n: machine.index + 1, total: COUNTED }), { role: 'body' });
    const back = shellButton(app, { id: 'onboarding/back', w: dmm(BTN_W, D), h: dmm(BTN_H, D), distanceM: D, poke: true, onSelect: () => later(() => machine.back()) }, { label: t(l, 'back'), disabled: machine.index === 0 });
    const skip = shellButton(app, { id: 'onboarding/skip', w: dmm(BTN_W, D), h: dmm(BTN_H, D), distanceM: D, poke: true, onSelect: () => later(() => machine.skip()) }, { label: t(l, 'skip') });
    const next = shellButton(app, { id: 'onboarding/next', w: dmm(BTN_W, D), h: dmm(BTN_H, D), distanceM: D, poke: true, onSelect: () => later(() => machine.next()) }, { label: t(l, 'next'), primary: true });
    panel.add(back, -dmm(190, D), barY);
    panel.add(skip, 0, barY);
    panel.add(next, dmm(190, D), barY);
  };
  /** Never rebuild controls inside a button's own handler. */
  const later = (fn: () => void) => setTimeout(fn, 0);
  const schedule = () => {
    if (timer === null && !closed) timer = setTimeout(draw, 0);
  };

  const offMachine = machine.subscribe(() => {
    if (tick) clearTimeout(tick);
    tick = null;
    if (machine.ticked) tick = setTimeout(() => machine.next(), TICK_MS);
    schedule();
  });
  const offDetect = detect(
    app,
    (e) => {
      if (machine.feed(e)) app.feedback.play('snap');
    },
    () => (panel.isOpen ? panel.group.position : null),
  );
  const offs = [offMachine, offDetect, app.input.sources.subscribe(schedule), app.settings.lang.subscribe(schedule)];

  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    if (tick) clearTimeout(tick);
    for (const off of offs.splice(0)) off();
    panel.close(() => {
      panel.dispose();
      onClosed();
    });
  }

  app.shell.closeHome();
  draw();
  placeAhead(app.world, panel.group, { distance: D, belowDeg: 8 });
  panel.open();
  return () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    if (tick) clearTimeout(tick);
    for (const off of offs.splice(0)) off();
    panel.dispose();
  };
}

export const onboardingModule: FeatureModule = {
  id: 'learn/onboarding',
  mount(app) {
    let running: Unsubscribe | null = null;
    let enteredAt = app.mode.value === 'flat' ? 0 : performance.now();
    let handled = false;

    const start = () => {
      if (running) return;
      running = startOnboarding(app, () => {
        running = null;
        app.shell.openHome();
      });
    };
    const open = () => {
      const auto = !handled && enteredAt > 0 && performance.now() - enteredAt < AUTO_WINDOW_MS;
      handled = true;
      if (auto && wasSeen()) {
        app.shell.openHome();
        return;
      }
      start();
    };

    const offMode = app.mode.subscribe((m) => {
      if (m !== 'flat' && enteredAt === 0) enteredAt = performance.now();
    });
    const offEntry = app.shell.addEntry({ id: 'learn/onboarding', slot: 'onboarding', title: all('title'), open });
    const offMenu = app.shell.addMenuItem({ id: 'learn/onboarding', group: 'tools', label: all('title'), run: start });

    return () => {
      offMode();
      offEntry();
      offMenu();
      running?.();
      running = null;
    };
  },
};
