/**
 * The finding card: an inked paper card that stands beside a pin with the title, Why and Fix of the finding, a "Fix it"
 * plate when a fix has a plan, and a close plate. One at a time. It is built with the run kit (an inked slab, a canvas
 * face, plate buttons) and opens and closes with the look kit's panel moves.
 */
import { Group, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Lang, Vec3 } from '../../contracts/common';
import { fitLines, paintIcon, paintKicker, useFont } from '../../look/paint';
import { panelClose, panelOpen } from '../../look/moves';
import { CHAR, PAPER, TONE_INK } from '../../look/palette';
import { TYPE as LOOK_TYPE } from '../../look/type';
import { canvasFace } from '../kit/face';
import { faceViewer } from '../kit/chip';
import { inkShadow, inkSolid, roundedSlab } from '../kit/ink';
import { bindPlate, plateButton, type Plate } from '../kit/plate';
import { dmm, INK } from '../kit/tokens';
import { onTick } from '../kit/ticker';
import { runFeedback } from '../kit/feedback';
import { appliable, applyFix, fixDepsOf, fixesOf } from './fix';
import { toneOf, type PinSpec } from './static';
import { burntReason, findingAdvice, findingStrings, findingTitle, findingWhy, fixText } from './strings';

/** What the card shows, already in the person's language. */
export interface CardModel {
  readonly kicker: string;
  readonly severity: PinSpec['severity'];
  readonly title: string;
  readonly why: string;
  readonly fixes: readonly string[];
  /** The index of the fix the Fix it plate applies, or -1. */
  readonly plan: number;
  readonly status: string;
}

export const CARD_DISTANCE = 0.65;
/** Width in dmm; the shadow plate adds 6. */
export const CARD_W_DMM = 340;
const PAD = 16;
const PLATE_ROW = 82;

/** The text of a card for a pin, from iynk's rules; the fixes are worked out against the document now. */
export function modelOf(app: Pick<XrApp, 'project'>, spec: PinSpec, lang: Lang, status = ''): CardModel {
  const S = findingStrings;
  const where = spec.origin === 'static' ? S.t(lang, 'while-editing') : S.t(lang, 'from-run');
  const kicker = `${S.t(lang, spec.severity)} · ${where}`;
  if (spec.burnt) {
    const name = spec.burnt.why.args.name ?? spec.burnt.part;
    return { kicker, severity: spec.severity, title: S.t(lang, 'burnt', { name }), why: burntReason(lang, spec.burnt.why), fixes: [], plan: -1, status };
  }
  const f = spec.finding!;
  const resolved = fixesOf(app.project.doc, f, fixDepsOf(app.project));
  const lines = resolved.map((x) => fixText(lang, x.messageKey, x.args)).filter((t) => t !== '');
  const advice = findingAdvice(lang, f);
  const fixes = lines.length > 0 ? lines : advice ? [advice] : [S.t(lang, 'by-hand')];
  return { kicker, severity: spec.severity, title: findingTitle(lang, f), why: findingWhy(lang, f), fixes: fixes.slice(0, 3), plan: appliable(resolved), status };
}

type Ctx = CanvasRenderingContext2D;

const BODY = { ...LOOK_TYPE.body, weight: 500 as const };

/** Lays out a card in `u` pixels per dmm; paints when `paint` is true. Returns the height of the content, in dmm. */
export function paintCard(g: Ctx, m: CardModel, u: number, paint: boolean, labels: { why: string; fix: string }): number {
  const left = PAD * u;
  const width = (CARD_W_DMM - 2 * PAD) * u;
  let y = PAD * u;
  const tone = TONE_INK[toneOf(m.severity)];
  // kicker row with the severity icon
  const icon = 22 * u;
  if (paint) {
    paintIcon(g, m.severity === 'note' ? 'info' : 'warning', left, y, icon, tone);
    paintKicker(g, m.kicker, left + icon + 8 * u, y + icon / 2, LOOK_TYPE.kicker.size * u, CHAR);
  }
  y += icon + 10 * u;
  const block = (text: string, role: typeof BODY | typeof LOOK_TYPE.title, size: number, maxLines: number, colour: string) => {
    const fit = fitLines(g, text, { role, size: size * u, minSize: Math.max(18, size * 0.85) * u, maxWidth: width, maxLines });
    if (paint) {
      useFont(g, role, fit.size, text);
      g.fillStyle = colour;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      fit.lines.forEach((line, i) => g.fillText(line, left, y + fit.lineHeight * (i + 0.5)));
    }
    y += fit.lineHeight * fit.lines.length;
  };
  block(m.title, LOOK_TYPE.title, LOOK_TYPE.title.size, 2, INK.ink);
  y += 10 * u;
  if (m.why) {
    if (paint) paintKicker(g, labels.why, left, y + 9 * u, 18 * u, CHAR);
    y += 22 * u;
    block(m.why, BODY, LOOK_TYPE.body.size, 5, INK.ink);
    y += 10 * u;
  }
  if (m.fixes.length > 0) {
    if (paint) paintKicker(g, labels.fix, left, y + 9 * u, 18 * u, CHAR);
    y += 22 * u;
    for (const line of m.fixes) {
      block(line, BODY, LOOK_TYPE.body.size, 4, INK.ink);
      y += 6 * u;
    }
  }
  if (m.status) {
    y += 4 * u;
    block(m.status, BODY, LOOK_TYPE.body.size, 2, INK.good);
  }
  return y / u + PAD;
}

export interface Card {
  /** Opens (or replaces) the card for a pin, standing above `anchor` (world). */
  open(spec: PinSpec, anchor: Vec3): void;
  close(): void;
  /** The pin the card shows, or null. */
  readonly current: PinSpec | null;
  /** Draws it again (language or document changed). */
  refresh(): void;
  /** Draw calls of the open card. */
  readonly drawCalls: number;
  dispose(): void;
}

export interface CardHooks {
  /** A fix was applied (the pin goes with the next check). */
  onFixed(spec: PinSpec): void;
  onClosed(): void;
}

export function createCard(app: XrApp, root: Object3D, hooks: CardHooks): Card {
  const fb = runFeedback(app);
  const group = new Group();
  group.name = 'findings:card';
  group.visible = false;
  root.add(group);
  let spec: PinSpec | null = null;
  let anchor: Vec3 = [0, 0, 0];
  let status = '';
  let parts: { dispose(): void }[] = [];
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let calls = 0;
  const lang = () => app.settings.lang.value;

  const teardown = () => {
    for (const p of parts) p.dispose();
    parts = [];
    group.clear();
    calls = 0;
  };

  const build = () => {
    teardown();
    if (!spec) return;
    const l = lang();
    const model = modelOf(app, spec, l, status);
    const S = findingStrings;
    const labels = { why: S.t(l, 'why'), fix: S.t(l, 'fix') };
    const u = 2; // texels per dmm of the face
    const probe = document.createElement('canvas').getContext('2d')!;
    const content = paintCard(probe, model, u, false, labels);
    const hDmm = content + PLATE_ROW;
    const w = dmm(CARD_W_DMM, CARD_DISTANCE);
    const h = dmm(hDmm, CARD_DISTANCE);
    const radius = dmm(12, CARD_DISTANCE);
    const thick = dmm(6, CARD_DISTANCE);

    const solid = inkSolid(roundedSlab(w, h, thick, radius), PAPER);
    const slab = new Group();
    slab.add(solid.group);
    const shadow = inkShadow(w, h, radius);
    shadow.raycast = () => undefined;
    shadow.position.set(dmm(6, CARD_DISTANCE), -dmm(1, CARD_DISTANCE), dmm(6, CARD_DISTANCE));
    slab.add(shadow);
    const face = canvasFace(w * 0.98, h * 0.98, { distanceM: CARD_DISTANCE, up: true, radius: radius * 0.9 });
    face.mesh.position.y = thick + 0.0003;
    solid.body.add(face.mesh);
    slab.rotation.x = Math.PI / 2;
    group.add(slab);
    // The slab lies on its back: after the turn its top is the card's face and its z runs down the card.
    slab.position.set(0, 0, 0);
    face.draw(JSON.stringify([model, l]), (g, W) => paintCard(g, model, W / (CARD_W_DMM * 0.98), true, labels));

    const plateH = dmm(64, CARD_DISTANCE);
    const row = -h / 2 + dmm(PLATE_ROW / 2 + 1, CARD_DISTANCE);
    const unbinds: (() => void)[] = [];
    const doClose = () => {
      fb.play('ui-press');
      api.close();
    };
    const closeW = dmm(120, CARD_DISTANCE);
    const closePlate: Plate = plateButton(app, { w: closeW, d: plateH, standing: true, distanceM: CARD_DISTANCE }, { icon: 'close', label: S.t(l, 'close'), lang: l });
    closePlate.group.position.set(w / 2 - PAD_M() - closeW / 2, row, thick + 0.002);
    group.add(closePlate.group);
    unbinds.push(bindPlate(app, closePlate, 'finding:close', doClose));
    parts.push(closePlate);
    let plates = 1;
    if (model.plan >= 0 && !status) {
      const fixW = dmm(120, CARD_DISTANCE);
      const fixPlate = plateButton(app, { w: fixW, d: plateH, standing: true, primary: true, distanceM: CARD_DISTANCE }, { icon: 'pass', label: S.t(l, 'fix-it'), lang: l });
      fixPlate.group.position.set(w / 2 - PAD_M() - closeW - dmm(12, CARD_DISTANCE) - fixW / 2, row, thick + 0.002);
      group.add(fixPlate.group);
      unbinds.push(bindPlate(app, fixPlate, 'finding:fix', () => applyPlan(model.plan)));
      parts.push(fixPlate);
      plates++;
    }
    parts.push({ dispose: () => unbinds.forEach((u2) => u2()) }, face, solid, { dispose: () => shadow.geometry.dispose() });
    // slab 2 draws (outline, body), face 1, shadow 1, plates about 4 each
    calls = 4 + plates * 4;
    group.userData.height = h;
  };

  const PAD_M = () => dmm(PAD, CARD_DISTANCE);

  const place = () => {
    if (!spec) return;
    const h = (group.userData.height as number | undefined) ?? 0.2;
    group.position.set(anchor[0], anchor[1] + 0.03 + h / 2, anchor[2]);
  };

  const applyPlan = (index: number) => {
    if (!spec?.finding) return;
    const l = lang();
    const f = spec.finding;
    const label = `${findingStrings.t(l, 'fix')}: ${findingTitle(l, f)}`;
    const out = applyFix(app.project, f, index, label);
    if (out.ok) {
      fb.play('check-pass', anchor);
      status = findingStrings.t(l, 'fixed');
      hooks.onFixed(spec);
      build();
      place();
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(() => api.close(), 1800);
    } else {
      fb.play('check-fail', anchor);
      status = findingStrings.t(l, 'fix-failed');
      build();
      place();
    }
  };

  const offTick = onTick(app.world, () => {
    if (group.visible) faceViewer(group, app.world.camera, Math.PI / 8);
  });

  const api: Card = {
    open(next, at) {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = null;
      spec = next;
      anchor = at;
      status = '';
      build();
      place();
      group.visible = true;
      panelOpen(app.world, group);
    },
    close() {
      if (!spec) return;
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = null;
      spec = null;
      panelClose(app.world, group, undefined, () => {
        if (!spec) teardown();
      });
      hooks.onClosed();
    },
    get current() {
      return spec;
    },
    refresh() {
      if (!spec) return;
      build();
      place();
    },
    get drawCalls() {
      return spec ? calls : 0;
    },
    dispose() {
      if (closeTimer) clearTimeout(closeTimer);
      offTick();
      teardown();
      group.removeFromParent();
    },
  };
  return api;
}
