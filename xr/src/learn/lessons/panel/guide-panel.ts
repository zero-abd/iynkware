/**
 * The guide panel beside the bench (design 7 and 9.1): 0.52 x 0.40 m at 1.10 m, 12 degrees below eye level and 15
 * degrees away from the dominant hand, relative to the bench; moved by its title bar, kept 0.8 to 2.0 m away, always
 * turned to the head in yaw and pitch. Tabs Steps, Code (once `learn/code/` lands) and Checks, drawn through learn's kit
 * into one canvas: the panel is two draw calls at rest (plate and shadow), plus the code texture on the Code tab, a lift
 * plate under a hovered button, the running spinner and the off-view arrow while they show. While Home is open the guide
 * is hidden and takes no rays (the calm layout: Home alone), and it comes back when Home closes.
 */
import { CanvasTexture, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../../contracts/app';
import type { Unsubscribe } from '../../../contracts/common';
import { setPanelHit } from '../../../look/moves';
import { replayHighlights } from '../../callouts/bus';
import { buttonWidth, drawButton, type ButtonFace, type DrawCtx } from '../../kit/button';
import { onFrame } from '../../kit/frame';
import { drawIcon } from '../../kit/icons';
import { createPanel, type Region } from '../../kit/panel';
import { prefs, prefsKey } from '../../kit/prefs';
import { surface } from '../../kit/surface';
import { drawTabs, tabRects, type TabFace } from '../../kit/tabs';
import { tokens } from '../../kit/tokens';
import { pick } from '../../text';
import type { LessonSession, StepState } from '../../types';
import { arrowSpot, outOfView, type ArrowSpot } from './arrow';
import { drawChecksTab } from './checks-tab';
import { createCodeTab } from './code-tab';
import { ringSpot } from '../../../bench/core/ring';
import { GUIDE_PLACE, clampDistance } from './placement';
import { hasNext } from './quiz-card';
import { nextHint, stepsCard, type QuizReview } from './finish';
import { drawStepsTab, type StepsFinish } from './steps-tab';
import { t } from './strings';

export type GuideTab = 'steps' | 'code' | 'checks';

export const GUIDE_SIZE = { widthM: 0.52, heightM: 0.4 } as const;
const TICK_MS = 400;
const TAB_DMM = 40;
const ARROW_DMM = 40;
const MAX_SPINNERS = 12;
const MAX_TARGETS = 8;

/** Mounts the panel for one session; returns its teardown. */
export function createGuidePanel(app: XrApp, session: LessonSession): Unsubscribe {
  const head = new Vector3();
  const panel = createPanel(app, {
    id: 'guide',
    ...GUIDE_SIZE,
    distanceM: GUIDE_PLACE.distanceM,
    parent: app.bench.table,
    onClose: () => app.lessons.close(),
    onMove: (v) => {
      moved = true;
      clampDistance(head, v);
    },
  });
  const table = app.bench.table;
  const P = panel.pxPerDmm;
  let tab: GuideTab = 'steps';
  let moved = false;
  let tickUntil = 0;
  let reduced = false;
  let prevStates: StepState[] = session.state.value.steps.map((s) => s.state);
  let prevDone = session.state.value.done;
  // The hint card's page; back to the first when another hint opens or the step changes.
  let hintPage = 0;
  let hintFor = '';
  // The quiz card: the question just answered stays up until the person goes on; a quiz sent back to the steps stays away.
  let review: QuizReview | null = null;
  const dismissed = new Set<string>();
  const code = createCodeTab(app, panel);

  // ---- the running spinner: one instanced quad per running row, its texture turned (static under reduced motion) ----
  const spinCanvas = document.createElement('canvas');
  spinCanvas.width = spinCanvas.height = 128;
  const spinTex = new CanvasTexture(spinCanvas);
  spinTex.colorSpace = SRGBColorSpace;
  spinTex.center.set(0.5, 0.5);
  const spinMat = new MeshBasicMaterial({ map: spinTex, transparent: true, depthWrite: false });
  const spinners = new InstancedMesh(new PlaneGeometry(1, 1), spinMat, MAX_SPINNERS);
  spinners.name = 'guide:spinner';
  spinners.count = 0;
  spinners.frustumCulled = false;
  panel.group.add(spinners);
  let spinInk = '';
  const m4 = new Matrix4();
  const q = new Quaternion();
  const sv = new Vector3();
  const sp = new Vector3();

  // ---- the off-view arrow ----
  const arrowM = (ARROW_DMM * 1.1) / 1000;
  const arrow = surface({ widthM: arrowM, heightM: arrowM, pxPerM: panel.body.pxPerM, transparent: true, name: 'guide:arrow' });
  arrow.mesh.visible = false;
  panel.group.add(arrow.mesh);
  const targets: Vector3[] = Array.from({ length: MAX_TARGETS }, () => new Vector3());
  let targetCount = 0;
  const spot: ArrowSpot = { side: 'bottom', x: 0, y: 0, angle: 0 };
  const fwd = new Vector3();
  const tmp = new Vector3();
  let arrowClock = 0;

  const refreshTargets = () => {
    const s = session.state.value;
    const step = s.steps[s.viewIndex];
    targetCount = 0;
    table.updateWorldMatrix(true, false);
    for (const h of step?.targets ?? []) {
      if (targetCount >= MAX_TARGETS) break;
      const w = app.bench.worldOf(h.target);
      if (!w) continue;
      table.worldToLocal(targets[targetCount]!.set(w[0], w[1], w[2]));
      targetCount++;
    }
  };

  // ---- drawing ----
  const simRunning = () => app.sim.state === 'running';
  const redraw = () => {
    const s = session.state.value;
    const lang = app.settings.lang.value;
    const p = prefs(app);
    const k = tokens(p);
    const c: DrawCtx = { k, lang, pxPerDmm: P, textScale: p.textScale };
    if (tab === 'code' && !code.available) tab = 'steps';
    const ticking = tickUntil > performance.now();
    const animate = !p.reducedMotion;
    const hintKey = `${s.viewIndex}:${s.hintsOpened}`;
    if (hintKey !== hintFor) {
      hintFor = hintKey;
      hintPage = 0;
    }
    const card = stepsCard(s, dismissed, review);
    const key = JSON.stringify([
      tab,
      lang,
      prefsKey(p),
      animate,
      ticking,
      tab === 'code' ? [simRunning(), code.version] : 0,
      code.available,
      s.title,
      s.viewIndex,
      s.done,
      s.steps.map((x) => [x.state, x.text, x.title, x.problem, x.targets.length]),
      tab === 'checks' ? s.checks : 0,
      s.hintsOpened,
      hintPage,
      s.hints.length,
      s.completion?.open ?? null,
      s.completion?.complete ?? null,
      card.kind === 'quiz' ? [card.quiz.id, card.index, card.question.chosen] : 0,
    ]);
    reduced = p.reducedMotion;
    let spin: Array<{ x: number; y: number; d: number }> = [];
    const drew = panel.draw(key, c, { title: pick(s.title, lang).text, closeLabel: t(lang, 'close'), icon: s.done ? 'pass' : undefined }, (g) => {
      const area = panel.content;
      const faces: TabFace[] = [{ id: 'steps', label: t(lang, 'tabSteps'), icon: 'steps' }];
      if (code.available) faces.push({ id: 'code', label: t(lang, 'tabCode'), icon: 'code' });
      faces.push({ id: 'checks', label: t(lang, 'tabChecks'), icon: 'checks' });
      const row = { x: area.x, y: area.y, w: area.w, h: TAB_DMM * P };
      // All lessons at the right end of the tab row: with its word when the tabs leave room, else the icon alone.
      const nat = tabRects(g, row, faces, c);
      const used = nat[nat.length - 1]!.x + nat[nat.length - 1]!.w - row.x;
      const allFace: ButtonFace = { label: t(lang, 'allLessons'), icon: 'steps', kind: 'plain' };
      const wide = used + 8 * P + buttonWidth(g, allFace, c) <= row.w;
      const allW = wide ? buttonWidth(g, allFace, c) : 44 * P;
      const allR = { x: row.x + row.w - allW, y: row.y, w: allW, h: row.h };
      const allUse: ButtonFace = wide ? allFace : { ...allFace, iconOnly: true };
      drawButton(g, allR, allUse, c);
      const rects = drawTabs(g, { ...row, w: row.w - allW - 8 * P }, faces, tab, c);
      const regions: Region[] = faces.map((f, i) => ({
        id: `tab:${f.id}`,
        rect: rects[i]!,
        face: { label: f.label, icon: f.icon, kind: 'tab', active: f.id === tab },
        onSelect: () => {
          tab = f.id as GuideTab;
          redraw();
        },
      }));
      regions.push({ id: 'all-lessons', rect: allR, face: allUse, onSelect: () => app.lessons.showCatalogue() });
      const body = { x: area.x, y: row.y + row.h + 8 * P, w: area.w, h: area.y + area.h - (row.y + row.h + 8 * P) };
      if (tab === 'steps') {
        const fin: StepsFinish = {
          card,
          hint: () => {
            const n = nextHint(session.state.value);
            if (n !== null) session.openHint(n);
          },
          hintPage,
          setHintPage: (n) => {
            hintPage = Math.max(0, n);
            redraw();
          },
          quiz: {
            answer: (cd, choice) => {
              review = { quizId: cd.quiz.id, questionId: cd.question.id };
              session.answer(cd.quiz.id, cd.question.id, choice);
              redraw();
            },
            advance: (cd) => {
              if (!hasNext(cd)) dismissed.add(cd.quiz.id);
              review = null;
              redraw();
            },
          },
        };
        const r = drawStepsTab(g, body, s, c, { back: () => session.back(), next: () => session.next(), showMe: () => replayHighlights(app) }, ticking, fin);
        regions.push(...r.regions);
      } else if (tab === 'checks') {
        const r = drawChecksTab(g, body, s, c, { run: () => void session.runChecks() }, animate);
        regions.push(...r.regions);
        spin = r.spinners;
      } else {
        regions.push(...code.draw(g, body, c, simRunning()));
      }
      return regions;
    });
    code.setVisible(tab === 'code');
    if (drew) placeSpinners(spin, k);
    // A redraw turns its regions back on: behind Home they stay off.
    if (behindHome) setPanelHit(panel.group, false);
  };

  // ---- the calm layout: Home is alone when it is open; the guide steps back until Home closes ----
  let behindHome = false;
  const showGuide = (homeOpen: boolean) => {
    behindHome = homeOpen;
    panel.group.visible = !homeOpen;
    setPanelHit(panel.group, !homeOpen);
  };

  const placeSpinners = (show: Array<{ x: number; y: number; d: number }>, k: ReturnType<typeof tokens>) => {
    if (k.ink !== spinInk) {
      spinInk = k.ink;
      const g = spinCanvas.getContext('2d');
      if (g) {
        g.clearRect(0, 0, 128, 128);
        drawIcon(g, 'running', 64, 64, 120, k);
        spinTex.needsUpdate = true;
      }
    }
    spinners.count = Math.min(MAX_SPINNERS, show.length);
    for (let i = 0; i < spinners.count; i++) {
      const r = show[i]!;
      const l = panel.toLocal({ x: r.x - r.d / 2, y: r.y - r.d / 2, w: r.d, h: r.d }, { x: 0, y: 0, w: 0, h: 0 });
      m4.compose(sv.set(l.x, l.y, 0.0004), q.identity(), sp.set(l.w, l.h, 1));
      spinners.setMatrixAt(i, m4);
    }
    spinners.instanceMatrix.needsUpdate = true;
  };

  // ---- placement ----
  const camera = app.world.camera;
  let placeIn = 2;
  const placeNow = () => {
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(head);
    // Its slot in the panel ring (bench/core/ring.ts), on the side away from the dominant hand: in the table frame.
    const xr = app.settings.xr.value;
    const at = ringSpot('guide', xr.posture, xr.dominantHand).position;
    table.updateWorldMatrix(true, false);
    panel.group.position.set(at[0], at[1], at[2]);
    panel.group.updateMatrixWorld(true);
    panel.face(head);
  };
  const replace = () => {
    if (!moved) placeIn = 2;
  };

  // ---- every frame: face the head, turn the spinner, end the tick, point the arrow (10 times a second) ----
  const offFrame = onFrame(app.world, (dt, time) => {
    camera.getWorldPosition(head);
    if (placeIn > 0 && --placeIn === 0) placeNow();
    panel.face(head);
    if (spinners.count > 0 && !reduced) spinTex.rotation = -(time * 2.4) % (Math.PI * 2);
    if (tickUntil !== 0 && performance.now() > tickUntil) {
      tickUntil = 0;
      redraw();
    }
    arrowClock += dt;
    if (arrowClock < 0.1) return;
    arrowClock = 0;
    updateArrow();
  });

  const updateArrow = () => {
    let found = -1;
    if (targetCount > 0) {
      camera.getWorldDirection(fwd);
      table.updateWorldMatrix(true, false);
      for (let i = 0; i < targetCount; i++) {
        tmp.copy(targets[i]!);
        table.localToWorld(tmp);
        if (outOfView(head, fwd, tmp)) {
          found = i;
          break;
        }
      }
    }
    if (found < 0) {
      arrow.mesh.visible = false;
      return;
    }
    panel.group.updateWorldMatrix(true, false);
    panel.group.worldToLocal(tmp);
    arrowSpot(tmp.x, tmp.y, GUIDE_SIZE.widthM / 2, GUIDE_SIZE.heightM / 2, spot);
    const out = arrowM * 0.3;
    arrow.mesh.position.set(spot.x + Math.cos(spot.angle) * out, spot.y + Math.sin(spot.angle) * out, 0.001);
    arrow.mesh.rotation.set(0, 0, spot.angle);
    arrow.mesh.visible = true;
  };

  const drawArrow = () => {
    const k = tokens(prefs(app));
    arrow.redraw(k.paper + k.outline, (g, w, h) => {
      const line = 2.5 * P * k.outline;
      g.beginPath();
      g.moveTo(w * 0.92, h / 2);
      g.lineTo(w * 0.3, h * 0.12);
      g.lineTo(w * 0.3, h * 0.34);
      g.lineTo(w * 0.08, h * 0.34);
      g.lineTo(w * 0.08, h * 0.66);
      g.lineTo(w * 0.3, h * 0.66);
      g.lineTo(w * 0.3, h * 0.88);
      g.closePath();
      g.fillStyle = k.accent;
      g.fill();
      g.lineJoin = 'round';
      g.lineWidth = line;
      g.strokeStyle = k.ink;
      g.stroke();
    });
  };

  // ---- state ----
  const onState = () => {
    const s = session.state.value;
    s.steps.forEach((st, i) => {
      const before = prevStates[i];
      if (st.gated && st.state === 'done' && before !== undefined && before !== 'done') tickUntil = performance.now() + TICK_MS;
    });
    prevStates = s.steps.map((x) => x.state);
    // Done: the check-pass chime (its sound and two haptic pulses) once, at the panel.
    if (s.done && !prevDone) {
      panel.group.getWorldPosition(tmp);
      app.feedback.play('check-pass', [tmp.x, tmp.y, tmp.z]);
    }
    prevDone = s.done;
    refreshTargets();
    redraw();
  };
  const offs: Unsubscribe[] = [
    session.state.subscribe(onState),
    app.settings.lang.subscribe(redraw),
    app.settings.shared.subscribe(() => {
      drawArrow();
      redraw();
    }),
    app.settings.xr.subscribe(() => {
      replace();
      drawArrow();
      redraw();
    }),
    app.sim.onState(() => {
      if (tab === 'code') redraw();
    }),
    code.onChange(redraw),
    app.bench.onLayout(refreshTargets),
    app.bench.scale.subscribe(refreshTargets),
    app.mode.subscribe(replace),
    app.shell.homeOpen.subscribe(showGuide),
  ];
  drawArrow();
  refreshTargets();
  redraw();
  placeNow();
  showGuide(app.shell.homeOpen.value);

  return () => {
    offs.forEach((off) => off());
    offFrame();
    code.dispose();
    arrow.dispose();
    spinners.geometry.dispose();
    spinMat.dispose();
    spinTex.dispose();
    panel.dispose();
  };
}
