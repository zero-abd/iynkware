/**
 * The Code window (#311): the running project's sketch with line numbers, the line that runs marked in ink and eased
 * from line to line. Read-only. Menu, Tools, Code shows or hides it; the first press of Step opens it beside the bench,
 * off to the side away from the dominant hand, so the forward view stays on the build. It is a shell panel, so its
 * grip bar and title bar move it, with hands and controllers.
 *
 * The line is read off the run (`mapper.ts`), not a debugger: the tracked pin's changes are the `digitalWrite`s and the
 * time between them falls in the `delay`s. Each frame of the sim feeds it, so it follows Run and each Step alike. A
 * sketch the mapper cannot follow is shown with no marker and says so.
 */
import type { FeatureModule, XrApp } from '../../contracts/app';
import { LANGS, type LocalizedText, type Unsubscribe } from '../../contracts/common';
import { reducedMotionOf } from '../../look';
import { dmm } from '../../look/type';
import { placeAhead, shellPanel, shellText, type ShellPanel, type ShellText } from '../../shell/kit';
import { value } from '../../ui/value';
import { onTick } from '../kit/ticker';
import { codeBlock, ROW_DMM, type CodeBlock } from './block';
import { createTracker, NOWHERE, pinKeyOf, type CodePosition, type CodeTracker } from './mapper';
import { sketchOf, type Sketch } from './source';
import { codeStrings as S } from './strings';

const DISTANCE_M = 0.9;
/** Panel size in dmm, and the rows of code it shows (Blink's 12 lines fit). */
const W_DMM = 600;
const ROWS = 14;
const FOOT_DMM = 40;
const H_DMM = 64 + 16 + ROWS * ROW_DMM + 12 + FOOT_DMM + 30;
/** A write is instant; it stays marked at least this long so the eye sees it before the marker moves on. */
const DWELL_MS = 400;
const d = (v: number) => dmm(v, DISTANCE_M);

export const codeViewModule: FeatureModule = {
  id: 'run/code-view',
  mount(app: XrApp): Unsubscribe {
    const lang = () => app.settings.lang.value;
    const label: LocalizedText = Object.fromEntries(LANGS.map((l) => [l, S.t(l, 'title')]));
    const shown = value(false);
    let panel: ShellPanel | null = null;
    let block: CodeBlock | null = null;
    let foot: ShellText | null = null;
    let sketch: Sketch | null = null;
    let tracker: CodeTracker | null = null;
    /** The frame key of the tracked pin, once a frame has shown it. */
    let key: string | null = null;
    let pos: CodePosition = NOWHERE;
    /** A position waiting for the write before it to have been seen long enough. */
    let pending: CodePosition | null = null;
    let since = 0;
    let autoOpened = false;
    let reduced = reducedMotionOf(app);

    const replan = () => {
      const next = sketchOf(app.project.doc);
      if (next?.id === sketch?.id && next?.content === sketch?.content) return false;
      sketch = next;
      tracker = sketch?.plan ? createTracker(sketch.plan) : null;
      key = null;
      pos = NOWHERE;
      pending = null;
      return true;
    };

    const footText = (): string => {
      const l = lang();
      if (!sketch) return S.t(l, 'none');
      if (!sketch.plan || (key === null && app.sim.lastFrame && !pinKeyOf(sketch.plan.pin, app.sim.lastFrame.pins))) return S.t(l, 'untracked');
      if (pos.wrote) return S.t(l, 'wrote', { pin: sketch.plan.pin, level: pos.wrote.level ? 'HIGH' : 'LOW' });
      if (pos.delay) return S.t(l, 'delay', { elapsed: pos.delay.elapsedMs, total: pos.delay.ms });
      return S.t(l, 'ready');
    };

    const show = () => {
      if (!panel?.isOpen || !block) return;
      block.mark(pos.line);
      foot?.set(footText(), { role: 'caption', maxLines: 1 });
      panel.group.userData.code = { open: true, path: sketch?.path ?? null, lines: sketch?.lines.length ?? 0, tracked: !!sketch?.plan, pin: key, line: pos.line, wrote: pos.wrote, delay: pos.delay, top: block.top };
    };

    /** Takes the tracker's latest position, holding a just-run write on screen for `DWELL_MS`. */
    const offer = (next: CodePosition) => {
      const now = performance.now();
      if (pos.wrote && !next.wrote && next.line !== null && now - since < DWELL_MS) {
        pending = next;
        return;
      }
      pending = null;
      if (next.wrote && next.wrote !== pos.wrote) since = now;
      pos = next;
      show();
    };

    const fill = () => {
      if (!panel) return;
      const l = lang();
      panel.setTitle(S.t(l, 'title'), sketch?.path ?? '');
      block?.setLines(sketch?.lines ?? []);
      show();
    };

    const build = (): ShellPanel => {
      const p = shellPanel(app, { id: 'run/code', w: d(W_DMM), h: d(H_DMM), distanceM: DISTANCE_M, title: S.t(lang(), 'title'), kicker: sketch?.path ?? '', icon: 'code', onClose: () => close() });
      const inner = p.inner;
      block = p.add(codeBlock({ w: inner, rows: ROWS, distanceM: DISTANCE_M }), 0, p.top - d(6) - d(ROWS * ROW_DMM) / 2);
      foot = p.add(shellText({ w: inner, h: d(FOOT_DMM), distanceM: DISTANCE_M }), 0, p.top - d(6) - d(ROWS * ROW_DMM) - d(12) - d(FOOT_DMM) / 2);
      return p;
    };

    const open = () => {
      replan();
      panel ??= build();
      const side = app.settings.xr.value.dominantHand === 'left' ? 40 : -40;
      placeAhead(app.world, panel.group, { distance: DISTANCE_M, belowDeg: 12, sideDeg: side });
      panel.open();
      shown.set(true);
      fill();
    };

    function close() {
      panel?.close();
      shown.set(false);
      if (panel) panel.group.userData.code = { open: false };
    }

    const offs: Unsubscribe[] = [
      app.shell.addMenuItem({ id: 'run/code', group: 'tools', label, toggle: shown, run: () => (panel?.isOpen ? close() : open()) }),
      // The first Step opens it: stepping is when the code is worth reading line by line.
      app.input.onAny((e) => {
        if (e.type !== 'select' || e.target !== 'run:step' || autoOpened) return;
        autoOpened = true;
        if (!panel?.isOpen && sketchOf(app.project.doc)) open();
      }),
      app.sim.onFrame((f) => {
        if (!tracker || !sketch?.plan) return;
        key ??= pinKeyOf(sketch.plan.pin, f.pins);
        if (key === null) return;
        offer(tracker.observe(f.atNs, f.pins[key]));
      }),
      app.sim.onState((s) => {
        if (s !== 'unloaded' && s !== 'error') return;
        tracker?.reset();
        offer(NOWHERE);
      }),
      app.project.subscribe(() => {
        if (replan()) fill();
      }),
      app.settings.lang.subscribe(() => fill()),
      app.settings.xr.subscribe(() => (reduced = reducedMotionOf(app))),
      app.settings.shared.subscribe(() => (reduced = reducedMotionOf(app))),
      onTick(app.world, (dt) => {
        if (!panel?.isOpen || !block) return;
        if (pending && performance.now() - since >= DWELL_MS) {
          pos = pending;
          pending = null;
          show();
        }
        block.tick(dt, reduced);
      }),
    ];
    replan();

    return () => {
      for (const off of offs) off();
      panel?.dispose();
    };
  },
};
