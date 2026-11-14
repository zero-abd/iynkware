"use client";

import { Chip, Stat, Toggle } from "@/components/ui";
import { createTranslator } from "@/i18n/translate";
import type { InstrumentReading } from "@/sim/analog/types";
import { BENCH_LIMITS, type PsuSettings } from "@/studio/instruments/bench";
import { formatValue } from "@/studio/units";
import { type BenchProps, ReturnSelect, StatusLine } from "./BenchShared";
import { ValueField } from "./ValueField";

interface PsuProps extends BenchProps {
  settings: PsuSettings;
  /** From the run's frame; null before the first one or while the output is off. */
  reading: InstrumentReading | null;
  onChange(patch: Partial<PsuSettings>): void;
}

export function PowerSupply({ settings, reading, onChange, editable, status, messages, lang, returns, returnValue, onReturn }: PsuProps) {
  const t = createTranslator(lang, messages, `${lang}/instruments`);
  const field = { disabled: !editable, messages, lang };
  const live = settings.on && status === "on" ? reading : null;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="power-supply">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ValueField {...field} label={`${t("psu.volts")} (V)`} unit="volt" value={settings.volts} min={BENCH_LIMITS.volts.min} max={BENCH_LIMITS.volts.max} onValue={(volts) => onChange({ volts })} />
        <ValueField {...field} label={`${t("psu.limit")} (A)`} unit="amp" value={settings.limitAmps} min={BENCH_LIMITS.limitAmps.min} max={BENCH_LIMITS.limitAmps.max} onValue={(limitAmps) => onChange({ limitAmps })} />
        <ReturnSelect returns={returns} returnValue={returnValue} onReturn={onReturn} editable={editable} messages={messages} lang={lang} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-sunken p-3" data-testid="psu-readout">
        <Stat size="md" label={t("psu.outV")} value={live ? formatValue(live.volts, "volt") : "-"} />
        <Stat size="md" label={t("psu.outA")} value={live ? formatValue(live.amps, "amp") : "-"} />
        {live ? (
          <Chip tone={live.limiting ? "warn" : "good"} title={t(live.limiting ? "psu.ccLong" : "psu.cvLong")} data-testid="psu-mode">
            {t(live.limiting ? "psu.cc" : "psu.cv")}
          </Chip>
        ) : (
          <span className="text-sm text-muted">{t("psu.noReading")}</span>
        )}
      </div>
      <Toggle label={t("bench.output")} checked={settings.on} disabled={!editable} onChange={(on) => onChange({ on })} />
      <StatusLine status={status} messages={messages} lang={lang} />
    </div>
  );
}
