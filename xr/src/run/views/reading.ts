/**
 * Readouts over a part: an inked chip above it with what it measures (`2.03 V`, `dist 23.4 cm`), shown while the run
 * is going or paused, hidden on reset, redrawn at most ten times a second, turned to face the viewer. And, for a part
 * the simulator does not model yet, a small muted chip that says so, only while running. The numbers are formatted in
 * the person's language. At most six chips show at once on the bench (6.4); the rest wait their turn.
 */
import { Vector3, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Lang } from '../../contracts/common';
import type { PartState, PartView, PartViewContext, PartViewFactory } from '../../contracts/part-view';
import { faceViewer, textChip, type Chip } from '../kit/chip';
import { labelText, viewStrings } from './strings';

/** The most readout chips on the bench at once. */
export const MAX_CHIPS = 6;
/** The shortest time between two redraws of a chip, milliseconds. */
export const CHIP_MS = 100;
/** Gap between the top of the part and the chip, metres at the part's own scale. */
const GAP_M = 0.012;

/** The locale a language formats numbers in. */
const LOCALE: Record<Lang, string> = { en: 'en', de: 'de', es: 'es', fr: 'fr', hi: 'hi-IN', zh: 'zh-CN' };

/** Units written close to the number (`135°`), not after a space. */
const TIGHT_UNITS = new Set(['°', '%', '℃', '°C', '°F']);

/** Decimals to show: more for small values, whole numbers from 1000 up. */
export function digitsFor(value: number): number {
  const a = Math.abs(value);
  return a >= 1000 ? 0 : a >= 100 ? 1 : 2;
}

const formats = new Map<string, Intl.NumberFormat>();

/** `value` in `lang`'s number format (`2,03` in German), without trailing zeros, with a minus sign for negatives. */
export function formatNumber(value: number, lang: Lang): string {
  const digits = digitsFor(value);
  const key = `${lang}:${digits}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    formats.set(key, f);
  }
  return f.format(Object.is(value, -0) ? 0 : value);
}

/** The chip's line: `label value unit`, the label translated when known, the unit as the simulator names it. */
export function readingLine(state: { value: number; unit: string; label: string }, lang: Lang): string {
  const number = Number.isFinite(state.value) ? formatNumber(state.value, lang) : '–';
  const unit = state.unit.trim();
  const value = unit === '' ? number : TIGHT_UNITS.has(unit) ? `${number}${unit}` : `${number} ${unit}`;
  const label = labelText(state.label, lang);
  return label === '' ? value : `${label} ${value}`;
}

/** How many chips of each app are showing. */
const showing = new WeakMap<XrApp, number>();

interface ChipSpec {
  /** Width in dmm and size of the type. */
  widthDmm: number;
  sizeDmm: number;
  /** Whether the chip shows while paused. */
  whilePaused: boolean;
}
const READING: ChipSpec = { widthDmm: 300, sizeDmm: 20, whilePaused: true };
const NOT_SIMULATED: ChipSpec = { widthDmm: 300, sizeDmm: 16, whilePaused: false };

const ws = new Vector3();

function chipView(app: XrApp, ctx: PartViewContext, spec: ChipSpec, lineOf: (state: PartState, lang: Lang) => string | null): PartView {
  let chip: Chip | null = null;
  let want: PartState | null = null;
  let shown = false;
  let drawnKey = '';
  let drawnAt = -Infinity;
  const top = ctx.asset.sidecar.bounds.max[1];
  const object: Object3D = ctx.object;
  const lang = (): Lang => app.settings.lang.value;

  const draw = (now: number) => {
    if (!chip || !want) return;
    const l = lang();
    const line = lineOf(want, l);
    if (line === null) return;
    const key = `${l}|${line}`;
    if (key === drawnKey) return;
    drawnKey = key;
    drawnAt = now;
    chip.set({ lines: [line], lang: l });
  };
  const place = () => {
    if (!chip) return;
    object.getWorldScale(ws);
    const s = ws.x > 0 ? ws.x : 1;
    chip.group.scale.setScalar(1 / s);
    chip.group.position.set(0, top + (GAP_M + chip.h / 2) / s, 0);
  };
  const setShown = (on: boolean) => {
    if (on === shown) return;
    if (on) {
      const n = showing.get(app) ?? 0;
      if (n >= MAX_CHIPS) return;
      showing.set(app, n + 1);
      if (!chip) {
        chip = textChip({ widthDmm: spec.widthDmm, sizeDmm: spec.sizeDmm, lines: 1, distanceM: 0.6, mono: true });
        chip.group.name = 'part-chip';
        object.add(chip.group);
      }
      chip.group.visible = true;
      place();
      draw(performance.now());
    } else {
      showing.set(app, Math.max(0, (showing.get(app) ?? 1) - 1));
      if (chip) chip.group.visible = false;
    }
    shown = on;
  };
  const visibleNow = (): boolean => {
    const s = app.sim.state;
    return s === 'running' || (spec.whilePaused && s === 'paused');
  };
  const offLang = app.settings.lang.subscribe(() => {
    if (shown) draw(performance.now());
  });
  const offState = app.sim.onState(() => {
    if (want && visibleNow() !== shown) setShown(visibleNow());
  });
  return {
    partId: ctx.partId,
    update(state: PartState) {
      want = state;
      if (!shown) {
        if (visibleNow()) setShown(true);
        return;
      }
      const now = performance.now();
      if (now - drawnAt >= CHIP_MS) draw(now);
    },
    tick() {
      if (!shown || !chip) return;
      const now = performance.now();
      if (now - drawnAt >= CHIP_MS) draw(now);
      place();
      faceViewer(chip.group, app.world.camera);
    },
    reset() {
      want = null;
      drawnKey = '';
      setShown(false);
    },
    dispose() {
      offLang();
      offState();
      setShown(false);
      chip?.dispose();
      chip = null;
    },
  };
}

/** The readout chip: what a sensor, a meter or a source reads, over the part. */
export function readingView(app: XrApp): PartViewFactory {
  return (ctx) => chipView(app, ctx, READING, (s, lang) => (s.kind === 'reading' ? readingLine(s, lang) : null));
}

/** The small chip over a part the simulator does not model yet. */
export function notModelledView(app: XrApp): PartViewFactory {
  return (ctx) => chipView(app, ctx, NOT_SIMULATED, (s, lang) => (s.kind === 'not-modelled' ? viewStrings.t(lang, 'notSimulated') : null));
}
