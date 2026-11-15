/** Zoom: the bench's work-scale steps (1x to 6x) by rail buttons, thumbstick flick and the two-handed gesture. */
import type { FeatureModule } from '../../contracts/app';
import type { Hand } from '../../contracts/input';
import { scaleControls } from '../kit/controls';
import { onFrame } from '../kit/frame';
import { tr } from '../kit/text';
import { watchRangeProject } from '../../range/shared/detect';
import { mountApply } from './apply';
import { flickStep, newFlick, resetFlick } from './flick';
import { newGesture, stepGesture, type GestureInput } from './gesture';
import { ZOOM_STRINGS as S } from './strings';

const HANDS: readonly Hand[] = ['left', 'right'];

export const zoomModule: FeatureModule = {
  id: 'scale/zoom',
  mount(app) {
    const apply = mountApply(app);
    const { scale, input, settings, bench } = app;
    const ctl = scaleControls(app);
    const offs = [
      ctl.add({
        id: 'zoom/minus', host: 'rail', order: 0, icon: 'minus',
        label: (l) => tr(S, l, 'smaller'),
        disabled: () => scale.workScale.value <= scale.steps[0]!,
        watch: [scale.workScale],
        run: () => scale.stepWorkScale(-1),
      }),
      ctl.add({
        id: 'zoom/value', host: 'rail', order: 1, icon: null,
        label: (l) => tr(S, l, 'scale'),
        value: (l) => tr(S, l, 'step', { x: scale.workScale.value }),
        watch: [scale.workScale],
        run: () => scale.setWorkScale(settings.xr.value.benchScale),
      }),
      ctl.add({
        id: 'zoom/plus', host: 'rail', order: 2, icon: 'plus',
        label: (l) => tr(S, l, 'larger'),
        disabled: () => scale.workScale.value >= scale.steps[scale.steps.length - 1]!,
        watch: [scale.workScale],
        run: () => scale.stepWorkScale(1),
      }),
    ];

    // Per hand [left, right]: what it hovers, holds or presses.
    const hover = [0, 0];
    const grab = [0, 0];
    const press = [0, 0];
    const seen: (string | null)[] = [input.sources.value.left, input.sources.value.right];
    const idx = (h: Hand | null) => (h === 'left' ? 0 : h === 'right' ? 1 : -1);
    const bump = (a: number[], i: number, d: number) => (a[i] = Math.max(0, a[i]! + d));
    const offAny = input.onAny((e) => {
      const i = idx(e.pointer.hand);
      if (i < 0) return;
      switch (e.type) {
        case 'hover-start': bump(hover, i, 1); break;
        case 'hover-end': bump(hover, i, -1); break;
        case 'grab-start': bump(grab, i, 1); break;
        case 'grab-end': bump(grab, i, -1); break;
        case 'select-start': bump(press, i, 1); break;
        case 'select-end': bump(press, i, -1); break;
        default: break;
      }
    });

    // A switch between hands and controllers drops pointers without their end events: start the counts again.
    const offSources = input.sources.subscribe((now) => {
      for (const h of HANDS) {
        const i = idx(h);
        if (now[h] !== seen[i]) {
          seen[i] = now[h];
          hover[i] = grab[i] = press[i] = 0;
        }
      }
    });
    const range = watchRangeProject(app.project);
    const flicks = [newFlick(), newFlick()];
    const g = newGesture();
    const tracked: [boolean, boolean] = [false, false];
    const pinching: [boolean, boolean] = [false, false];
    const busy: [boolean, boolean] = [false, false];
    const gi: { -readonly [K in keyof GestureInput]: GestureInput[K] } = { t: 0, tracked, pinching, busy, dist: 0, scale: 1 };

    const offFrame = onFrame(app.world, (_dt, t) => {
      const sources = input.sources.value;
      const dom = settings.xr.value.dominantHand;
      // Only while the circuit bench is shown: a lab or the Range hides it and a drone has its own bench, and a stick
      // pushed or hands spread there (flying the drone, handling lab items) would otherwise grow the circuit bench out
      // of sight, and the next circuit project would come back far too big for the table.
      const shown = bench.root.visible && range.value?.kind !== 'drone';
      // Flick: the dominant controller's stick, when that hand holds nothing.
      for (const h of HANDS) {
        const i = idx(h);
        const st = flicks[i]!;
        if (!shown || h !== dom || sources[h] !== 'controller' || grab[i]! > 0 || g.active) {
          resetFlick(st);
          continue;
        }
        const step = flickStep(st, input.stick(h).y);
        if (step !== 0) {
          scale.stepWorkScale(step);
          input.pulse(h, 0.25, 12);
        }
      }
      // Two-handed spread.
      const l = input.pose('left');
      const r = input.pose('right');
      tracked[0] = shown && l !== null;
      tracked[1] = shown && r !== null;
      pinching[0] = l?.pinching ?? false;
      pinching[1] = r?.pinching ?? false;
      busy[0] = hover[0]! > 0 || grab[0]! > 0 || press[0]! > 0;
      busy[1] = hover[1]! > 0 || grab[1]! > 0 || press[1]! > 0;
      gi.t = t * 1000;
      gi.scale = bench.scale.value;
      gi.dist = l && r ? Math.hypot(l.position[0] - r.position[0], l.position[1] - r.position[1], l.position[2] - r.position[2]) : 0;
      const out = stepGesture(g, gi);
      if (out.scale !== null) bench.setScale(out.scale);
      if (out.tick) {
        input.pulse('left', 0.5, 20);
        input.pulse('right', 0.5, 20);
      }
      if (out.release !== null) {
        scale.setWorkScale(out.release);
        apply.realise(scale.workScale.value);
      }
    });

    return () => {
      offFrame();
      range.dispose();
      offAny();
      offSources();
      for (const off of offs) off();
      apply.dispose();
    };
  },
};
