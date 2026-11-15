/**
 * The Code window (#311): the running project's sketch with line numbers, the line that runs marked in ink and eased
 * from line to line. Read-only. Menu, Tools, Code shows or hides it; the first press of Step opens it in its slot of the
 * panel ring (`bench/core/ring.ts`, on the dominant hand's side), so the forward view stays on the build. It is a shell
 * panel, so its
 * grip bar and title bar move it, with hands and controllers.
 *
 * The line is read off the run (`mapper.ts`), not a debugger: the tracked pin's changes are the `digitalWrite`s and the
 * time between them falls in the `delay`s. Each frame of the sim feeds it, so it follows Run and each Step alike. A
 * sketch the mapper cannot follow is shown with no marker and says so.
 *
 * It also opens by itself, standing past the bench's right edge (the dominant hand's side), whenever a board that runs a
 * program is on the bench, and closes when it goes. Closed by the person, it stays closed until a board comes again.
 *
 * Under the code: Up and Down scroll; Edit (a flat screen only) opens the program in a text editor
 * (`../code/editor.ts`), Save is one undoable change; Ask companion fills the companion's box on a flat screen and asks
 * it straight away in a headset (it writes with `write_code`). A board with no program yet can be given one by either.
 */
import type { FeatureModule, XrApp } from '../../contracts/app';
import { LANGS, type LocalizedText, type Unsubscribe } from '../../contracts/common';
import { reducedMotionOf } from '../../look';
import { dmm } from '../../look/type';
import { Vector3 } from '@iwsdk/core';
import { ringSpot } from '../../bench/core/ring';
import { shellButton, shellPanel, shellText, type ShellButton, type ShellPanel, type ShellText } from '../../shell/kit';
import { agentOf } from '../../agent/hub';
import { createFlatEditor } from '../code/editor';
import { languagesFrom, programOf, writeProgramOps } from '../code/model';
import { CODE_STRINGS as C } from '../code/strings';
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
/** The row of Up, Down, Edit and Ask companion under the foot. */
const BUTTONS_DMM = 44;
const H_DMM = 64 + 16 + ROWS * ROW_DMM + 12 + FOOT_DMM + 12 + BUTTONS_DMM + 30;
/** A write is instant; it stays marked at least this long so the eye sees it before the marker moves on. */
const DWELL_MS = 400;
/** The delay line in the foot counts in steps of this, so its texture repaints at most ten times a second. */
const DELAY_STEP_MS = 100;
/**
 * The flat page's camera is fixed over the bench and leaves no room beside it, so there the window stands in the
 * camera's frame instead: its centre at this point of the screen (-1..1 each way), this share of the screen's width,
 * shrunk by `scale` so it stands nearer than the bench and the shelf and nothing hides it. Its grip bar still moves it.
 */
const FLAT = { x: 0.74, y: -0.42, share: 0.25, scale: 0.4 } as const;
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
    let buttons: { up: ShellButton; down: ShellButton; edit: ShellButton; ask: ShellButton } | null = null;
    /** A line in the foot after a save, until the next change of the document. */
    let note: string | null = null;
    const editor = createFlatEditor();
    const languagesOf = languagesFrom((ref, version) => app.project.describe(ref, version));

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
      if (note) return note;
      if (!sketch) return S.t(l, 'none');
      if (!sketch.plan || (key === null && app.sim.lastFrame && !pinKeyOf(sketch.plan.pin, app.sim.lastFrame.pins))) return S.t(l, 'untracked');
      if (pos.wrote) return S.t(l, 'wrote', { pin: sketch.plan.pin, level: pos.wrote.level ? 'HIGH' : 'LOW' });
      if (pos.delay) {
        // Whole tenths of a second: the elapsed time moves every sim frame, and each new string repaints the foot's texture.
        const total = pos.delay.ms;
        return S.t(l, 'delay', { elapsed: Math.min(total, Math.round(pos.delay.elapsedMs / DELAY_STEP_MS) * DELAY_STEP_MS), total });
      }
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
      paintButtons();
      show();
    };

    const paintButtons = () => {
      if (!buttons) return;
      const l = lang();
      const has = programOf(app.project.doc, languagesOf) !== null;
      const flat = app.mode.value === 'flat';
      buttons.up.set({ label: C.t(l, 'up') });
      buttons.down.set({ label: C.t(l, 'down') });
      buttons.edit.set({ label: C.t(l, 'edit'), icon: 'code', disabled: !has });
      buttons.ask.set({ label: C.t(l, 'ask'), icon: 'sparkle', primary: true, disabled: !has });
      buttons.edit.group.visible = flat;
    };

    const save = (text: string) => {
      const ops = writeProgramOps(app.project.doc, text, languagesOf);
      if (typeof ops !== 'string' && !app.project.apply(ops, { label: 'code' }).ok) return;
      editor.close();
      if (typeof ops === 'string') return;
      note = C.t(lang(), 'saved');
      show();
    };

    const edit = () => {
      const program = programOf(app.project.doc, languagesOf);
      if (!program) return;
      const l = lang();
      editor.open({ title: `${S.t(l, 'title')} · ${program.path}`, text: program.text, save: C.t(l, 'save'), cancel: C.t(l, 'cancel'), onSave: save });
    };

    const build = (): ShellPanel => {
      const p = shellPanel(app, { id: 'run/code', w: d(W_DMM), h: d(H_DMM), distanceM: DISTANCE_M, title: S.t(lang(), 'title'), kicker: sketch?.path ?? '', icon: 'code', onClose: () => close() });
      const inner = p.inner;
      block = p.add(codeBlock({ w: inner, rows: ROWS, distanceM: DISTANCE_M }), 0, p.top - d(6) - d(ROWS * ROW_DMM) / 2);
      const footY = p.top - d(6) - d(ROWS * ROW_DMM) - d(12) - d(FOOT_DMM) / 2;
      foot = p.add(shellText({ w: inner, h: d(FOOT_DMM), distanceM: DISTANCE_M }), 0, footY);
      // Up and Down narrow on the left, Edit and Ask companion wide on the right
      const gap = d(8);
      const narrow = (inner - 3 * gap) / 6;
      const wide = narrow * 2;
      const y = footY - d(FOOT_DMM) / 2 - d(12) - d(BUTTONS_DMM) / 2;
      const make = (id: string, w: number, x: number, onSelect: () => void) =>
        p.add(shellButton(app, { id: `run/code/${id}`, w, h: d(BUTTONS_DMM), distanceM: DISTANCE_M, onSelect }, { label: '', layout: 'center' }), x, y);
      let x = -inner / 2;
      const next = (w: number) => {
        const at = x + w / 2;
        x += w + gap;
        return at;
      };
      buttons = {
        up: make('up', narrow, next(narrow), () => block?.scroll(-(ROWS - 2))),
        down: make('down', narrow, next(narrow), () => block?.scroll(ROWS - 2)),
        edit: make('edit', wide, next(wide), edit),
        ask: make('ask', wide, next(wide), () => askCompanion(app)),
      };
      paintButtons();
      return p;
    };

    /** Opened by itself beside the bench (true), or by the menu or Step in front of the person (false). */
    let beside = false;
    /** The person closed it; it stays closed until a board that runs a program comes onto the bench again. */
    let dismissed = false;
    let hadProgram = false;
    const eye = new Vector3();
    /** Where the flat camera was when the window was placed in its frame. */
    const placedFrom = new Vector3(Infinity, 0, 0);
    const placeBeside = () => {
      if (!panel) return;
      const cam = app.world.camera;
      cam.updateMatrixWorld(true);
      cam.getWorldPosition(eye);
      if (app.mode.value === 'flat') {
        placedFrom.copy(eye);
        const pc = cam as typeof cam & { fov?: number; aspect?: number };
        const tanX = Math.tan(((pc.fov ?? 60) * Math.PI) / 360) * (pc.aspect ?? 1);
        const dist = (FLAT.scale * d(W_DMM)) / (FLAT.share * 2 * tanX);
        const dir = new Vector3(FLAT.x, FLAT.y, 0.5).unproject(cam).sub(eye).normalize();
        // a point on that ray whose depth along the view is `dist`
        const fwd = cam.getWorldDirection(new Vector3());
        panel.group.position.copy(eye).addScaledVector(dir, dist / dir.dot(fwd));
        panel.group.quaternion.copy(cam.quaternion);
        return;
      }
      const xr = app.settings.xr.value;
      const at = ringSpot('code', xr.posture, xr.dominantHand).position;
      app.bench.table.updateMatrixWorld(true);
      panel.group.position.copy(app.bench.table.localToWorld(new Vector3(at[0], at[1], at[2])));
      panel.group.lookAt(eye.x, panel.group.position.y, eye.z);
    };

    const open = (byItself = false) => {
      replan();
      panel ??= build();
      beside = byItself;
      // Its slot in the panel ring (bench/core/ring.ts), from the menu, Step or a programmable board alike.
      placeBeside();
      panel.open();
      shown.set(true);
      fill();
    };

    /** Opens or closes it by itself: a board that runs a program on the bench, at the bench. */
    const sync = () => {
      const has = programOf(app.project.doc, languagesOf) !== null;
      if (has && !hadProgram) dismissed = false;
      hadProgram = has;
      const want = has && !dismissed && app.shell.place.value === 'bench';
      if (want && !panel?.isOpen) open(true);
      else if (!want && panel?.isOpen && (beside || !has)) quiet();
    };

    /** Closes without counting as the person's choice. */
    function quiet() {
      panel?.close();
      shown.set(false);
      if (panel) panel.group.userData.code = { open: false };
    }

    function close() {
      dismissed = true;
      panel?.close();
      shown.set(false);
      if (panel) panel.group.userData.code = { open: false };
    }

    const offs: Unsubscribe[] = [
      app.shell.addMenuItem({
        id: 'run/code',
        group: 'tools',
        label,
        toggle: shown,
        run: () => {
          if (panel?.isOpen) return close();
          dismissed = false;
          open();
        },
      }),
      app.shell.place.subscribe(() => sync()),
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
        note = null;
        if (replan()) fill();
        else paintButtons();
        sync();
      }),
      app.mode.subscribe(() => {
        if (app.mode.value !== 'flat') editor.close();
        paintButtons();
        // the headset's head and bench differ from the flat page's: stand it beside the bench again
        if (panel?.isOpen) placeBeside();
      }),
      app.settings.xr.subscribe(() => {
        if (panel?.isOpen) placeBeside();
      }),
      app.bench.benchTop.subscribe(() => {
        if (panel?.isOpen && beside) placeBeside();
      }),
      app.settings.lang.subscribe(() => fill()),
      app.settings.xr.subscribe(() => (reduced = reducedMotionOf(app))),
      app.settings.shared.subscribe(() => (reduced = reducedMotionOf(app))),
      onTick(app.world, (dt) => {
        if (!panel?.isOpen || !block) return;
        // the flat page frames its camera after start-up: keep the window in the camera's frame
        if (beside && app.mode.value === 'flat') {
          if (app.world.camera.getWorldPosition(eye).distanceToSquared(placedFrom) > 1e-4) placeBeside();
          // the open animation scales to 1; on the flat screen it settles at the smaller size
          if (Math.abs(panel.group.scale.x - FLAT.scale) > 1e-3 && panel.group.scale.x >= 0.999) panel.group.scale.setScalar(FLAT.scale);
        } else if (panel.group.scale.x !== 1 && panel.group.scale.x === FLAT.scale) panel.group.scale.setScalar(1);
        if (pending && performance.now() - since >= DWELL_MS) {
          pos = pending;
          pending = null;
          show();
        }
        block.tick(dt, reduced);
      }),
    ];
    replan();
    sync();

    return () => {
      for (const off of offs) off();
      editor.dispose();
      panel?.dispose();
    };
  },
};

/** The companion writes the code: a flat screen fills its question box, a headset asks it now. */
function askCompanion(app: XrApp): void {
  const l = app.settings.lang.value;
  const input = typeof document === 'undefined' ? null : document.querySelector<HTMLInputElement>('#agent-conversation input');
  if (app.mode.value === 'flat' && input) {
    input.value = C.t(l, 'askTyped');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    return;
  }
  void agentOf(app.world).bridge?.ask(C.t(l, 'askVoice'));
}
