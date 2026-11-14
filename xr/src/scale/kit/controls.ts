/**
 * Where the pillar's controls live, so each sub-module adds its own buttons without editing a shared file
 * (XR_DESIGN.md 2.3, 2.6, 9.1, 9.4):
 *
 *   rail   the front rail between the run cluster and the rail's end away from the dominant hand: Scale minus, the
 *          current step, Scale plus, Room size. Lying plates, poke and ray, 48 mm.
 *   panel  the Look inside panel: a standing paper panel in reach zone 3 (0.80 m, 16 degrees below eye level, 38 degrees
 *          away from the dominant hand), clear of the guide, the shelf and the tools rack, one column of wide rows for
 *          the ray (poke where it reaches): See-through, Take apart, Current flow, Inspect, Paper room.
 *
 *   const controls = scaleControls(app);
 *   const off = controls.add({
 *     id: 'zoom/minus', host: 'rail', order: 0, icon: 'minus',
 *     label: (lang) => tr(S, lang, 'smaller'),
 *     disabled: () => app.scale.workScale.value <= 1,
 *     watch: [app.scale.workScale],
 *     run: () => app.scale.stepWorkScale(-1),
 *   });
 *
 * Each control is redrawn when the language or one of its `watch` values changes. Everything sits on `app.bench.table`,
 * so it fades with the bench at Room size. Both hosts follow the posture and the dominant hand live.
 */
import { Group } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Lang, ReadonlyValue, Unsubscribe, Vec3 } from '../../contracts/common';
import type { InteractionEvent } from '../../contracts/input';
import type { IconName } from '../../look/icons';
import { paintText } from '../../look/paint';
import { MUTED, PAPER } from '../../look/palette';
import { dmm, TYPE } from '../../look/type';
import { bindPlate, scalePlate, type Plate } from './plate';
import { tr, type Strings } from './text';
import { benchLayout, canvasFace, inkShadow, inkSolid, roundedSlab, type BenchLayout } from './ui';

export type ControlHost = 'rail' | 'panel';

export interface ScaleControl {
  /** `zoom/minus`, `insight/see-through`: the bound id and the key for replacing a control. */
  readonly id: string;
  readonly host: ControlHost;
  /** Reading order: left to right on the rail, top to bottom on the panel. */
  readonly order: number;
  readonly icon: IconName | null;
  label(lang: Lang): string;
  /** A large readout in place of the icon ("3x"). */
  value?(lang: Lang): string | null;
  /** A switch that is on. */
  latched?(): boolean;
  /** Calls for attention (Room size at 6x). */
  lit?(): boolean;
  disabled?(): boolean;
  /** Left out of the layout (Paper room when the room cannot switch). */
  hidden?(): boolean;
  /** Values that change what the control shows. */
  readonly watch?: readonly ReadonlyValue<unknown>[];
  run(e: InteractionEvent): void;
}

export interface ScaleControls {
  /** Adds a control, replacing one with the same id. Returns its removal. */
  add(control: ScaleControl): Unsubscribe;
}

/* ---------- layout (pure) ---------- */

export const RAIL_PLATE = { w: 0.048, d: 0.048 } as const;
export const RAIL_GAP = 0.012;
/** The run cluster's half width on the rail (run/kit/layout `clusterHalfW`) and the clearance from it. */
const CLUSTER_HALF = 0.15;
const CLUSTER_CLEAR = 0.016;

/**
 * Rail x of each of `count` plates in reading order, left to right, on the side away from the dominant hand: the group
 * starts next to the run cluster and grows towards the rail's end, so "- 3x +" reads the same way for either hand.
 */
export function railXs(count: number, d: 1 | -1): number[] {
  const xs: number[] = [];
  for (let i = 0; i < count; i++) xs.push(-d * (CLUSTER_HALF + CLUSTER_CLEAR + RAIL_PLATE.w / 2 + i * (RAIL_PLATE.w + RAIL_GAP)));
  return xs.sort((a, b) => a - b);
}

/** The panel: one column of rows (icon and label side by side), 40 dmm tall at 0.8 m and wider than the 56 dmm hit. */
export const PANEL = { rowW: 0.15, rowH: 0.044, gap: 0.01, pad: 0.016, title: 0.036, distance: 0.8, down: 16, away: 38 } as const;

export interface PanelGrid {
  readonly w: number;
  readonly h: number;
  /** Cell centres from the panel centre: x to the right, y up. */
  readonly cells: readonly (readonly [number, number])[];
}

/** The Look inside panel's size and its rows for `count` controls, title on top. */
export function panelGrid(count: number): PanelGrid {
  const { rowW, rowH, gap, pad, title } = PANEL;
  const rows = Math.max(1, count);
  const w = pad * 2 + rowW;
  const h = pad * 2 + title + rows * rowH + (rows - 1) * gap;
  const cells: [number, number][] = [];
  for (let i = 0; i < count; i++) cells.push([0, h / 2 - pad - title - rowH / 2 - i * (rowH + gap)]);
  return { w, h, cells };
}

/** Where the panel stands in the table frame, turned to face the eyes (apply as rotation (tilt, yaw, 0, 'YXZ')). */
export function panelSpot(layout: Pick<BenchLayout, 'eye' | 'd'>): { position: Vec3; tiltRad: number; yawRad: number } {
  const DEG = Math.PI / 180;
  const side = -layout.d * PANEL.away;
  const flat = Math.cos(PANEL.down * DEG) * PANEL.distance;
  const e = layout.eye;
  return {
    position: [e[0] + Math.sin(side * DEG) * flat, e[1] - Math.sin(PANEL.down * DEG) * PANEL.distance, e[2] - Math.cos(side * DEG) * flat],
    tiltRad: -PANEL.down * DEG,
    yawRad: -side * DEG,
  };
}

const TITLE = {
  en: { title: 'Look inside' },
  de: { title: 'Hineinschauen' },
  es: { title: 'Mirar dentro' },
  fr: { title: 'Voir dedans' },
  hi: { title: 'अंदर देखें' },
  zh: { title: '看看里面' },
} as const satisfies Strings<'title'>;
export const CONTROL_STRINGS = TITLE;

/* ---------- the hosts ---------- */

interface Entry {
  control: ScaleControl;
  plate: Plate;
  unbind: Unsubscribe;
  unwatch: Unsubscribe[];
}

const hosts = new WeakMap<XrApp, ScaleControls>();

/** The pillar's control hosts for this app (one per app, built on the first control and removed with the last). */
export function scaleControls(app: XrApp): ScaleControls {
  let h = hosts.get(app);
  if (!h) {
    h = createHosts(app, () => hosts.delete(app));
    hosts.set(app, h);
  }
  return h;
}

function createHosts(app: XrApp, onEmpty: () => void): ScaleControls {
  const entries = new Map<string, Entry>();
  const lang = () => app.settings.lang.value;

  const rail = new Group();
  rail.name = 'scale:rail';
  const panel = new Group();
  panel.name = 'scale:panel';
  const standing = new Group();
  standing.rotation.x = Math.PI / 2;
  panel.add(standing);
  app.bench.table.add(rail, panel);

  // The panel's own slab, shadow and title, rebuilt when its size changes.
  let back: { dispose(): void } | null = null;
  let backKey = '';
  const buildBack = (grid: PanelGrid) => {
    const key = `${grid.w.toFixed(3)}x${grid.h.toFixed(3)}:${lang()}`;
    if (key === backKey) return;
    backKey = key;
    back?.dispose();
    const t = 0.01;
    const r = dmm(12, PANEL.distance);
    const slab = inkSolid(roundedSlab(grid.w, grid.h, t, r), PAPER);
    slab.body.raycast = () => undefined;
    slab.outline.raycast = () => undefined;
    const shadow = inkShadow(grid.w, grid.h, r);
    shadow.raycast = () => undefined;
    // Standing: local x right, local -z up, local +y towards the viewer. The shadow plate sits 6 dmm right and down, 5 mm behind.
    shadow.position.set(dmm(6, PANEL.distance), -0.005, dmm(6, PANEL.distance));
    const titleW = grid.w - PANEL.pad * 2;
    const face = canvasFace(titleW, PANEL.title, { distanceM: PANEL.distance, up: true });
    face.mesh.position.set(0, t + 0.0003, -grid.h / 2 + PANEL.pad + PANEL.title / 2);
    face.draw(key, (g, _w, hp) => {
      paintText(g, tr(TITLE, lang(), 'title'), 0, hp / 2, TYPE.kicker, dmm(TYPE.kicker.size, PANEL.distance) * face.pxPerM, MUTED, 'left');
    });
    standing.add(slab.group, shadow, face.mesh);
    back = {
      dispose() {
        slab.dispose();
        shadow.geometry.dispose();
        face.dispose();
        slab.group.removeFromParent();
        shadow.removeFromParent();
        face.mesh.removeFromParent();
      },
    };
  };

  const draw = (e: Entry) => {
    const c = e.control;
    const l = lang();
    const hidden = c.hidden?.() ?? false;
    e.plate.set({
      icon: c.icon,
      label: c.label(l),
      value: c.value?.(l) ?? null,
      latched: c.latched?.() ?? false,
      lit: c.lit?.() ?? false,
      disabled: hidden || (c.disabled?.() ?? false),
    });
    e.plate.group.visible = !hidden;
  };

  let laidOut = '';
  const layout = () => {
    const xr = app.settings.xr.value;
    const bl = benchLayout(xr.posture, xr.dominantHand);
    const visible = (host: ControlHost) =>
      [...entries.values()].filter((e) => e.control.host === host && !(e.control.hidden?.() ?? false)).sort((a, b) => a.control.order - b.control.order);
    const onRail = visible('rail');
    const onPanel = visible('panel');
    const key = `${xr.posture}:${xr.dominantHand}:${onRail.map((e) => e.control.id).join()}|${onPanel.map((e) => e.control.id).join()}:${lang()}`;
    if (key === laidOut) return;
    laidOut = key;

    const c = bl.cluster;
    rail.position.set(0, c.position[1], c.position[2]);
    rail.rotation.set(c.tiltRad, c.yawRad, 0, 'YXZ');
    railXs(onRail.length, bl.d).forEach((x, i) => onRail[i]!.plate.group.position.set(x, 0, 0));

    panel.visible = onPanel.length > 0;
    if (onPanel.length > 0) {
      const spot = panelSpot(bl);
      panel.position.set(...spot.position);
      panel.rotation.set(spot.tiltRad, spot.yawRad, 0, 'YXZ');
      const grid = panelGrid(onPanel.length);
      buildBack(grid);
      // Plates stand on the slab's face: cell (x, y up) is local (x, slab top, -y).
      grid.cells.forEach(([x, y], i) => onPanel[i]!.plate.group.position.set(x, 0.01, -y));
    }
  };

  const offLang = app.settings.lang.subscribe(() => {
    for (const e of entries.values()) draw(e);
    layout();
  });
  const offXr = app.settings.xr.subscribe(() => layout());

  const dispose = () => {
    offLang();
    offXr();
    back?.dispose();
    rail.removeFromParent();
    panel.removeFromParent();
    onEmpty();
  };

  const remove = (id: string, entry: Entry) => {
    if (entries.get(id) !== entry) return;
    entries.delete(id);
    entry.unbind();
    for (const u of entry.unwatch) u();
    entry.plate.dispose();
    if (entries.size === 0) dispose();
    else layout();
  };

  return {
    add(control) {
      const old = entries.get(control.id);
      if (old) remove(control.id, old);
      const onPanel = control.host === 'panel';
      const plate = scalePlate(
        app,
        onPanel ? { w: PANEL.rowW, d: PANEL.rowH, distanceM: PANEL.distance, row: true } : { ...RAIL_PLATE },
        { icon: control.icon, label: control.label(lang()) },
      );
      plate.group.name = `scale:${control.id}`;
      (onPanel ? standing : rail).add(plate.group);
      const entry: Entry = { control, plate, unbind: () => undefined, unwatch: [] };
      entry.unbind = bindPlate(app, plate, control.id, (e) => control.run(e));
      entry.unwatch = (control.watch ?? []).map((v) =>
        v.subscribe(() => {
          draw(entry);
          layout();
        }),
      );
      entries.set(control.id, entry);
      draw(entry);
      layout();
      return () => remove(control.id, entry);
    },
  };
}
