"use client";

import { useMemo } from "react";
import { Callout, Select, Toggle } from "@/components/ui";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/namespaces";
import { createTranslator } from "@/i18n/translate";
import { waveValue } from "@/sim/analog/waveform";
import { BENCH_LIMITS, type FgenSettings, WAVE_SHAPES } from "@/studio/instruments/bench";
import { coarseAboveHz, generatorRateHz, isCoarse, pointsPerPeriod } from "@/studio/instruments/sampling";
import { formatValue } from "@/studio/units";
import { type BenchProps, ReturnSelect, StatusLine } from "./BenchShared";
import { ValueField } from "./ValueField";

const PREVIEW = { w: 160, h: 48, pad: 4, periods: 2, points: 96 } as const;

/** Two periods of the output, scaled to its own peak so the shape and the duty read at a glance. */
function Preview({ s, label }: { s: FgenSettings; label: string }) {
  const path = useMemo(() => {
    const wave = { shape: s.shape, amplitudeV: 1, offsetV: 0, hz: 1, duty: s.dutyPercent / 100, phaseDeg: 0 };
    const pts = Array.from({ length: PREVIEW.points + 1 }, (_, i) => {
      const x = (i / PREVIEW.points) * PREVIEW.w;
      const y = PREVIEW.h / 2 - waveValue(wave, (i / PREVIEW.points) * PREVIEW.periods) * (PREVIEW.h / 2 - PREVIEW.pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return pts.join(" ");
  }, [s.shape, s.dutyPercent]);
  return (
    <svg viewBox={`0 0 ${PREVIEW.w} ${PREVIEW.h}`} role="img" aria-label={label} className="h-12 w-full max-w-40 rounded-lg bg-console">
      <line x1="0" x2={PREVIEW.w} y1={PREVIEW.h / 2} y2={PREVIEW.h / 2} stroke="#313131" />
      <polyline points={path} fill="none" stroke="#8af0ae" strokeWidth="1.5" />
    </svg>
  );
}

interface FgenProps extends BenchProps {
  settings: FgenSettings;
  /** The step the project's transient run takes, which the generator is sampled at. */
  stepNs: number;
  onChange(patch: Partial<FgenSettings>): void;
}

export function FunctionGenerator({ settings, stepNs, onChange, editable, status, messages, lang, returns, returnValue, onReturn }: FgenProps) {
  const t = createTranslator(lang, messages, `${lang}/instruments`);
  const field = { disabled: !editable, messages, lang };
  const rate = generatorRateHz(settings.hz, stepNs);
  const hertz = (hz: number) => formatValue(Number(hz.toPrecision(3)), "hertz");
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="function-generator">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Select label={t("fgen.shape")} value={settings.shape} disabled={!editable} onChange={(e) => onChange({ shape: e.target.value as FgenSettings["shape"] })}>
          {WAVE_SHAPES.map((shape) => (
            <option key={shape} value={shape}>
              {t(`fgen.shapes.${shape}`)}
            </option>
          ))}
        </Select>
        <ValueField {...field} label={`${t("fgen.hz")} (Hz)`} unit="hertz" value={settings.hz} min={BENCH_LIMITS.hz.min} max={BENCH_LIMITS.hz.max} onValue={(hz) => onChange({ hz })} />
        <ValueField {...field} label={`${t("fgen.amplitude")} (V)`} unit="volt" value={settings.amplitudeV} min={BENCH_LIMITS.amplitudeV.min} max={BENCH_LIMITS.amplitudeV.max} onValue={(amplitudeV) => onChange({ amplitudeV })} />
        <ValueField {...field} label={`${t("fgen.offset")} (V)`} unit="volt" value={settings.offsetV} min={BENCH_LIMITS.offsetV.min} max={BENCH_LIMITS.offsetV.max} onValue={(offsetV) => onChange({ offsetV })} />
        {settings.shape === "pulse" ? (
          <ValueField {...field} label={t("fgen.duty")} unit="none" value={settings.dutyPercent} min={BENCH_LIMITS.dutyPercent.min} max={BENCH_LIMITS.dutyPercent.max} onValue={(dutyPercent) => onChange({ dutyPercent })} />
        ) : null}
        <ReturnSelect returns={returns} returnValue={returnValue} onReturn={onReturn} editable={editable} messages={messages} lang={lang} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Preview s={settings} label={t("bench.preview")} />
        <Toggle label={t("bench.output")} checked={settings.on} disabled={!editable} onChange={(on) => onChange({ on })} />
      </div>
      <p className="text-sm tabular-nums text-muted" data-testid="fgen-rate">
        {t("fgen.sampleRate", { rate: hertz(rate) })}
      </p>
      {isCoarse(settings.hz, rate) ? (
        <Callout tone="note" variant="quiet" live>
          {t("fgen.coarse", { limit: hertz(coarseAboveHz(rate)), points: Number(pointsPerPeriod(settings.hz, rate).toPrecision(2)).toLocaleString(lang), hz: hertz(settings.hz) })}
        </Callout>
      ) : null}
      <StatusLine status={status} messages={messages} lang={lang} />
    </div>
  );
}
