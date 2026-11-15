/**
 * The catalogue panel (design 9.1, "Home, catalogue"): 0.80 x 0.50 m at 1.30 m, 8 degrees below eye level straight
 * ahead of the head when it opens, then left where it is (world placed, moved by its title bar, turned to the head).
 * Tabs Boards and Robotics; the list of boards or benches on the left with their progress; the picked one's rows on the
 * right, each row a whole button with a status icon; both paged to fit, no scrolling. Drawn into one canvas through
 * learn's kit; redrawn when progress, language, preferences or the open lesson change, never per frame.
 */
import { Vector3, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { buttonWidth, drawButton, roundRect, type ButtonFace, type DrawCtx } from '../kit/button';
import { onFrame } from '../kit/frame';
import { drawIcon } from '../kit/icons';
import { createPanel, type Region } from '../kit/panel';
import { prefs, prefsKey } from '../kit/prefs';
import { drawTabs, type TabFace } from '../kit/tabs';
import { drawText, type Box } from '../kit/text';
import { tokens, type Tokens } from '../kit/tokens';
import { lessonSlot } from '../launcher';
import { learnProgress } from '../progress';
import { catalogue as iynkCatalogue } from '../content/catalogue';
import { t, type CatalogueKey } from './strings';
import { buildView, focusPages, homeOf, type CatalogueTab, type CatalogueView, type ItemRow, type ListRow } from './view';

export const CATALOGUE_SIZE = { widthM: 0.8, heightM: 0.5 } as const;
/** Design 9.1: 1.30 m from the head, 8 degrees below eye level, straight ahead. */
export const CATALOGUE_PLACE = { distanceM: 1.3, belowDeg: 8 } as const;

const TAB_DMM = 40;
const PAGER_DMM = 36;
const NOTICE_DMM = 26;
const ROW_DMM = 52;
const GAP_DMM = 4;
const LIST_DMM = 220;
const COL_GAP_DMM = 12;
const LEVELS = new Set(['intro', 'io', 'input', 'analog', 'protocol', 'wireless', 'project']);

/** Turned this far toward the dominant hand while a lesson's guide is open, so the two do not overlap. */
export const BESIDE_GUIDE_DEG = 20;

/**
 * The world position for a panel in front of a head: straight ahead on the floor plane, a little below. `turnDeg`
 * turns the direction to the left (positive) or right (negative) first.
 */
export function catalogueSpot(head: Vector3, forward: Vector3, out: Vector3, turnDeg = 0): Vector3 {
  const flat = Math.hypot(forward.x, forward.z);
  let dx = flat < 1e-3 ? 0 : forward.x / flat;
  let dz = flat < 1e-3 ? -1 : forward.z / flat;
  if (turnDeg !== 0) {
    const yaw = Math.atan2(-dx, -dz) + (turnDeg * Math.PI) / 180;
    dx = -Math.sin(yaw);
    dz = -Math.cos(yaw);
  }
  const below = (CATALOGUE_PLACE.belowDeg * Math.PI) / 180;
  const d = CATALOGUE_PLACE.distanceM;
  return out.set(head.x + dx * Math.cos(below) * d, head.y - Math.sin(below) * d, head.z + dz * Math.cos(below) * d);
}

/** Mounts the panel for one showing of the catalogue; returns its teardown. */
export function createCataloguePanel(app: XrApp, lab: 'board' | 'robotics' | 'all'): Unsubscribe {
  const slot = lessonSlot(app);
  const progress = learnProgress(app);
  const cat = iynkCatalogue();
  const head = new Vector3();
  const fwd = new Vector3();
  const spot = new Vector3();
  const camera = app.world.camera;
  let moved = false;
  const panel = createPanel(app, {
    id: 'catalogue',
    ...CATALOGUE_SIZE,
    distanceM: CATALOGUE_PLACE.distanceM,
    onClose: () => app.lessons.hideCatalogue(),
    onMove: () => {
      moved = true;
    },
  });
  app.world.scene.add(panel.group);
  const P = panel.pxPerDmm;

  // ---- state: the tab, the pick on each tab and the two page indexes ----
  const currentId = () => slot.session.value?.state.value.templateId ?? null;
  const home = homeOf(cat, currentId());
  let tab: CatalogueTab = lab === 'robotics' ? 'robotics' : 'boards';
  const picked: Record<CatalogueTab, string | null> = { boards: null, robotics: null };
  if (home) picked[home.tab] = home.id;
  let listPage = 0;
  let page = 0;

  // ---- geometry: how many rows fit (the same on both sides) ----
  const rowPx = (scale: number) => ROW_DMM * scale * P;
  const rowsFit = (areaH: number, scale: number) => Math.max(1, Math.floor((areaH + GAP_DMM * P) / (rowPx(scale) + GAP_DMM * P)));
  const bodyH = (notice: boolean) => panel.content.h - (TAB_DMM + 8) * P - (notice ? NOTICE_DMM * P : 0) - (PAGER_DMM + 6) * P;
  const focus = () => {
    const f = focusPages(cat, tab, picked[tab], currentId(), rowsFit(bodyH(false), prefs(app).textScale), rowsFit(bodyH(false), prefs(app).textScale));
    listPage = f.listPage;
    page = f.page;
  };
  focus();

  const viewFor = (notice: boolean): CatalogueView => {
    const n = rowsFit(bodyH(notice), prefs(app).textScale);
    return buildView({ catalogue: cat, progress, lang: app.settings.lang.value, tab, picked: picked[tab], listPage, page, listSize: n, rowSize: n, currentId: currentId() });
  };

  const redraw = () => {
    const lang = app.settings.lang.value;
    const p = prefs(app);
    const k = tokens(p);
    const c: DrawCtx = { k, lang, pxPerDmm: P, textScale: p.textScale };
    // The notice row costs a row of room: take it only when a title on the page is in English for another language.
    let view = viewFor(false);
    const notice = view.fallback && lang !== 'en';
    if (notice) view = viewFor(true);
    listPage = view.list.page;
    page = view.items.page;
    picked[tab] = view.pickedId;
    const key = JSON.stringify([view, lang, prefsKey(p), notice]);
    panel.draw(key, c, { title: t(lang, 'title'), closeLabel: t(lang, 'close') }, (g) => drawBody(g, view, c, notice));
  };

  // ---- drawing ----
  const drawBody = (g: CanvasRenderingContext2D, view: CatalogueView, c: DrawCtx, notice: boolean): Region[] => {
    const { k, lang } = c;
    const area = panel.content;
    const regions: Region[] = [];
    const tabFaces: TabFace[] = [
      { id: 'boards', label: t(lang, 'tabBoards'), icon: 'steps' },
      { id: 'robotics', label: t(lang, 'tabRobotics'), icon: 'play' },
    ];
    const tabRects = drawTabs(g, { x: area.x, y: area.y, w: area.w, h: TAB_DMM * P }, tabFaces, tab, c);
    tabFaces.forEach((f, i) =>
      regions.push({
        id: `tab:${f.id}`,
        rect: tabRects[i]!,
        face: { label: f.label, icon: f.icon, kind: 'tab', active: f.id === tab },
        onSelect: () => {
          tab = f.id as CatalogueTab;
          focus();
          redraw();
        },
      }),
    );
    const top = area.y + (TAB_DMM + 8) * P;
    const bottom = area.y + area.h - (notice ? NOTICE_DMM * P : 0);
    const pagerY = bottom - PAGER_DMM * P;
    const listW = LIST_DMM * P;
    const itemsX = area.x + listW + COL_GAP_DMM * P;
    const itemsW = area.x + area.w - itemsX;
    const rowH = rowPx(c.textScale ?? 1);
    const gap = GAP_DMM * P;

    view.list.rows.forEach((r, i) => {
      const rect = { x: area.x, y: top + i * (rowH + gap), w: listW, h: rowH };
      drawListRow(g, rect, r, c);
      regions.push({
        id: `list:${r.id}`,
        rect,
        onSelect: () => {
          picked[tab] = r.id;
          page = 0;
          redraw();
        },
      });
    });
    view.items.rows.forEach((r, i) => {
      const rect = { x: itemsX, y: top + i * (rowH + gap), w: itemsW, h: rowH };
      drawItemRow(g, rect, r, c);
      regions.push({ id: `item:${r.templateId}`, rect, onSelect: () => pickItem(r.templateId) });
    });

    // Pagers: the list's as arrows, the rows' as Previous and Next.
    if (view.list.pages > 1) {
      const row = { x: area.x, y: pagerY, w: listW, h: PAGER_DMM * P };
      const b = 44 * P;
      const prev: ButtonFace = { label: t(lang, 'previous'), icon: 'back', iconOnly: true, kind: 'plain', disabled: view.list.page <= 0 };
      const next: ButtonFace = { label: t(lang, 'next'), icon: 'next', iconOnly: true, kind: 'plain', disabled: view.list.page >= view.list.pages - 1 };
      const pr = { x: row.x, y: row.y, w: b, h: row.h };
      const nr = { x: row.x + row.w - b, y: row.y, w: b, h: row.h };
      drawButton(g, pr, prev, c);
      drawButton(g, nr, next, c);
      drawText(g, t(lang, 'pageOf', { n: view.list.page + 1, total: view.list.pages }), { x: pr.x + b, y: row.y, w: row.w - 2 * b, h: row.h }, { role: 'caption', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 1, align: 'center', valign: 'middle' });
      regions.push(
        { id: 'list-prev', rect: pr, face: prev, disabled: prev.disabled, onSelect: () => ((listPage -= 1), redraw()) },
        { id: 'list-next', rect: nr, face: next, disabled: next.disabled, onSelect: () => ((listPage += 1), redraw()) },
      );
    }
    if (view.items.pages > 1) {
      const row = { x: itemsX, y: pagerY, w: itemsW, h: PAGER_DMM * P };
      const prev: ButtonFace = { label: t(lang, 'previous'), icon: 'back', kind: 'plain', disabled: view.items.page <= 0 };
      const next: ButtonFace = { label: t(lang, 'next'), icon: 'next', iconAfter: true, kind: 'plain', disabled: view.items.page >= view.items.pages - 1 };
      const pw = Math.max(110 * P, buttonWidth(g, prev, c));
      const nw = Math.max(110 * P, buttonWidth(g, next, c));
      const pr = { x: row.x, y: row.y, w: pw, h: row.h };
      const nr = { x: row.x + row.w - nw, y: row.y, w: nw, h: row.h };
      drawButton(g, pr, prev, c);
      drawButton(g, nr, next, c);
      drawText(g, t(lang, 'pageOf', { n: view.items.page + 1, total: view.items.pages }), { x: pr.x + pw, y: row.y, w: row.w - pw - nw, h: row.h }, { role: 'caption', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 1, align: 'center', valign: 'middle' });
      regions.push(
        { id: 'page-prev', rect: pr, face: prev, disabled: prev.disabled, onSelect: () => ((page -= 1), redraw()) },
        { id: 'page-next', rect: nr, face: next, disabled: next.disabled, onSelect: () => ((page += 1), redraw()) },
      );
    }
    if (notice) {
      const h = NOTICE_DMM * P;
      drawIcon(g, 'info', area.x + 11 * P, bottom + h / 2, 20 * P, k, k.info);
      drawText(g, t(lang, 'shownInEnglish'), { x: area.x + 28 * P, y: bottom, w: area.w - 28 * P, h }, { role: 'caption', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 1, valign: 'middle' });
    }
    return regions;
  };

  const plate = (g: CanvasRenderingContext2D, r: Box, fill: string, k: Tokens) => {
    const line = 2 * P * k.outline;
    roundRect(g, { x: r.x + line / 2, y: r.y + line / 2, w: r.w - line, h: r.h - line }, 8 * P);
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = line;
    g.strokeStyle = k.ink;
    g.stroke();
  };

  /** Two lines in a row: the title (label) over the detail (caption), from `x` to the right edge less `right`. */
  const twoLines = (g: CanvasRenderingContext2D, r: Box, x: number, right: number, title: string, detail: string, c: DrawCtx) => {
    const half = r.h / 2;
    const w = r.x + r.w - right - x;
    drawText(g, title, { x, y: r.y + 3 * P, w, h: half - 3 * P }, { role: 'label', lang: c.lang, pxPerDmm: P, colour: c.k.ink, textScale: c.textScale, maxLines: 1, valign: 'middle', weight: 600 });
    drawText(g, detail, { x, y: r.y + half, w, h: half - 3 * P }, { role: 'caption', lang: c.lang, pxPerDmm: P, colour: c.k.ink, textScale: c.textScale, maxLines: 1, valign: 'middle' });
  };

  const drawListRow = (g: CanvasRenderingContext2D, r: Box, row: ListRow, c: DrawCtx) => {
    plate(g, r, row.picked ? c.k.accent : c.k.paper, c.k);
    const word = t(c.lang, tab === 'boards' ? 'lessonsCount' : 'tasksCount', { done: row.done, total: row.total });
    twoLines(g, r, r.x + 12 * P, 8 * P, row.title, word, c);
  };

  const drawItemRow = (g: CanvasRenderingContext2D, r: Box, row: ItemRow, c: DrawCtx) => {
    const { k } = c;
    plate(g, r, row.current ? k.accent : k.paper, k);
    const cx = r.x + 24 * P;
    const cy = r.y + r.h / 2;
    const d = 26 * P;
    if (row.status === 'done') drawIcon(g, 'pass', cx, cy, d, k);
    else {
      drawIcon(g, 'idle', cx, cy, d, k);
      if (row.status === 'started') {
        g.beginPath();
        g.arc(cx, cy, (6.5 / 16) * d, Math.PI / 2, Math.PI * 1.5);
        g.closePath();
        g.fillStyle = k.ink;
        g.fill();
      }
    }
    const steps = row.stepCount > 0 ? t(c.lang, 'steps', { n: row.stepCount }) : '';
    const kind = row.kind === 'tour' ? t(c.lang, 'tour') : row.kind === 'bench' ? t(c.lang, 'bench') : row.kind === 'task' ? t(c.lang, 'task') : row.level && LEVELS.has(row.level) ? t(c.lang, `level.${row.level}` as CatalogueKey) : '';
    const detail = kind && steps ? `${kind} · ${steps}` : kind || steps;
    twoLines(g, r, r.x + 46 * P, row.current ? 40 * P : 8 * P, row.title, detail, c);
    // The lesson that is open now carries a play mark as well as the accent plate.
    if (row.current) drawIcon(g, 'play', r.x + r.w - 24 * P, cy, 24 * P, k);
  };

  const pickItem = (id: string) => {
    void app.lessons.open(id).catch((e: unknown) => console.warn('catalogue: could not open', id, e));
    app.lessons.hideCatalogue();
  };

  // ---- placement: in front of the head at open time (design 9.1), then where the person leaves it ----
  let placeIn = 2;
  const placeNow = () => {
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(head);
    camera.getWorldDirection(fwd);
    // The guide sits 15 degrees to the side away from the dominant hand: the catalogue goes to the hand's side of it.
    const turn = slot.session.value ? (app.settings.xr.value.dominantHand === 'left' ? BESIDE_GUIDE_DEG : -BESIDE_GUIDE_DEG) : 0;
    panel.group.position.copy(catalogueSpot(head, fwd, spot, turn));
    panel.group.updateMatrixWorld(true);
    panel.face(head);
  };
  const offFrame = onFrame(app.world, () => {
    camera.getWorldPosition(head);
    if (placeIn > 0 && --placeIn === 0 && !moved) placeNow();
    panel.face(head);
  });

  const offs: Unsubscribe[] = [
    progress.subscribe(redraw),
    app.settings.lang.subscribe(redraw),
    app.settings.shared.subscribe(redraw),
    app.settings.xr.subscribe(redraw),
    slot.session.subscribe(redraw),
  ];
  redraw();
  placeNow();

  return () => {
    offs.forEach((off) => off());
    offFrame();
    // The kit's `hits.dispose` takes the hit quads off the panel before `releaseEntities` looks for them, so IWSDK puts
    // them back under the level root. Note them first and finish the job here.
    const list: Object3D[] = [];
    panel.group.traverse((o) => void list.push(o));
    panel.dispose();
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i]!;
      const idx = (o as Object3D & { entityIdx?: number }).entityIdx;
      const e = idx === undefined ? undefined : app.world.entityManager.getEntityByIndex(idx);
      if (e && e.active && e.object3D === o) e.destroy();
      o.removeFromParent();
    }
  };
}
