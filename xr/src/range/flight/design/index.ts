/**
 * The drone's design panel on the bench (issue #164): a standing paper panel on the bench's left with the battery,
 * motor and prop as option plates (a pick is one `param.set` op, one undo), the calculator's numbers, the design
 * checks with their level, the arming checklist for the bench build and a primary Fly plate that goes to the range.
 *
 * It exists while the open project is a drone, the person is at the bench and has opened it from the menu's Drone design
 * row (it starts closed: the calm layout); it redraws only when the project or the
 * language changes (never per frame) and takes everything away when another project opens or the place leaves the bench.
 */
import { Group } from '@iwsdk/core';
import type { DroneContent } from '@/content/schema';
import { loadDrone as loadDroneContent } from '@/content/index.generated';
import { canArm } from '@/lib/dronelab/bench';
import type { FeatureModule, XrApp } from '../../../contracts/app';
import type { Lang, Unsubscribe } from '../../../contracts/common';
import { onFontsReady } from '../../../look/type';
import { releaseEntities } from '../../../learn/kit/entities';
import { canvasFace } from '../../../run/kit/face';
import { PAPER } from '../../../look/palette';
import { movable, openable, PANELS_COPY } from '../../../ui/panels';
import { value } from '../../../ui/value';
import { rangeOf } from '../../activate';
import { bindPlate, inkShadow, inkSolid, panelOpen, plateButton, roundedSlab, type Plate } from '../../shared';
import { benchArmRules, benchCraft, benchOf, benchReport, designView, pickOf, pickOp, type PickSlot } from '../model';
import { FLY, PANEL, PICK, pickRow, ROWS, shortLabel, SLOTS, toPanel } from './layout';
import { allGoodKey, checkRows, checklistRows, designLines, type Words } from './rows';
import { drawSheet, type SheetModel } from './sheet';
import { designStrings } from './strings';
import { loadDroneLabText, sayOf } from './text';

const OPTIONS = { batt: 'batts', motor: 'motors', prop: 'props' } as const;
const KICKERS = ['battery', 'motor', 'prop'] as const;

interface OptionPlate {
  readonly slot: PickSlot;
  readonly key: string;
  readonly label: string;
  readonly plate: Plate;
}

export interface DesignPanel {
  readonly group: Group;
  /** Draws the current project and language; `text` when the language changed. */
  refresh(text?: { lang: Lang; messages: Readonly<Record<string, unknown>> }): void;
  dispose(): void;
}

/** Builds the panel for a drone's content (not yet in the scene). `onClose` shows a Close beside its grip bar. */
export function createDesignPanel(
  app: XrApp,
  contentId: string,
  content: DroneContent,
  first: { lang: Lang; messages: Readonly<Record<string, unknown>> },
  onClose?: () => void,
): DesignPanel {
  let lang = first.lang;
  let say = sayOf(first.messages);
  let rev = 0;
  const offs: Unsubscribe[] = [];

  const root = new Group();
  root.name = 'range/design-panel';
  root.position.set(PANEL.x, PANEL.y, PANEL.z);
  root.rotation.y = PANEL.yaw;

  // the paper: an inked slab standing up, with the flat blue shadow plate behind it, down and to the right
  const stand = new Group();
  stand.rotation.x = Math.PI / 2;
  const radius = 0.012;
  const solid = inkSolid(roundedSlab(PANEL.w, PANEL.h, PANEL.thick, radius), PAPER);
  const shadow = inkShadow(PANEL.w, PANEL.h, radius);
  shadow.position.set(0.005, -0.0008, 0.005);
  shadow.raycast = () => undefined;
  stand.add(solid.group, shadow);
  root.add(stand);

  const face = canvasFace(PANEL.w, PANEL.h, { distanceM: PANEL.distanceM });
  face.mesh.position.z = PANEL.thick + 0.0003;
  root.add(face.mesh);
  // The shared grip bar moves it (ui/panels); on the top edge, since the sheet stands on the bench.
  const grip = movable(app, { id: 'range/design', group: root, width: PANEL.w, height: PANEL.h, distanceM: PANEL.distanceM, edge: 'top', z: PANEL.thick + 0.003, onClose });
  offs.push(() => grip.dispose());

  const plates: OptionPlate[] = [];
  SLOTS.forEach((slot, row) => {
    const options = Object.entries(content.design[OPTIONS[slot]] as Record<string, { label: string }>);
    pickRow(options.length, row).forEach((cell, i) => {
      const [key, opt] = options[i]!;
      const plate = plateButton(app, { w: cell.w, d: PICK.h, standing: true, distanceM: PANEL.distanceM }, { icon: null, label: shortLabel(opt.label), lang });
      const at = toPanel(cell.cx, cell.cy);
      plate.group.name = `design:${slot}:${key}`;
      plate.group.position.set(at.x, at.y, PANEL.thick);
      root.add(plate.group);
      plates.push({ slot, key, label: shortLabel(opt.label), plate });
      offs.push(
        bindPlate(app, plate, `range/design/${slot}/${key}`, () => {
          const op = pickOp(app.project.doc, slot, key);
          if (op) app.project.apply(op, { label: `${slot}: ${key}` });
        }),
      );
    });
  });

  const fly = plateButton(app, { w: FLY.w, d: FLY.h, standing: true, primary: true, distanceM: PANEL.distanceM }, { icon: 'run', label: designStrings.t(lang, 'fly'), lang });
  const flyAt = toPanel(FLY.cx, FLY.cy);
  fly.group.name = 'design:fly';
  fly.group.position.set(flyAt.x, flyAt.y, PANEL.thick);
  root.add(fly.group);
  offs.push(bindPlate(app, fly, 'range/design/fly', () => void app.shell.go('range')));

  const craft = benchCraft(contentId);

  const refresh: DesignPanel['refresh'] = (text) => {
    if (text) {
      lang = text.lang;
      say = sayOf(text.messages);
    }
    const doc = app.project.doc;
    const pick = pickOf(doc, content);
    const view = designView(content, pick);
    const rules = craft ? benchArmRules(content, benchReport(craft, benchOf(doc)), pick) : [];
    const armable = canArm(rules);
    const words: Words = { say, own: (key, params) => designStrings.t(lang, key, params) };

    for (const o of plates) o.plate.set({ latched: pick[o.slot] === o.key, lang });
    fly.set({ lang, label: designStrings.t(lang, 'fly'), badge: armable ? null : { text: designStrings.t(lang, 'willNotArm'), tone: 'warn' } });

    const model: SheetModel = {
      title: designStrings.t(lang, 'title'),
      kickers: KICKERS.map((k) => designStrings.t(lang, k)),
      lines: designLines(view, words),
      checks: checkRows(view, words, ROWS.checkMax),
      allGood: say(allGoodKey),
      rulesTitle: designStrings.t(lang, 'rules'),
      rules: checklistRows(rules, say, ROWS.ruleMax),
    };
    face.draw(`${lang}|${rev}|${JSON.stringify(model)}`, (g, w, h) => drawSheet(g, w, h, model));
    // for scripts and tests: what the panel says now
    root.userData.design = {
      pick,
      lines: model.lines.map((l) => [l.id, l.value]),
      checks: model.checks.map((c) => [c.code, c.level]),
      rules: model.rules.map((r) => [r.id, r.state]),
      canArm: armable,
    };
  };

  offs.push(
    onFontsReady(() => {
      rev++;
      refresh();
    }),
  );
  refresh();

  return {
    group: root,
    refresh,
    dispose() {
      for (const off of offs.splice(0)) off();
      // binding gave the plates and the panel IWSDK entities: destroy them, or IWSDK parents the pieces under the level root
      releaseEntities(app.world, root);
      for (const o of plates) o.plate.dispose();
      fly.dispose();
      face.dispose();
      solid.dispose();
      shadow.geometry.dispose();
      root.removeFromParent();
    },
  };
}

type DroneId = Parameters<typeof loadDroneContent>[0];

export const designModule: FeatureModule = {
  id: 'range/flight/design',
  mount(app) {
    const range = rangeOf(app);
    let current: { id: string; panel: DesignPanel } | null = null;
    let token = 0;
    const lang = () => app.settings.lang.value;

    /** The drone at the bench: a drone is open and the person is at the bench. */
    const here = (): string | null => {
      const r = range.value;
      return r && r.kind === 'drone' && app.shell.place.value === 'bench' ? r.contentId : null;
    };
    // The calm layout: the panel starts closed; the menu's Drone design row (there while a drone is at the bench) opens
    // it, and the Close beside its grip bar closes it again.
    const atBench = value(here() !== null);
    const design = openable(app, { id: 'range/design', label: PANELS_COPY.droneDesign, available: atBench });
    /** The drone id the panel belongs to now: a drone is at the bench and the person opened the panel. */
    const wanted = (): string | null => (design.open.value ? here() : null);

    const drop = () => {
      token++;
      current?.panel.dispose();
      current = null;
    };

    const sync = () => {
      atBench.set(here() !== null);
      const id = wanted();
      if (!id) {
        drop();
        return;
      }
      if (current?.id === id) return;
      drop();
      const mine = token;
      const l = lang();
      void Promise.all([loadDroneContent(id as DroneId), loadDroneLabText(l)]).then(([content, messages]) => {
        if (mine !== token || !content) return;
        const panel = createDesignPanel(app, id, content, { lang: lang(), messages }, () => design.set(false));
        app.bench.table.add(panel.group);
        panelOpen(app.world, panel.group);
        current = { id, panel };
        if (lang() !== l) void relang();
      });
    };

    let langSeq = 0;
    const relang = async () => {
      const l = lang();
      const mine = ++langSeq;
      const messages = await loadDroneLabText(l);
      if (mine === langSeq) current?.panel.refresh({ lang: l, messages });
    };

    sync();
    const offs = [
      range.subscribe(sync),
      app.shell.place.subscribe(sync),
      design.open.subscribe(sync),
      app.project.subscribe(() => current?.panel.refresh()),
      app.settings.lang.subscribe(() => void relang()),
    ];
    return () => {
      for (const off of offs) off();
      design.dispose();
      drop();
    };
  },
};
