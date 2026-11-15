/**
 * Parts shelf (design 2.3, 3.4): three tiers of four bins on side D of the bench, turned 20 degrees in, holding every
 * part and board of iynk's registry in six groups. Six group tabs and a pager stand on a header board behind the far
 * tier. Taking a part hands it to the edit module (`bins.ts`); the shelf follows the posture and hand live.
 *
 * The shelf's frame (`bench:shelf`), its bins and its plates live as long as the module does: the input service gives
 * everything bound (and its ancestors) an entity that keeps it in the scene, so these are moved and refilled, never
 * removed. Only the inked body is redrawn when the posture or the hand changes.
 */
import { Group } from '@iwsdk/core';
import type { FeatureModule } from '../../contracts/app';
import type { Lang } from '../../contracts/common';
import type { IconName } from '../../look/icons';
import { loadInk } from '../../look/ink';
import { benchGeometry } from '../core/geometry';
import { onLang, say } from '../core/text';
import { movable } from '../../ui/panels';
import { benchPlate, bindPlate, type Plate } from '../core/ui';
import { builtinRegistry } from '@/parts/builtin';
import { createBins } from './bins';
import { createShelfBody, headerFrontZ, headerRowY, HEADER, type ShelfBody } from './body';
import { GROUP_IDS, pageCount, pageOf, shelfEntries, type GroupId } from './groups';
import { shelfLayout } from './layout';
import { shelfStrings } from './strings';

const ICON: Record<GroupId, IconName> = { basics: 'puzzle', sensors: 'thermometer', output: 'lightbulb', motion: 'robot', power: 'battery', boards: 'cpu' };
const TAB = { w: 0.054, d: HEADER.rowH };
const COLUMNS = [-0.058, 0, 0.058] as const;

export const shelfModule: FeatureModule = {
  id: 'bench/shelf',
  mount(app) {
    const entries = shelfEntries(builtinRegistry());
    let group: GroupId = 'basics';
    let page = 0;
    let disposed = false;
    let ink: Awaited<ReturnType<typeof loadInk>> | undefined;
    let body: ShelfBody | null = null;
    let drawnFor = '';

    const shelf = new Group();
    shelf.name = 'bench:shelf';
    app.bench.table.add(shelf);
    const header = new Group();
    header.name = 'bench:shelf-header';
    shelf.add(header);
    const bins = createBins(app, shelf);
    // The grip bar on the shelf's front lip moves the whole shelf (flat on the bench, keeping its turn): its bins, tabs
    // and body are all children of `shelf`. Place and Tidy up are the shared ones (ui/panels).
    const grip = movable(app, { id: 'bench/shelf', group: shelf, width: 0.2, height: 0.05, distanceM: 0.4, flat: true });
    const offs: Array<() => void> = [];

    // ---- the tabs and the pager -----------------------------------------------------------------------------------
    const pages = () => pageCount(entries[group].length);
    const plates: Array<{ plate: Plate; text: ((lang: Lang) => string) | null }> = [];
    const add = (look: Parameters<typeof benchPlate>[2], row: number, col: number, text: ((lang: Lang) => string) | null): Plate => {
      const plate = benchPlate(app, { ...TAB, standing: true, distanceM: 0.4 }, look);
      plate.group.position.set(COLUMNS[col]!, headerRowY(row), 0);
      header.add(plate.group);
      plates.push({ plate, text });
      return plate;
    };
    const tabs: Plate[] = GROUP_IDS.map((id, i) => {
      const key = `shelf.${id}` as const;
      const plate = add({ icon: ICON[id], label: say(app, shelfStrings, key), latched: id === group }, Math.floor(i / 3), i % 3, (lang) => shelfStrings[lang][key]);
      offs.push(
        bindPlate(app, plate, `shelf/group:${id}`, () => {
          if (group === id) return;
          group = id;
          page = 0;
          refresh();
        }),
      );
      return plate;
    });
    const prev = add({ icon: 'arrowLeft', label: say(app, shelfStrings, 'shelf.prev') }, 2, 0, (lang) => shelfStrings[lang]['shelf.prev']);
    const mid = add({ icon: null, label: '', value: '1/1' }, 2, 1, null);
    const next = add({ icon: 'arrowRight', label: say(app, shelfStrings, 'shelf.next') }, 2, 2, (lang) => shelfStrings[lang]['shelf.next']);
    // The pager is bound only while a group has more than one page: a hidden plate still takes pokes, and a poke near
    // the breadboard's end would win over a pinch on a part.
    let pagerBound = false;
    let pagerOff: () => void = () => undefined;
    const bindPager = (on: boolean) => {
      pagerOff();
      pagerOff = () => undefined;
      if (!on) return;
      const a = bindPlate(app, prev, 'shelf/prev', () => {
        if (page === 0) return;
        page--;
        refresh();
      });
      const b = bindPlate(app, next, 'shelf/next', () => {
        if (page >= pages() - 1) return;
        page++;
        refresh();
      });
      pagerOff = () => {
        a();
        b();
      };
    };
    offs.push(
      () => pagerOff(),
      // the words follow the language
      onLang(app, (lang) => {
        for (const p of plates) if (p.text) p.plate.set({ label: p.text(lang) });
        refresh(false);
      }),
    );

    /** Redraws the tabs and the pager; `fill` also refills the bins. */
    function refresh(fill = true): void {
      page = Math.min(page, pages() - 1);
      GROUP_IDS.forEach((id, i) => tabs[i]!.set({ latched: id === group }));
      const many = pages() > 1;
      prev.group.visible = mid.group.visible = next.group.visible = many;
      if (many !== pagerBound) {
        pagerBound = many;
        bindPager(many);
      }
      mid.set({ value: say(app, shelfStrings, 'shelf.page', { page: page + 1, pages: pages() }) });
      prev.set({ disabled: page === 0 });
      next.set({ disabled: page >= pages() - 1 });
      if (fill) bins.show(pageOf(entries[group], page));
    }

    // ---- where it stands: the posture and the hand, live ----------------------------------------------------------
    const place = (): void => {
      const xr = app.settings.xr.value;
      const key = `${xr.posture}/${xr.dominantHand}/${ink === undefined ? 'wait' : 'ink'}`;
      if (key === drawnFor || disposed) return;
      drawnFor = key;
      const layout = shelfLayout(benchGeometry(xr.posture, xr.dominantHand));
      shelf.position.set(layout.x, 0, layout.z);
      shelf.rotation.y = layout.yaw;
      header.position.z = headerFrontZ(layout);
      body?.dispose();
      body = ink === undefined ? null : createShelfBody(ink, app.bench.table, shelf, layout);
      bins.layout(layout);
      // on the front lip, leaning back towards the eyes so it reads from standing
      grip.grip.position.set(0, 0.012, layout.d / 2 + 0.03);
      grip.grip.rotation.x = -0.9;
      refresh();
    };
    place();
    offs.push(app.settings.xr.subscribe(place));
    // the body is drawn in the ink material once it is loaded
    void loadInk().then((m) => {
      if (disposed) return;
      ink = m;
      place();
    });

    return () => {
      disposed = true;
      for (const off of offs) off();
      body?.dispose();
      grip.dispose();
      bins.dispose();
      shelf.visible = false;
    };
  },
};
