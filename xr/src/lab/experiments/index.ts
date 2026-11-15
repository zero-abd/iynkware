/**
 * Experiments: the lab switcher and the lab panel. A Home tile (the `lessons` slot: the shell has no lab slot yet, a
 * contract change would add one) opens the lab picker; the menu's Tools group lists the four labs and Leave the lab.
 * The panel beside the bench shows, by state:
 *   picker    the four labs
 *   lab       its experiments, each with Practice and Exam, and Back to the circuit bench
 *   running   the step to do, the answer choices when the step asks, Hint (practice), Finish, Stop, the tutor's line
 *   results   the score, every check with its detail, what was logged
 */
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { IconName } from '../../look/icons';
import { INK, MUTED, RULE, STATE } from '../../look/palette';
import { TYPE } from '../../look/type';
import { value } from '../../ui/value';
import { labOf, type LabContext } from '../context';
import { createLabPanel, type PanelUi } from '../kit/panel';
import { LAB_UI } from '../kit/strings';
import { LAB_NAMES } from '../model/catalogue';
import { LAB_IDS, type LabId } from '../model/types';
import { fill, say, type L6 } from '../text';
import { experimentsOf } from './list';
import type { Mode } from './types';

const LAB_ICON: Readonly<Record<LabId, IconName>> = { chemistry: 'flame', physics: 'timer', electrical: 'lightning', signals: 'waveform' };
export const PANEL = { widthM: 0.46, heightM: 0.5, distanceM: 0.8 } as const;
/**
 * Table frame: behind the bench on the right, turned to the seated eye. The left is the learn guide's and the
 * assistant card's; the run pillar's scope and serial panels open further right and higher (run/kit/layout.ts).
 */
const PANEL_AT = { x: 0.47, y: 0.3, z: -0.14, yaw: -0.6, tilt: -0.18 } as const;

export function mountLabPanel(app: XrApp, lab: LabContext): Unsubscribe {
  const { store, runner } = lab;
  const panel = createLabPanel(app, { id: 'lab', ...PANEL });
  panel.group.position.set(PANEL_AT.x, PANEL_AT.y, PANEL_AT.z);
  panel.group.rotation.set(PANEL_AT.tilt, PANEL_AT.yaw, 0, 'YXZ');
  app.bench.table.add(panel.group);
  const picker = value(false);
  let hint: L6 | null = null;
  const lang = () => app.settings.lang.value;
  const t = (s: L6, vars?: Parameters<typeof fill>[1]) => say(vars ? fill(s, vars) : s, lang());

  const openLab = (id: LabId) => {
    picker.set(false);
    hint = null;
    lab.open(id);
    app.shell.closeHome();
  };
  const start = (id: string, mode: Mode) => {
    hint = null;
    lab.start(id, mode);
  };

  const paintPicker = (ui: PanelUi) => {
    const { u, W } = ui;
    const pad = 24 * u;
    ui.kicker(t(LAB_UI.kicker), pad, 30 * u);
    ui.text(t(LAB_UI.chooseLab), pad, 44 * u, W - 2 * pad, { role: TYPE.title });
    const bw = (W - 3 * pad - 6 * u) / 2;
    const bh = 70 * u;
    LAB_IDS.forEach((id, i) => {
      const x = pad + (i % 2) * (bw + pad);
      const y = 110 * u + Math.floor(i / 2) * (bh + 18 * u);
      ui.button(`lab-${id}`, x, y, bw, bh, t(LAB_NAMES[id]), () => openLab(id), { icon: LAB_ICON[id] });
    });
    ui.button('close', W - pad - 160 * u, ui.H - 70 * u, 160 * u, 46 * u, t(LAB_UI.stop), () => picker.set(false));
  };

  /** The tutor's latest line, or the hint asked for, along the bottom. */
  const paintTutor = (ui: PanelUi, y: number) => {
    const { u, W } = ui;
    const pad = 24 * u;
    const run = runner.state.value;
    ui.rule(y);
    if (run && run.mode === 'exam' && !run.done) {
      ui.text(t(LAB_UI.examNote), pad, y + 10 * u, W - 2 * pad, { role: TYPE.caption, colour: MUTED, maxLines: 1 });
      return;
    }
    const ev = lab.tutor.recent.at(-1);
    const text = hint ?? ev?.text;
    if (!text) return;
    const tone = hint ? STATE.info : ev?.kind === 'hazard' ? STATE.bad : ev?.kind === 'warn' ? STATE.warn : ev?.kind === 'praise' ? STATE.good : INK;
    ui.icon(hint || ev?.kind === 'hint' ? 'lightbulb' : ev?.kind === 'hazard' || ev?.kind === 'warn' ? 'warning' : 'info', pad, y + 10 * u, 26 * u, tone);
    ui.text(t(text), pad + 34 * u, y + 10 * u, W - 2 * pad - 34 * u, { role: TYPE.caption, colour: tone, maxLines: 2 });
  };

  const paintLab = (ui: PanelUi, id: LabId) => {
    const { u, W, H } = ui;
    const pad = 24 * u;
    ui.kicker(t(LAB_UI.kicker), pad, 30 * u);
    ui.text(t(LAB_NAMES[id]), pad, 44 * u, W - 2 * pad, { role: TYPE.title, maxLines: 1 });
    let y = ui.text(t(LAB_UI.free), pad, 88 * u, W - 2 * pad, { role: TYPE.caption, colour: MUTED, maxLines: 2 }) + 10 * u;
    const bw = 120 * u;
    for (const e of experimentsOf(id)) {
      const textW = W - 2 * pad - 2 * bw - 24 * u;
      ui.text(t(e.title), pad, y, textW, { role: TYPE.label, maxLines: 1 });
      ui.text(t(e.goal), pad, y + 26 * u, textW, { role: TYPE.caption, colour: MUTED, maxLines: 2 });
      ui.button(`practice-${e.id}`, W - pad - 2 * bw - 12 * u, y, bw, 48 * u, t(LAB_UI.practice), () => start(e.id, 'practice'), { primary: true });
      ui.button(`exam-${e.id}`, W - pad - bw, y, bw, 48 * u, t(LAB_UI.exam), () => start(e.id, 'exam'));
      y += 84 * u;
    }
    ui.button('leave', pad, H - 140 * u, W - 2 * pad - 6 * u, 44 * u, t(LAB_UI.leave), () => lab.leave(), { icon: 'arrowLeft' });
    paintTutor(ui, H - 84 * u);
  };

  const paintRun = (ui: PanelUi) => {
    const run = runner.state.value!;
    const { u, W, H } = ui;
    const pad = 24 * u;
    const e = run.experiment;
    ui.kicker(`${t(run.mode === 'exam' ? LAB_UI.exam : LAB_UI.practice)} · ${t(LAB_UI.stepOf, { n: Math.min(run.stepIndex + 1, e.steps.length), m: e.steps.length })}`, pad, 30 * u);
    ui.text(t(e.title), pad, 44 * u, W - 2 * pad, { role: TYPE.title, maxLines: 1 });
    // Progress dots, one per step.
    e.steps.forEach((_s, i) => {
      ui.g.beginPath();
      ui.g.arc(pad + 8 * u + i * 22 * u, 96 * u, 6 * u, 0, Math.PI * 2);
      ui.g.fillStyle = i < run.stepIndex ? STATE.good : i === run.stepIndex ? INK : RULE;
      ui.g.fill();
    });
    const step = run.step;
    let y = 116 * u;
    if (step) y = ui.text(t(step.text), pad, y, W - 2 * pad, { role: TYPE.body, maxLines: 4 }) + 12 * u;
    if (step?.ask) {
      ui.text(t(LAB_UI.pick), pad, y, W - 2 * pad, { role: TYPE.caption, colour: MUTED, maxLines: 1 });
      y += 28 * u;
      const cols = step.ask.choices.length > 4 ? 3 : 2;
      const bw = (W - 2 * pad - (cols - 1) * 10 * u - 6 * u) / cols;
      const bh = 54 * u;
      step.ask.choices.forEach((c, i) => {
        const x = pad + (i % cols) * (bw + 10 * u);
        const by = y + Math.floor(i / cols) * (bh + 8 * u);
        const ask = step.ask!;
        ui.button(`choice-${i}`, x, by, bw, bh, t(c.label), () => store.answer(ask.key, c.value), { selected: store.answers[ask.key] === c.value });
      });
    }
    const bw = (W - 2 * pad - 2 * 10 * u - 6 * u) / 3;
    const by = H - 140 * u;
    if (run.mode === 'practice')
      ui.button('hint', pad, by, bw, 44 * u, t(LAB_UI.hint), () => {
        hint = runner.hint();
        redraw();
      }, { icon: 'lightbulb' });
    ui.button('finish', pad + bw + 10 * u, by, bw, 44 * u, t(LAB_UI.finish), () => runner.finish(), { primary: true });
    ui.button('stop', pad + 2 * (bw + 10 * u), by, bw, 44 * u, t(LAB_UI.stop), () => {
      hint = null;
      runner.stop();
    });
    paintTutor(ui, H - 84 * u);
  };

  const paintResults = (ui: PanelUi) => {
    const run = runner.state.value!;
    const r = run.result!;
    const { u, W, H } = ui;
    const pad = 24 * u;
    ui.kicker(`${t(LAB_UI.results)} · ${t(run.mode === 'exam' ? LAB_UI.exam : LAB_UI.practice)}`, pad, 30 * u);
    ui.text(t(run.experiment.title), pad, 44 * u, W - 2 * pad, { role: TYPE.title, maxLines: 1 });
    ui.text(t(LAB_UI.score, { score: r.score }), pad, 86 * u, W - 2 * pad, { role: TYPE.display, size: 34, maxLines: 1, colour: r.score >= 70 ? STATE.good : STATE.bad });
    let y = 132 * u;
    for (const c of r.checks) {
      ui.icon(c.pass ? 'checkCircle' : 'xCircle', pad, y, 24 * u, c.pass ? STATE.good : STATE.bad);
      const line = c.detail ? `${t(c.label)}: ${t(c.detail)}` : t(c.label);
      y = ui.text(line, pad + 32 * u, y + 2 * u, W - 2 * pad - 32 * u, { role: TYPE.caption, maxLines: 2 }) + 6 * u;
    }
    ui.text(t(LAB_UI.logged, { m: r.mistakes, r: r.refusals, h: r.hints }), pad, y + 4 * u, W - 2 * pad, { role: TYPE.caption, colour: MUTED, maxLines: 2 });
    const bw = (W - 2 * pad - 2 * 10 * u - 6 * u) / 3;
    const by = H - 70 * u;
    const e = run.experiment;
    ui.button('again', pad, by, bw, 44 * u, t(LAB_UI.again), () => start(e.id, run.mode), { primary: true });
    const other: Mode = run.mode === 'exam' ? 'practice' : 'exam';
    ui.button('other', pad + bw + 10 * u, by, bw, 44 * u, t(other === 'exam' ? LAB_UI.exam : LAB_UI.practice), () => start(e.id, other));
    ui.button('back', pad + 2 * (bw + 10 * u), by, bw, 44 * u, t(LAB_UI.back), () => runner.stop());
  };

  const redraw = () => {
    const run = runner.state.value;
    const id = store.lab;
    const visible = picker.value || id !== null;
    panel.setVisible(visible);
    if (!visible) return;
    const last = lab.tutor.recent.at(-1)?.seq ?? 0;
    const key = JSON.stringify([lang(), picker.value, id, run?.experiment.id, run?.mode, run?.stepIndex, run?.done, run?.result?.score, store.answers, last, hint?.en]);
    panel.draw(key, (ui) => {
      if (picker.value && !id) paintPicker(ui);
      else if (run?.done) paintResults(ui);
      else if (run) paintRun(ui);
      else if (id) paintLab(ui, id);
    });
  };

  const offs: Unsubscribe[] = [
    store.subscribe((c) => {
      if (c.type !== 'tick') redraw();
    }),
    runner.state.subscribe(redraw),
    lab.tutor.subscribe(redraw),
    picker.subscribe(redraw),
    app.settings.lang.subscribe(redraw),
    app.shell.addEntry({
      id: 'lab/labs',
      slot: 'lessons',
      title: LAB_UI.labsTile,
      detail: LAB_UI.labsDetail,
      open: () => picker.set(true),
    }),
    ...LAB_IDS.map((id) => app.shell.addMenuItem({ id: `lab/${id}`, group: 'tools', label: LAB_NAMES[id], run: () => openLab(id) })),
    app.shell.addMenuItem({ id: 'lab/leave', group: 'tools', label: LAB_UI.leaveMenu, run: () => lab.leave() }),
  ];
  redraw();

  return () => {
    for (const off of offs.splice(0)) off();
    const list: Array<{ entityIdx?: number; object3D?: unknown }> = [];
    panel.group.traverse((o) => void list.push(o as never));
    for (let i = list.length - 1; i >= 0; i--) {
      const idx = list[i]!.entityIdx;
      if (idx === undefined) continue;
      const ent = app.world.entityManager.getEntityByIndex(idx);
      if (ent && ent.active && ent.object3D === (list[i] as never)) ent.destroy();
    }
    panel.dispose();
  };
}

export const experimentsModule: FeatureModule = {
  id: 'lab/experiments',
  mount(app) {
    const lab = labOf(app.world);
    if (!lab) return () => undefined;
    return mountLabPanel(app, lab);
  },
};
