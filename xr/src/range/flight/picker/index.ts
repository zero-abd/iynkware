/**
 * The Range picker (issue #282): one panel to choose the craft, the course it flies, or a robot to drive. Starts
 * closed. It opens from the Drones home tile (on arriving in the Range), from the Craft plate in the room, and from a
 * menu row that exists only while the place is `range`. Picking a craft opens its template and the room re-enters;
 * picking a course sets the per-app choice the room reads. Recentring leaves and re-enters the place and does not open
 * it (only the tile's pending flag does, once).
 */
import { loadDrone as loadDroneContent } from '@/content/index.generated';
import { flightOf, type Course } from '@/lib/flight';
import type { Project } from '@/project/generated/types';
import { LAB_TEMPLATES } from '@content/projects';
import type { FeatureModule } from '../../../contracts/app';
import type { Lang, LocalizedText, Unsubscribe } from '../../../contracts/common';
import { LANGS, pickText } from '../../../contracts/common';
import { dmm } from '../../../look/type';
import { placeAhead, shellButton, shellPanel, shellText, type ShellPanel } from '../../../shell/kit';
import { claimFocus, onFocusLost } from '../../../shell/switch/focus';
import { rangeOf } from '../../activate';
import { convertedDrones, flightText, langOf, loadFlightText } from '../../shared';
import { courseChoiceOf, courseTitle, craftRows, lastCraftOf, pickCourse, pickerOpenOf, pickerPendingOf, type CraftRow } from './model';
import { PICKER_STRINGS as S } from './strings';

export * from './model';

const D = 1.0;
const W = 840;
const ROW = 84;
const GAP = 12;
const KICK = 30;
const COLS = 3;

const robotFiles = import.meta.glob<{ default: unknown }>('../../../../../content/projects/robots/*.project.json');
const ROBOTS = [
  { id: 'drive-base', key: 'driveBase' },
  { id: 'line-follower', key: 'lineFollower' },
  { id: 'speed-control', key: 'speedControl' },
] as const;

const localized = (key: 'menu'): LocalizedText => Object.fromEntries(LANGS.map((l) => [l, S.t(l, key)])) as LocalizedText;

const rowsOf = (n: number) => Math.max(1, Math.ceil(n / COLS));
/** Panel height in dmm for this many craft and course buttons: title bar, three sections, robots in one row. */
const heightOf = (crafts: number, courses: number) =>
  64 + 18 + 3 * (KICK + GAP) + (rowsOf(crafts) + rowsOf(courses) + 1) * (ROW + GAP) + 24;

export const pickerModule: FeatureModule = {
  id: 'range/flight/picker',
  mount(app) {
    const range = rangeOf(app);
    const open = pickerOpenOf(app);
    const pending = pickerPendingOf(app);
    const choice = courseChoiceOf(app);
    const last = lastCraftOf(app);
    let panel: ShellPanel | null = null;
    let panelH = 0;
    let crafts: CraftRow[] = [];
    let craftsLoaded: Promise<void> | null = null;
    let courses: readonly Course[] = [];
    let coursesFor = '';
    let text: Readonly<Record<string, unknown>> = {};
    let textLang: Lang | null = null;
    let busy = false;
    let epoch = 0;

    const current = () => {
      const p = range.value;
      return p?.kind === 'drone' ? p.contentId : null;
    };

    /** Craft list, the open craft's courses and the flight text, loaded as needed; then `then` runs if still wanted. */
    const load = async (): Promise<void> => {
      const mine = ++epoch;
      craftsLoaded ??= convertedDrones().then((ids) => {
        crafts = craftRows(ids, LAB_TEMPLATES);
      });
      const id = current();
      const lang = langOf(app);
      const [, content, messages] = await Promise.all([craftsLoaded, id ? loadDroneContent(id as Parameters<typeof loadDroneContent>[0]) : null, loadFlightText(lang)]);
      if (mine !== epoch) return;
      courses = content ? (flightOf(content)?.courses ?? []) : [];
      coursesFor = id ?? '';
      text = messages;
      textLang = lang;
    };

    const render = () => {
      const p = panel;
      if (!p || !open.value) return;
      const lang = langOf(app);
      p.setTitle(S.t(lang, 'title'), S.t(lang, 'kicker'));
      p.clear();
      const inner = p.inner;
      const gap = dmm(GAP, D);
      const col = (inner - (COLS - 1) * gap) / COLS;
      const rowH = dmm(ROW, D);
      const left = -inner / 2;
      let y = p.top;
      const kicker = (label: string) => {
        const k = p.add(shellText({ w: inner, h: dmm(KICK, D), distanceM: D }), 0, y - dmm(KICK, D) / 2 - dmm(2, D));
        k.set('', { kicker: label });
        y -= dmm(KICK + GAP, D);
      };
      const grid = (cells: Array<{ id: string; look: Parameters<typeof shellButton>[2]; run(): void }>) => {
        cells.forEach((c, i) => {
          const cx = left + (i % COLS) * (col + gap) + col / 2;
          const cy = y - Math.floor(i / COLS) * (rowH + gap) - rowH / 2;
          p.add(shellButton(app, { id: c.id, w: col, h: rowH, distanceM: D, onSelect: c.run }, c.look), cx, cy);
        });
        y -= rowsOf(cells.length) * (rowH + gap);
      };

      const now = current();
      kicker(S.t(lang, 'craft'));
      grid(
        crafts.map((c) => ({
          id: `range/picker/craft/${c.contentId}`,
          look: { label: pickText(c.title, lang) || c.contentId, detail: c.contentId === now ? S.t(lang, 'flying') : '', icon: 'drone', layout: 'row', selected: c.contentId === now, disabled: busy },
          run: () => void pickCraft(c),
        })),
      );

      kicker(S.t(lang, 'course'));
      const chosen = pickCourse(courses, choice.value)?.id ?? null;
      const resolve = (key: string) => (textLang === lang ? flightText(text, key) : key);
      grid(
        courses.map((c) => ({
          id: `range/picker/course/${c.id}`,
          look: { label: courseTitle(c, resolve), detail: c.id === chosen ? S.t(lang, 'flying') : '', icon: 'target', layout: 'row', selected: c.id === chosen },
          run: () => {
            choice.set(c.id);
            open.set(false);
          },
        })),
      );

      kicker(S.t(lang, 'robots'));
      grid(
        ROBOTS.map((r) => ({
          id: `range/picker/robot/${r.id}`,
          look: { label: S.t(lang, r.key), detail: S.t(lang, 'robotDetail'), icon: 'robot', layout: 'row', disabled: busy },
          run: () => void pickRobot(r.id),
        })),
      );
    };

    const pickCraft = async (c: CraftRow) => {
      if (busy || c.contentId === current()) return;
      busy = true;
      render();
      try {
        const doc = await app.templates.load(c.templateId);
        choice.set(null);
        app.project.open(doc);
      } finally {
        busy = false;
      }
    };

    const pickRobot = async (id: string) => {
      const load = robotFiles[`../../../../../content/projects/robots/${id}.project.json`];
      if (busy || !load) return;
      busy = true;
      render();
      try {
        const doc = (await load()).default as Project;
        app.project.open(doc);
        open.set(false);
        void app.shell.go('range');
      } finally {
        busy = false;
      }
    };

    const ensurePanel = () => {
      const h = heightOf(crafts.length, courses.length);
      if (panel && h === panelH) return panel;
      const old = panel;
      const p = shellPanel(app, {
        id: 'range-picker',
        w: dmm(W, D),
        h: dmm(h, D),
        distanceM: D,
        title: S.t(langOf(app), 'title'),
        kicker: S.t(langOf(app), 'kicker'),
        icon: 'drone',
        onClose: () => open.set(false),
      });
      if (old) {
        p.group.position.copy(old.group.position);
        p.group.quaternion.copy(old.group.quaternion);
        old.dispose();
      } else placeAhead(app.world, p.group, { distance: D, belowDeg: 8 });
      panel = p;
      panelH = h;
      return p;
    };

    const show = async () => {
      claimFocus(app, 'range/picker');
      await load();
      if (!open.value) return;
      const p = ensurePanel();
      if (!p.isOpen) placeAhead(app.world, p.group, { distance: D, belowDeg: 8 });
      render();
      p.open();
    };

    // when the craft or the language changes while open, reload and redraw (the panel may need another height)
    const refresh = async () => {
      if (!open.value) return;
      await load();
      if (!open.value) return;
      ensurePanel();
      render();
      panel?.open();
    };

    const offs: Unsubscribe[] = [
      onFocusLost(app, 'range/picker', () => open.set(false)),
      open.subscribe((o) => {
        if (o) void show();
        else panel?.close();
      }),
      range.subscribe((p) => {
        if (p?.kind === 'drone') last.set(p.contentId);
        void refresh();
      }),
      choice.subscribe(() => render()),
      app.settings.lang.subscribe(() => void refresh()),
    ];
    const seed = current();
    if (seed) last.set(seed);

    // the menu row exists only in the Range; arriving from the Drones tile opens the panel once
    let menuOff: Unsubscribe | null = null;
    const onPlace = (place: string) => {
      if (place === 'range') {
        menuOff ??= app.shell.addMenuItem({ id: 'range/picker', group: 'tools', label: localized('menu'), run: () => open.set(true) });
        if (pending.value) {
          pending.set(false);
          open.set(true);
        }
      } else {
        menuOff?.();
        menuOff = null;
        open.set(false);
      }
    };
    offs.push(app.shell.place.subscribe(onPlace));
    onPlace(app.shell.place.value);

    return () => {
      epoch++;
      for (const off of offs.splice(0)) off();
      menuOff?.();
      panel?.dispose();
      panel = null;
      open.set(false);
    };
  },
};
