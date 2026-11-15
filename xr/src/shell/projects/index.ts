/**
 * Projects (issue #83): the person's saved projects, newest first, paged. Press a row to open it, the bin at its end to
 * delete it (a confirm card first), New project for a blank Uno bench. Home's Projects tile and the menu's Projects row
 * open it (`providePanel(app, 'projects')`); one shell panel is in front at a time (`../switch/focus.ts`). World-locked
 * 1.0 m ahead, 8 degrees below eye level. Over the library (`../library/types.ts`) and the switch (`../switch`), which
 * close the panel's way, run one switch at a time and say what failed as a notice. Sizes and paging: `layout.ts`.
 */
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { MUTED } from '../../look/palette';
import { dmm } from '../../look/type';
import { say } from '../copy';
import { confirmCard, placeAhead, shellButton, shellPanel, shellText, type ShellPanel } from '../kit';
import { KIT } from '../kit/copy';
import { libraryOf, type LibraryRow } from '../library/types';
import { newProject, openProject, providePanel, switching } from '../switch';
import { claimFocus, onFocusLost } from '../switch/focus';
import { PROJECTS } from './copy';
import { FOOT_H, GAP, H, KICK_H, NEW_H, noteOf, pageOf, ROW_H, W } from './layout';

const D = 1.0;
const d = (n: number) => dmm(n, D);

function mountProjects(app: XrApp): Unsubscribe {
  let panel: ShellPanel | null = null;
  let isOpen = false;
  let page = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watchers: Unsubscribe[] = [];
  const t = (k: keyof (typeof PROJECTS)['en'], p?: Record<string, string | number>) => say(PROJECTS, app.settings.lang.value, k, p);

  const askDelete = (row: LibraryRow, isCurrent: boolean) => {
    const lib = libraryOf(app);
    if (!lib) return;
    confirmCard(app, {
      id: 'projects/delete',
      title: t('deleteTitle', { title: row.title }),
      body: t(isCurrent ? 'deleteBodyCurrent' : 'deleteBody'),
      confirm: t('delete'),
      danger: true,
      // In front of the list, which stays open behind it.
      distanceM: 0.85,
      onConfirm: () => void lib.remove(row.id).catch((err) => console.error('[shell/projects] delete', err)),
    });
  };

  const fill = (p: ShellPanel) => {
    const lang = app.settings.lang.value;
    const lib = libraryOf(app);
    const busy = switching(app).value;
    const all = lib?.rows.value ?? [];
    const current = lib?.current.value ?? null;
    const view = pageOf(all, page);
    page = view.page;
    p.clear();
    p.setTitle(t('title'), t('kicker').toUpperCase());
    const inner = p.inner;
    let y = p.top;

    // New project: the panel's one main action.
    p.add(
      shellButton(app, { id: 'projects/new', w: inner, h: d(NEW_H), distanceM: D, onSelect: () => void newProject(app).then(() => close()) }, {
        label: t('newProject'),
        detail: t('newDetail'),
        icon: 'plus',
        layout: 'row',
        primary: true,
        disabled: busy || !lib,
      }),
      0,
      y - d(NEW_H) / 2,
    );
    y -= d(NEW_H) + d(12);

    // The line over the list: its kicker, or the empty, loading or storage state.
    const note = noteOf(lib?.state.value ?? null, all.length);
    const text = p.add(shellText({ w: inner, h: d(KICK_H), distanceM: D }), 0, y - d(KICK_H) / 2);
    text.set(note === 'yours' ? '' : t(note), note === 'yours' ? { kicker: t('yours') } : { role: 'body', colour: note === 'empty' || note === 'loading' ? MUTED : undefined, maxLines: 2 });
    y -= d(KICK_H);

    // The rows: open on the row, delete on the bin at its end.
    const binW = d(ROW_H);
    const rowW = inner - binW - d(GAP);
    view.rows.forEach((row, i) => {
      const cy = y - d(ROW_H) / 2;
      const isCurrent = row.id === current;
      const date = row.updatedAt.slice(0, 10);
      p.add(
        shellButton(app, { id: `projects/row-${i}`, w: rowW, h: d(ROW_H), distanceM: D, onSelect: () => void openProject(app, row.id).then(() => close()) }, {
          label: row.title,
          detail: isCurrent ? t('onBench') : [row.board, date].filter(Boolean).join(' · '),
          icon: isCurrent ? 'wrench' : 'folder',
          layout: 'row',
          selected: isCurrent,
          disabled: busy,
        }),
        -inner / 2 + rowW / 2,
        cy,
      );
      p.add(
        shellButton(app, { id: `projects/delete-${i}`, w: binW, h: d(ROW_H), distanceM: D, onSelect: () => askDelete(row, isCurrent) }, { label: '', icon: 'trash', disabled: busy }),
        inner / 2 - binW / 2,
        cy,
      );
      y -= d(ROW_H) + d(GAP);
    });

    // More and Back when there is more than one page.
    if (view.pages > 1) {
      const last = view.page >= view.pages - 1;
      const fy = p.top - d(NEW_H + 12 + KICK_H) - 5 * d(ROW_H) - 4 * d(GAP) - d(12) - d(FOOT_H) / 2;
      p.add(
        shellButton(
          app,
          {
            id: 'projects/page',
            w: inner,
            h: d(FOOT_H),
            distanceM: D,
            onSelect: () => {
              page = last ? 0 : view.page + 1;
              schedule();
            },
          },
          { label: last ? say(KIT, lang, 'back') : t('more'), detail: t('page', { n: view.page + 1, m: view.pages }), icon: 'dots', layout: 'row' },
        ),
        0,
        fy,
      );
    }
  };

  const ensure = (): ShellPanel => {
    if (panel) return panel;
    panel = shellPanel(app, { id: 'projects', w: d(W), h: d(H), distanceM: D, title: t('title'), kicker: t('kicker').toUpperCase(), icon: 'folder', onClose: () => close() });
    return panel;
  };

  /** Redraws on the next tick, never inside a button's own handler. */
  const render = () => {
    timer = null;
    if (isOpen && panel) fill(panel);
  };
  const schedule = () => {
    if (isOpen && timer === null) timer = setTimeout(render, 0);
  };

  const open = () => {
    claimFocus(app, 'projects');
    const p = ensure();
    if (!isOpen) {
      page = 0;
      placeAhead(app.world, p.group, { distance: D, belowDeg: 8 });
    }
    isOpen = true;
    fill(p);
    p.open();
    for (const off of watchers) off();
    const lib = libraryOf(app);
    watchers = [app.settings.lang.subscribe(schedule), switching(app).subscribe(schedule), ...(lib ? [lib.rows.subscribe(schedule), lib.current.subscribe(schedule), lib.state.subscribe(schedule)] : [])];
  };

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    for (const off of watchers.splice(0)) off();
    if (timer !== null) clearTimeout(timer);
    timer = null;
    panel?.close();
  }

  const offs = [providePanel(app, 'projects', open), onFocusLost(app, 'projects', () => close())];
  return () => {
    for (const off of offs) off();
    close();
    panel?.dispose();
    panel = null;
  };
}

export const projectsModule: FeatureModule = {
  id: 'shell/projects',
  mount: mountProjects,
};
