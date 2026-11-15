/**
 * The proposal card beside the companion: what the co-builder proposes and why, how far along the build is, and the
 * five answers (Accept, Accept all, Skip, Undo, Stop). With no build running it folds down to one pill, "Build it with
 * me", the assistant's entry on the bench. `cardModel` is the pure part (what the card says for a session state);
 * `createCard` draws it with the look kit and routes the buttons to the session.
 */
import { CanvasTexture, Group, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import type { CoBuildSession, CoBuildState } from '../contracts/assistant';
import type { XrApp } from '../contracts/app';
import type { Lang, ReadonlyValue, Unsubscribe } from '../contracts/common';
import type { IconName } from '../look/icons';
import { panelClose, panelOpen, setPanelHit } from '../look/moves';
import { ACCENT, INK, MUTED } from '../look/palette';
import { fitLines, makeCanvas, paintKicker, paintPlate } from '../look/paint';
import { onFontsReady, TYPE } from '../look/type';
import { movable } from '../ui/panels';
import { say } from './copy';
import { createPlate, type Plate, type PlateLook } from './plate';
import { spotsOf } from './presence/spots';
import { uploadNow } from '../look/upload';

export type CardAction = 'accept' | 'acceptAll' | 'reject' | 'undo' | 'stop';

export interface CardModel {
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
  readonly progress: string;
  readonly buttons: Readonly<Record<CardAction, PlateLook>>;
}

const ICON: Record<CardAction, IconName> = { accept: 'check', acceptAll: 'play', reject: 'step', undo: 'undo', stop: 'stop' };

/** What the card shows for a session's state. */
export function cardModel(s: CoBuildState, lang: Lang): CardModel {
  const t = (k: Parameters<typeof say>[1], v?: Parameters<typeof say>[2]) => say(lang, k, v);
  const proposing = s.status === 'proposing';
  const performing = s.status === 'performing';
  const ended = s.status === 'done' || s.status === 'failed' || s.status === 'stopped';
  const step = s.current;
  const done = s.performed.length;
  let progress = '';
  if (step && s.plan) {
    const left = s.plan.steps.length - Math.max(0, s.plan.steps.indexOf(step));
    progress = t('stepOf', { n: done + 1, total: done + left });
  } else if (s.status === 'done' && done > 0) progress = t('stepOf', { n: done, total: done });
  const title = step && (proposing || performing) ? step.label : (s.plan?.summary ?? t('name'));
  const body =
    s.status === 'thinking' ? t('thinking') : proposing && step ? step.reason : performing && step ? t('performing', { label: step.label }) : (s.message ?? '');
  const b = (k: CardAction, enabled: boolean, extra: Partial<PlateLook> = {}): PlateLook => ({ label: t(k === 'stop' && ended ? 'close' : k), icon: ICON[k], enabled, ...extra });
  return {
    kicker: t('name'),
    title,
    body,
    progress,
    buttons: {
      accept: b('accept', proposing, { primary: true }),
      acceptAll: b('acceptAll', proposing, { active: s.auto }),
      // While a run of accept-all is moving, Skip and Undo stop the run after this step (the session's rule).
      reject: b('reject', proposing || (performing && s.auto)),
      undo: b('undo', ((proposing || s.status === 'done') && done > 0) || (performing && s.auto)),
      stop: b('stop', s.status !== 'stopped'),
    },
  };
}

/** Card and button sizes, metres (dmm read from about 0.55 m). */
const CARD = { w: 0.27, h: 0.118 };
const BTN = { h: 0.034, gap: 0.006 };
const PX_PER_M = 4 / (0.55 / 1000);

export interface CardHost extends Pick<XrApp, 'world' | 'input' | 'bench' | 'settings'> {}

export interface Card {
  readonly group: Group;
  dispose(): void;
}

/**
 * The card, on the bench table, watching `session` (the running build or null). `start` runs "Build it with me".
 * `offerPill` says when the folded pill shows with no build running (the calm layout: only on an empty bench); always,
 * when absent. The menu's Build it with me row is there either way.
 */
export function createCard(
  app: CardHost,
  session: { readonly value: CoBuildSession | null; subscribe(fn: (s: CoBuildSession | null) => void): Unsubscribe },
  start: () => void,
  offerPill?: ReadonlyValue<boolean>,
): Card {
  const lang = () => app.settings.lang.value;
  const group = new Group();
  group.name = 'assistant:card';
  const place = () => {
    const sp = spotsOf(app.settings.xr.value);
    group.position.copy(sp.card);
    group.rotation.order = 'YXZ';
    group.rotation.set(-sp.cardLean, sp.cardTurn, 0);
  };
  place();
  app.bench.table.add(group);

  // The card face: one canvas.
  const canvas = makeCanvas(CARD.w * PX_PER_M, CARD.h * PX_PER_M);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const faceMat = new MeshBasicMaterial({ map: tex, alphaTest: 0.5, toneMapped: false });
  const face = new Mesh(new PlaneGeometry(CARD.w, CARD.h), faceMat);
  face.name = 'assistant:card-face';
  const panel = new Group();
  panel.add(face);
  group.add(panel);

  const act = (a: CardAction) => {
    const s = session.value;
    if (!s) return;
    if (a === 'accept') void s.accept();
    else if (a === 'acceptAll') void s.acceptAll();
    else if (a === 'reject') void s.reject();
    else if (a === 'undo') void s.undo();
    else s.stop();
  };

  // Row one: Accept, Accept all. Row two: Skip, Undo, Stop.
  const wide = (CARD.w - BTN.gap) / 2;
  const narrow = (CARD.w - 2 * BTN.gap) / 3;
  const row1 = -CARD.h / 2 - BTN.gap - BTN.h / 2;
  const row2 = row1 - BTN.h - BTN.gap;
  const slots: Array<[CardAction, number, number, number]> = [
    ['accept', -CARD.w / 2 + wide / 2, row1, wide],
    ['acceptAll', CARD.w / 2 - wide / 2, row1, wide],
    ['reject', -CARD.w / 2 + narrow / 2, row2, narrow],
    ['undo', 0, row2, narrow],
    ['stop', CARD.w / 2 - narrow / 2, row2, narrow],
  ];
  const offs: Unsubscribe[] = [];
  const buttons = new Map<CardAction, Plate>();
  for (const [a, x, y, w] of slots) {
    const p = createPlate(app, a, { w, h: BTN.h }, () => act(a));
    p.mesh.position.set(x, y, 0.002);
    panel.add(p.mesh);
    offs.push(p.bind());
    buttons.set(a, p);
  }

  // The shared grip bar under the card and its buttons moves them (ui/panels); the entry pill stays on the bench.
  const top = CARD.h / 2;
  const bottom = row2 - BTN.h / 2;
  const grip = movable(app, { id: 'assistant/card', group: panel, width: CARD.w, height: top - bottom, centreY: (top + bottom) / 2, distanceM: 0.7, z: 0.004 });
  offs.push(() => grip.dispose());

  // The entry: one pill on its own when nothing is being built.
  const entry = createPlate(app, 'build-with-me', { w: 0.17, h: 0.045 }, start);
  entry.mesh.position.set(0, 0, 0.002);
  group.add(entry.mesh);
  offs.push(entry.bind());

  let model: CardModel | null = null;
  const drawFace = () => {
    const g = canvas.getContext('2d');
    if (!g || !model) return;
    const { width: w, height: h } = canvas;
    const px = (dmm: number) => dmm * 4; // 4 texels per dmm
    g.clearRect(0, 0, w, h);
    const shadow = px(6);
    paintPlate(g, 0, 0, w, h, { border: px(2.5), radius: px(12), shadow });
    const pad = px(16);
    const inner = w - shadow - 2 * pad;
    paintKicker(g, model.kicker, pad, pad + px(9), px(TYPE.kicker.size), ACCENT);
    if (model.progress) paintKicker(g, model.progress, w - shadow - pad, pad + px(9), px(TYPE.kicker.size), MUTED, 'right');
    const title = fitLines(g, model.title, { role: TYPE.title, size: px(TYPE.title.size), maxWidth: inner, maxLines: 1 });
    g.fillStyle = INK;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    let y = pad + px(24);
    for (const line of title.lines) {
      g.fillText(line, pad, y);
      y += title.lineHeight;
    }
    y += px(4);
    const body = fitLines(g, model.body, { role: { ...TYPE.body, weight: 500 }, size: px(TYPE.body.size), maxWidth: inner, maxLines: 3 });
    g.fillStyle = INK;
    for (const line of body.lines) {
      g.fillText(line, pad, y);
      y += body.lineHeight;
    }
    tex.needsUpdate = true;
    uploadNow(tex);
  };

  let stateOff: Unsubscribe | null = null;
  let open = false;
  const render = () => {
    const s = session.value;
    const running = s !== null && s.state.value.status !== 'stopped';
    entry.set({ label: say(lang(), 'menu'), icon: 'sparkle', enabled: !running, primary: true });
    const pill = !running && (offerPill?.value ?? true);
    entry.mesh.visible = pill;
    setPanelHit(entry.mesh, pill);
    if (running && s) {
      model = cardModel(s.state.value, lang());
      drawFace();
      for (const [a, p] of buttons) p.set(model.buttons[a]);
    }
    if (running && !open) {
      open = true;
      panelOpen(app.world, panel);
    } else if (!running && open) {
      open = false;
      panelClose(app.world, panel);
    } else if (!running) panel.visible = false;
  };

  const watch = (s: CoBuildSession | null) => {
    stateOff?.();
    stateOff = s ? s.state.subscribe(render) : null;
    render();
  };
  offs.push(session.subscribe(watch));
  watch(session.value);
  offs.push(app.settings.lang.subscribe(render));
  offs.push(app.settings.xr.subscribe(place));
  if (offerPill) offs.push(offerPill.subscribe(render));
  offs.push(
    onFontsReady(() => {
      drawFace();
      entry.refresh();
      for (const p of buttons.values()) p.refresh();
    }),
  );

  return {
    group,
    dispose() {
      stateOff?.();
      for (const off of offs.splice(0)) off();
      group.removeFromParent();
      for (const p of buttons.values()) p.dispose();
      entry.dispose();
      tex.dispose();
      faceMat.dispose();
      face.geometry.dispose();
    },
  };
}
