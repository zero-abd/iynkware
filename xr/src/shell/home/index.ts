/**
 * Home (XR_DESIGN.md 9.6): the panel that opens on entering the headset and from the menu. Continue (the project on the
 * bench, the last project or lesson, or Blink for a first visit), New project, the Blink lesson, the pillars' lesson and
 * Range tiles (`app.shell.entries`), the drone, a robot bench, a row of the science labs (switching labs happens here:
 * there is no separate lab picker), three templates, Projects, Settings, the menu and the language. Every tile switches inside the session through `../switch`. World-locked 0.95 m ahead, 8 degrees below eye
 * level: nearer than the design's 1.3 m so it sits in front of the lesson guide (about 1.1 m), which would otherwise
 * take its rays. Its pointer order is above every other target's (`HOME_ORDER`), so a panel, a control or a bench cell
 * nearer than Home, or behind its gaps, never takes a ray aimed at it. Sizes are in dmm, so it looks the same size.
 * `app.shell.homeOpen` is the truth: `openHome()` from anywhere opens it.
 */
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Lang, Unsubscribe } from '../../contracts/common';
import { LANGS, pickText } from '../../contracts/common';
import { onLookFrame } from '../../look/runner';
import { MUTED } from '../../look/palette';
import { dmm } from '../../look/type';
import { say } from '../copy';
import { shellButton, shellPanel, shellText, placeAhead, type ButtonLook, type ShellPanel } from '../kit';
import { libraryOf } from '../library/types';
import {
  BLINK,
  continueLast,
  continueTarget,
  FEATURED,
  hasPanel,
  newProject,
  openDrone,
  openLesson,
  openPanel,
  providePanel,
  switching,
  templateTitle,
} from '../switch';
import { claimFocus, onFocusLost } from '../switch/focus';
import type { IconName } from '../../look/icons';
import type { HomeEntry } from '../../contracts/shell';
import { HOME, LANG_NAMES } from './copy';
import { labEntries, learnSpotEntry } from './entry';

/** Viewing distance and the grid, in dmm (9.1, 9.6). */
const D = 0.95;
const W = 840;
const ROW = 84;
const GAP = 12;
const KICK = 30;
const FOOT = 70;
/** The how-to-get-back line under the last row: two caption lines. */
const HINT = 56;
/** The rows under Continue: Learn, Labs, Drones and robots, Templates. */
const ROWS = 4;
const H = 64 + 18 + ROW + ROWS * (GAP + KICK + ROW) + GAP + 8 + FOOT + HINT + 24;
/**
 * `pointerEventsOrder` for Home's whole subtree, plus each object's own (buttons over the backplate). Above every target
 * kind (contracts/input.ts: cell 5 at most), so nothing nearer or behind wins a ray while Home is open.
 */
export const HOME_ORDER = 10;
type Ordered = { pointerEventsOrder?: number };

const ROBOT_TEMPLATE = 'prj_robotics-l298n';
/** Frames and time to wait after entering before Home is placed (the headset pose arrives after the session starts). */
const SETTLE_FRAMES = 4;
const SETTLE_MS = 300;

type Cell = { id: string; look: ButtonLook; run(): void; span?: number };

function cells(app: XrApp, lang: Lang): { title: string; rows: Array<{ kicker?: string; cells: Cell[] }>; foot: Cell[]; hint: string } {
  const t = (k: keyof (typeof HOME)['en'], p?: Record<string, string | number>) => say(HOME, lang, k, p);
  const lib = libraryOf(app);
  const busy = switching(app).value;
  const go = (fn: () => unknown) => () => {
    if (!switching(app).value) void fn();
  };
  const target = continueTarget(app);
  const first = target.kind === 'start';
  const cont: Cell = {
    id: 'home/continue',
    span: 2,
    look: {
      label: first ? t('startHere') : t('continue'),
      detail: target.kind === 'bench' ? t('onBench', { title: target.title }) : target.title,
      icon: 'play',
      layout: 'row',
      primary: true,
      disabled: busy,
    },
    run: go(() => continueLast(app)),
  };
  const fresh: Cell = { id: 'home/new', look: { label: t('newProject'), detail: t('newDetail'), icon: 'plus', layout: 'row', disabled: busy || !lib }, run: go(() => newProject(app)) };

  const tile = (e: HomeEntry, icon: IconName): Cell => ({
    id: `home/entry/${e.id}`,
    look: { label: pickText(e.title, lang), detail: e.detail ? pickText(e.detail, lang) : undefined, icon, layout: 'row', disabled: busy },
    run: () => {
      if (switching(app).value) return;
      app.shell.closeHome();
      e.open();
    },
  });
  const lessonEntry = learnSpotEntry(app.shell.entries.value);
  const learn: Cell[] = [
    {
      id: 'home/blink',
      span: lessonEntry ? 1 : 2,
      look: { label: t('blink'), detail: t('blinkDetail'), icon: 'lightbulb', layout: 'row', disabled: busy },
      run: go(() => openLesson(app, BLINK)),
    },
    ...(lessonEntry ? [tile(lessonEntry, 'graduation')] : []),
    {
      id: 'home/lessons',
      look: { label: t('allLessons'), detail: t('allDetail'), icon: 'book', layout: 'row', disabled: busy },
      run: () => {
        app.shell.closeHome();
        app.lessons.showCatalogue();
      },
    },
  ];

  // One tile per lab: picking one opens that lab on the bench (the lab pillar closes Home).
  const labIcons: Record<string, IconName> = { chemistry: 'flame', physics: 'timer', electrical: 'lightning', signals: 'waveform' };
  const labs: Cell[] = labEntries(app.shell.entries.value).map((e) => tile(e, labIcons[e.id.split('/').pop() ?? ''] ?? 'graduation'));

  const range = app.shell.entries.value.find((e) => e.slot === 'range');
  const n = lib?.rows.value.length ?? 0;
  const fly: Cell[] = [
    {
      id: 'home/drone',
      look: {
        label: range ? pickText(range.title, lang) : t('drone'),
        detail: range ? pickText(range.detail, lang) : t('soon'),
        icon: 'drone',
        layout: 'row',
        disabled: busy || !range,
      },
      run: go(() => openDrone(app)),
    },
    { id: 'home/robot', look: { label: t('robot'), detail: t('robotDetail'), icon: 'robot', layout: 'row', disabled: busy || !lib }, run: go(() => newProject(app, ROBOT_TEMPLATE)) },
    {
      id: 'home/projects',
      look: { label: t('projects'), detail: hasPanel(app, 'projects') ? t('projectsDetail', { n }) : t('soon'), icon: 'folder', layout: 'row', disabled: !hasPanel(app, 'projects') },
      run: () => {
        app.shell.closeHome();
        openPanel(app, 'projects');
      },
    },
  ];

  const icons: IconName[] = ['cpu', 'cube', 'waveform'];
  const templates: Cell[] = FEATURED.filter((id) => id !== ROBOT_TEMPLATE)
    .slice(0, 3)
    .map((id, i) => ({
      id: `home/template/${id}`,
      look: { label: templateTitle(id, lang), detail: t('template'), icon: icons[i] ?? 'cube', layout: 'row', disabled: busy || !lib },
      run: go(() => newProject(app, id)),
    }));

  const next = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]!;
  const foot: Cell[] = [
    { id: 'home/menu', look: { label: t('menu'), detail: t('menuDetail'), icon: 'menu', layout: 'row', disabled: !hasPanel(app, 'menu') },
      run: () => {
        app.shell.closeHome();
        openPanel(app, 'menu');
      },
    },
    {
      id: 'home/settings',
      look: { label: t('settings'), detail: hasPanel(app, 'settings') ? t('settingsDetail') : t('soon'), icon: 'settings', layout: 'row', disabled: !hasPanel(app, 'settings') },
      run: () => {
        app.shell.closeHome();
        openPanel(app, 'settings');
      },
    },
    { id: 'home/lang', look: { label: LANG_NAMES[lang], detail: `${t('language')}: ${LANG_NAMES[next]}`, icon: 'globe', layout: 'row' }, run: () => app.settings.setLang(next) },
  ];

  return {
    title: first ? t('titleFirst') : t('title'),
    rows: [
      { cells: [cont, fresh] },
      { kicker: t('learn'), cells: learn },
      ...(labs.length ? [{ kicker: t('labs'), cells: labs }] : []),
      { kicker: t('fly'), cells: fly },
      { kicker: t('templates'), cells: templates },
    ],
    foot,
    // The palm button floats off the hand that is not the dominant one (../menu/palm.ts).
    hint: t(app.settings.xr.value.dominantHand === 'left' ? 'hintRightPalm' : 'hintLeftPalm'),
  };
}

/**
 * Home wins every ray aimed at it: over nearer panels, and over controls or bench cells behind its gaps. Every object
 * in its subtree gets `HOME_ORDER` plus its own order (a button's 4 over the backplate's 0); run again after anything
 * binds, since a binding sets its object's order from its kind.
 */
export function lift(p: { group: { traverse(fn: (o: unknown) => void): void } }): void {
  p.group.traverse((o) => {
    const own = (o as Ordered).pointerEventsOrder;
    if (own === undefined) (o as Ordered).pointerEventsOrder = HOME_ORDER;
    else if (own < HOME_ORDER) (o as Ordered).pointerEventsOrder = HOME_ORDER + own;
  });
}

export const homeModule: FeatureModule = {
  id: 'shell/home',
  mount(app) {
    let panel: ShellPanel | null = null;
    let seenImmersive = false;
    let stopWait: Unsubscribe | null = null;

    const ensure = (): ShellPanel => {
      if (panel) return panel;
      const p = shellPanel(app, {
        id: 'home',
        w: dmm(W, D),
        h: dmm(H, D),
        distanceM: D,
        title: say(HOME, app.settings.lang.value, 'title'),
        kicker: 'iynkware',
        icon: 'home',
        onClose: () => app.shell.closeHome(),
      });
      panel = p;
      return p;
    };

    const render = () => {
      const p = panel;
      if (!p || !app.shell.homeOpen.value) return;
      const lang = app.settings.lang.value;
      const c = cells(app, lang);
      p.setTitle(c.title, 'iynkware');
      p.clear();
      const inner = p.inner;
      const gap = dmm(GAP, D);
      /** A row of `n` columns: three, or more when a row has more tiles (the four labs). */
      const colOf = (n: number) => (inner - (n - 1) * gap) / n;
      let col = colOf(3);
      const rowH = dmm(ROW, D);
      const left = -inner / 2;
      const place = (cell: Cell, x0: number, y: number, h: number) => {
        const span = cell.span ?? 1;
        const w = col * span + dmm(GAP, D) * (span - 1);
        p.add(shellButton(app, { id: cell.id, w, h, distanceM: D, onSelect: () => cell.run() }, cell.look), x0 + w / 2, y);
      };
      let y = p.top;
      for (const row of c.rows) {
        if (row.kicker) {
          const k = p.add(shellText({ w: inner, h: dmm(KICK, D), distanceM: D }), 0, y - dmm(KICK, D) / 2 - dmm(2, D));
          k.set('', { kicker: row.kicker });
          y -= dmm(KICK, D);
        }
        col = colOf(Math.max(3, row.cells.reduce((n, c) => n + (c.span ?? 1), 0)));
        let x = left;
        for (const cell of row.cells) {
          place(cell, x, y - rowH / 2, rowH);
          x += (col + dmm(GAP, D)) * (cell.span ?? 1);
        }
        y -= rowH + dmm(GAP, D);
      }
      y -= dmm(8, D);
      col = colOf(3);
      let x = left;
      for (const cell of c.foot) {
        place(cell, x, y - dmm(FOOT, D) / 2, dmm(FOOT, D));
        x += col + dmm(GAP, D);
      }
      y -= dmm(FOOT, D) + dmm(10, D);
      const hint = p.add(shellText({ w: inner, h: dmm(HINT - 10, D), distanceM: D }), 0, y - dmm(HINT - 10, D) / 2);
      hint.set(c.hint, { role: 'caption', colour: MUTED, maxLines: 2 });
      lift(p);
    };

    const show = () => {
      claimFocus(app, 'home');
      const p = ensure();
      if (!p.isOpen) placeAhead(app.world, p.group, { distance: D, belowDeg: 8 });
      render();
      p.open();
      lift(p);
    };
    const hide = () => panel?.close();

    const offs: Unsubscribe[] = [
      providePanel(app, 'home', () => app.shell.openHome()),
      onFocusLost(app, 'home', () => app.shell.closeHome()),
      app.shell.homeOpen.subscribe((open) => (open ? show() : hide())),
      // Opens on the first entry into the headset; a pillar's onboarding entry takes that first entry instead.
      app.mode.subscribe((mode) => {
        if (mode === 'flat' || seenImmersive) return;
        seenImmersive = true;
        // The camera takes the headset's pose a few frames after the session starts; placing Home before that puts it
        // where the flat page's camera was.
        let frames = 0;
        const since = performance.now();
        stopWait?.();
        stopWait = onLookFrame(app.world, () => {
          if (++frames < SETTLE_FRAMES || performance.now() - since < SETTLE_MS) return;
          stopWait?.();
          stopWait = null;
          const onboarding = app.shell.entries.value.find((e) => e.slot === 'onboarding');
          if (onboarding) onboarding.open();
          else app.shell.openHome();
        });
      }),
      app.settings.lang.subscribe(render),
      app.settings.xr.subscribe(render),
      app.shell.entries.subscribe(render),
      app.shell.offered.subscribe(render),
      app.lessons.last.subscribe(render),
      switching(app).subscribe(render),
    ];
    // The library mounts first; its values change as storage opens.
    const lib = libraryOf(app);
    if (lib) offs.push(lib.rows.subscribe(render), lib.current.subscribe(render), lib.last.subscribe(render));
    if (app.mode.value !== 'flat') {
      seenImmersive = true;
      app.shell.openHome();
    }

    return () => {
      stopWait?.();
      for (const off of offs.splice(0)) off();
      panel?.dispose();
      panel = null;
      app.shell.closeHome();
    };
  },
};
