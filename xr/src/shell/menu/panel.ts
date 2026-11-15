/**
 * The menu panel's content: what it shows now (`snapshot`), how tall that makes the panel, and its controls (`fill`).
 * Kit controls only: `shellPanel`, `shellButton`, `shellText`. `index.ts` owns when it opens and closes.
 */
import type { XrApp } from '../../contracts/app';
import type { Lang } from '../../contracts/common';
import { pickText } from '../../contracts/common';
import type { MenuItem, Place } from '../../contracts/shell';
import type { IconName } from '../../look/icons';
import { MUTED } from '../../look/palette';
import { dmm } from '../../look/type';
import { say } from '../copy';
import { shellButton, shellPanel, shellText, type ShellPanel } from '../kit';
import { KIT } from '../kit/copy';
import { libraryOf } from '../library/types';
import { BLINK, goPlace, hasPanel, newProject, openLesson, openPanel, openProject, switching, templateTitle } from '../switch';
import { MENU } from './copy';
import { DIM, menuHeight, pageItems, PAGE_SIZE, pagesOf, sortItems, W } from './layout';

/** The menu is read from here. */
export const DISTANCE_M = 1.0;
const d = (n: number) => dmm(n, DISTANCE_M);

export interface Snapshot {
  lang: Lang;
  place: Place;
  offered: readonly Place[];
  busy: boolean;
  hasProjects: boolean;
  hasSettings: boolean;
  /** Library rows other than the open one, newest first, at most three. */
  rows: ReadonlyArray<{ id: string; title: string; detail: string }>;
  items: readonly MenuItem[];
}

export function snapshot(app: XrApp): Snapshot {
  const lib = libraryOf(app);
  const current = lib?.current.value ?? null;
  const rows = (lib?.rows.value ?? [])
    .filter((r) => r.id !== current)
    .slice(0, 3)
    .map((r) => ({ id: r.id, title: r.title, detail: r.board || r.updatedAt.slice(0, 10) }));
  return {
    lang: app.settings.lang.value,
    place: app.shell.place.value,
    offered: app.shell.offered.value,
    busy: switching(app).value,
    hasProjects: hasPanel(app, 'projects'),
    hasSettings: hasPanel(app, 'settings'),
    rows,
    items: sortItems(app.shell.menuItems.value),
  };
}

/** Panel height in metres for this snapshot. */
export const heightOf = (s: Snapshot): number => d(menuHeight(s.rows.length + 2, s.items.length));
export const widthM = d(W);

export interface Actions {
  /** Closes the menu; called after a switch or an action. */
  close(): void;
  setPage(page: number): void;
}

/** Creates the (closed, unplaced) menu panel for `s`. */
export function createPanel(app: XrApp, s: Snapshot, onClose: () => void): ShellPanel {
  return shellPanel(app, {
    id: 'menu',
    w: widthM,
    h: heightOf(s),
    distanceM: DISTANCE_M,
    title: say(MENU, s.lang, 'title'),
    kicker: s.busy ? say(MENU, s.lang, 'opening') : say(KIT, s.lang, 'brand').toUpperCase(),
    onClose,
  });
}

const GROUP_KEY = { bench: 'groupBench', view: 'groupView', tools: 'groupTools' } as const;

/** Puts every control for `s` on `panel` (which must be empty), page `page` of the menu items. */
export function fill(app: XrApp, panel: ShellPanel, s: Snapshot, page: number, act: Actions): void {
  const lang = s.lang;
  const t = (key: keyof (typeof MENU)['en']) => say(MENU, lang, key);
  const inner = panel.inner;
  const gap = d(DIM.GAP);
  let y = panel.top; // the top edge of the next thing, metres
  const rowAt = (h: number) => {
    const c = y - h / 2;
    y -= h;
    return c;
  };
  const heading = (text: string) => {
    y -= d(DIM.SECTION_GAP);
    const h = d(DIM.HEAD_H);
    const tx = panel.add(shellText({ w: inner, h, distanceM: DISTANCE_M }), 0, rowAt(h));
    tx.set(text, { role: 'kicker', colour: MUTED, maxLines: 1 });
  };
  const button = (id: string, x: number, cy: number, w: number, h: number, look: Parameters<typeof shellButton>[2], onSelect: () => void) =>
    panel.add(shellButton(app, { id: `menu/${id}`, w, h, distanceM: DISTANCE_M, onSelect }, { layout: 'row', ...look }), x, cy);
  /** Lays buttons in a grid of `cols` columns, `h` tall. */
  const grid = <T>(list: readonly T[], cols: number, h: number, make: (item: T, x: number, cy: number, w: number, i: number) => void) => {
    const w = (inner - gap * (cols - 1)) / cols;
    for (let r = 0; r * cols < list.length; r++) {
      const cy = rowAt(h);
      y -= r * cols + cols < list.length ? gap : 0;
      for (let c = 0; c < cols && r * cols + c < list.length; c++) {
        const x = -inner / 2 + w / 2 + c * (w + gap);
        make(list[r * cols + c]!, x, cy, w, r * cols + c);
      }
    }
  };
  const then = (fn: () => unknown) => () => {
    fn();
    act.close();
  };

  // Home, Projects, Settings.
  const top: Array<{ id: string; icon: IconName; label: string; detail?: string; disabled?: boolean; run: () => void }> = [
    { id: 'home', icon: 'home', label: t('home'), run: () => app.shell.openHome() },
    { id: 'projects', icon: 'folder', label: t('projects'), disabled: !s.hasProjects, detail: s.hasProjects ? undefined : t('soon'), run: () => openPanel(app, 'projects') },
    { id: 'settings', icon: 'settings', label: t('settings'), disabled: !s.hasSettings, detail: s.hasSettings ? undefined : t('soon'), run: () => openPanel(app, 'settings') },
  ];
  grid(top, 3, d(DIM.TOP_H), (e, x, cy, w) => button(e.id, x, cy, w, d(DIM.TOP_H), { label: e.label, detail: e.detail, icon: e.icon, disabled: e.disabled }, then(e.run)));

  // Where you are.
  heading(t('where'));
  const places: Array<{ place: Place; icon: IconName; label: string; disabled?: boolean; detail?: string }> = [
    { place: 'bench', icon: 'wrench', label: t('bench') },
    { place: 'room', icon: 'cube', label: t('room'), disabled: !s.offered.includes('room'), detail: s.offered.includes('room') ? undefined : t('notReady') },
    { place: 'range', icon: 'drone', label: t('drones') },
  ];
  grid(places, 3, d(DIM.PLACE_H), (e, x, cy, w) =>
    button(
      `place-${e.place}`,
      x,
      cy,
      w,
      d(DIM.PLACE_H),
      { label: e.label, icon: e.icon, selected: s.place === e.place, disabled: e.disabled || s.busy, detail: e.detail ?? (s.place === e.place ? t('here') : undefined) },
      then(() => goPlace(app, e.place)),
    ),
  );

  // Switch project.
  heading(t('project'));
  const projects: Array<{ id: string; icon: IconName; label: string; detail: string; run: () => unknown }> = [
    ...s.rows.map((r) => ({ id: `project-${r.id}`, icon: 'folder' as const, label: r.title, detail: r.detail, run: () => openProject(app, r.id) })),
    { id: 'lesson-blink', icon: 'book', label: templateTitle(BLINK, lang), detail: t('lesson'), run: () => openLesson(app, BLINK) },
    { id: 'new', icon: 'plus', label: t('newProject'), detail: t('newDetail'), run: () => newProject(app) },
  ];
  grid(projects, 2, d(DIM.GRID_H), (e, x, cy, w) => button(e.id, x, cy, w, d(DIM.GRID_H), { label: e.label, detail: e.detail, icon: e.icon, disabled: s.busy }, then(e.run)));

  // Rows from the other pillars, paged.
  const pages = pagesOf(s.items.length);
  const at = Math.min(Math.max(0, page), pages - 1);
  if (s.items.length > 0) {
    heading(t('controls'));
    grid(pageItems(s.items, at), 2, d(DIM.GRID_H), (item, x, cy, w, i) => {
      const group = t(GROUP_KEY[item.group]);
      const on = item.toggle?.value;
      const detail = on === undefined ? group : `${group} - ${say(KIT, lang, on ? 'on' : 'off')}`;
      button(`item-${at * PAGE_SIZE + i}`, x, cy, w, d(DIM.GRID_H), { label: pickText(item.label, lang), detail, switchOn: on }, item.toggle ? () => item.run() : then(() => item.run()));
    });
  }

  // Leave headset mode, and More or Back.
  y -= d(DIM.SECTION_GAP);
  const fh = d(DIM.FOOT_H);
  const cy = rowAt(fh);
  const leave = () => app.world.exitXR();
  if (pages > 1) {
    const w = (inner - gap) / 2;
    button('leave', -inner / 2 + w / 2, cy, w, fh, { label: t('leave'), icon: 'exit' }, then(leave));
    const last = at >= pages - 1;
    button(
      'page',
      inner / 2 - w / 2,
      cy,
      w,
      fh,
      { label: last ? say(KIT, lang, 'back') : t('more'), icon: 'dots', detail: say(MENU, lang, 'page', { n: at + 1, m: pages }) },
      () => act.setPage(last ? 0 : at + 1),
    );
  } else {
    button('leave', 0, cy, inner, fh, { label: t('leave'), icon: 'exit' }, then(leave));
  }
}
