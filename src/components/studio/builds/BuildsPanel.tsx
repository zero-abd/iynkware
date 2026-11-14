"use client";

import { useMemo } from "react";
import { Button, Callout, EmptyState, Icon, Meter, Select, StatStrip, TextInput } from "@/components/ui";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/namespaces";
import { type MessageKey, createTranslator } from "@/i18n/translate";
import { histogram, passCount, summarize, type Bin, type Range } from "@/sim/analog/spread";
import type { BuildResult, Measure, Quantity } from "@/sim-host/montecarlo/protocol";
import type { DocStore } from "@/studio/stores/doc";
import { useStoreSelector } from "@/studio/stores/select";
import { FIDELITY_PREFIX } from "@/studio/problems";
import { formatValue, parseValue } from "@/studio/units";
import { Histogram, type BarTone } from "./Histogram";
import { BINS, BUILDS, UNIT_OF, burnsOf, formatReading, targetsOf, watchedNode } from "./model";
import { type Builds, stillOpen } from "./useBuilds";

export interface BuildsPanelProps {
  doc: DocStore;
  builds: Builds;
  /** Shows the build in the run view: the run starts again on it. */
  onOpened(result: BuildResult): void;
  messages: Messages["studio"];
  fidelity: Messages["fidelity"];
  lang: Locale;
}

const QUANTITIES: readonly Quantity[] = ["volts", "amps", "hz"];
const NO_LIMITS = { min: -1e12, max: 1e12 };

/** An empty field is no limit; one that does not read as a number is an error the field says. */
function rangeOf(text: string, unit: (typeof UNIT_OF)[Quantity]): { value: number | undefined; error: boolean } {
  if (text.trim() === "") return { value: undefined, error: false };
  const parsed = parseValue(text, unit, NO_LIMITS);
  return parsed.ok ? { value: parsed.value, error: false } : { value: undefined, error: true };
}

export function BuildsPanel({ doc, builds, onOpened, messages, fidelity, lang }: BuildsPanelProps) {
  const t = useMemo(() => createTranslator(lang, messages, `${lang}/studio`), [lang, messages]);
  const tf = useMemo(() => createTranslator(lang, fidelity, `${lang}/fidelity`), [lang, fidelity]);
  const state = useStoreSelector(doc, (s) => s.state);
  const readOnly = useStoreSelector(doc, (s) => s.readOnly);
  const { settings, run, seconds, change } = builds;
  const running = run.phase === "running";

  const options = useMemo(() => targetsOf(state, settings.quantity), [state, settings.quantity]);
  const preferred = useMemo(() => watchedNode(state), [state]);
  const picked = options.find((o) => o.value === settings.target) ?? options.find((o) => o.target === preferred) ?? options[0];
  const measure: Measure | null = picked ? { quantity: settings.quantity, target: picked.target } : null;
  const refdesOf = useMemo(() => new Map([...state.components, ...state.boards].map((c) => [c.id, c.refdes])), [state]);

  const shown = run.phase === "done" ? run.shown : null;
  const quantity = shown?.measure.quantity ?? settings.quantity;
  const unit = UNIT_OF[quantity];
  const min = rangeOf(settings.min, unit);
  const max = rangeOf(settings.max, unit);
  const range: Range = { ...(min.value === undefined ? {} : { min: min.value }), ...(max.value === undefined ? {} : { max: max.value }) };
  const ranged = min.value !== undefined || max.value !== undefined;

  const open = stillOpen(state, builds.opened);
  const seeded = (state.simulation.solver.options as { toleranceMode?: unknown } | undefined)?.toleranceMode === "seeded";

  const show = (value: number) => formatReading(value, quantity);
  const rangeText = (): string =>
    min.value !== undefined && max.value !== undefined
      ? t("builds.range.between", { min: show(min.value), max: show(max.value) })
      : min.value !== undefined
        ? t("builds.range.atLeast", { min: show(min.value) })
        : t("builds.range.atMost", { max: show(max.value ?? 0) });

  const quantityOptions = QUANTITIES.map((q) => ({ value: q, label: t(`builds.quantity.${q}` as MessageKey<Messages["studio"]>) }));

  function renderResults() {
    if (run.phase !== "done" || shown === null) return null;
    const values = run.results.map((r) => r.value);
    const summary = summarize(values);
    const bins = histogram(values, BINS);
    const without = values.filter((v) => v === null).length;
    const burns = burnsOf(run.results);
    const burntBuilds = run.results.filter((r) => r.burnt.length > 0).length;
    const passes = ranged ? passCount(values, range) : null;
    const whatLabel = t(`builds.quantity.${shown.measure.quantity}` as MessageKey<Messages["studio"]>).toLowerCase();
    const toneOf = (bin: Bin): BarTone => {
      if (!ranged) return "plain";
      const inside = bin.builds.filter((i) => passCount([values[i]], range) === 1).length;
      return inside === bin.builds.length ? "inside" : inside === 0 ? "outside" : "mixed";
    };
    const barLabel = (bin: Bin) => {
      const tone = toneOf(bin);
      const base = t("builds.histogram.bar", { count: bin.builds.length, lo: show(bin.lo), hi: show(bin.hi) });
      return tone === "plain" ? base : `${base} ${t(tone === "inside" ? "builds.histogram.barPass" : tone === "mixed" ? "builds.histogram.barMixed" : "builds.histogram.barOut")}`;
    };
    // The middle build of the bar by value: the one that stands for it.
    const openBin = (bin: Bin) => {
      const result = run.results[bin.builds[bin.builds.length >> 1]];
      if (result) onOpened(result);
    };

    return (
      <section aria-label={t("builds.results.label")} className="flex flex-col gap-4" data-testid="builds-results">
        {summary === null ? (
          <Callout tone="warn" live>
            {t("builds.results.allNone")}
          </Callout>
        ) : (
          <>
            <StatStrip
              stats={[
                { id: "lowest", label: t("builds.results.lowest"), value: show(summary.min) },
                { id: "median", label: t("builds.results.median"), value: show(summary.median) },
                { id: "highest", label: t("builds.results.highest"), value: show(summary.max) },
                ...(passes === null
                  ? []
                  : [
                      {
                        id: "pass",
                        label: t("builds.results.pass"),
                        value: t("builds.results.passValue", { pass: passes, total: run.results.length }),
                        hint: t("builds.results.passHint", { range: rangeText() }),
                        tone: passes === run.results.length ? ("good" as const) : passes === 0 ? ("bad" as const) : ("warn" as const),
                      },
                    ]),
              ]}
              data-testid="builds-stats"
            />
            <Histogram
              label={t("builds.histogram.label", { what: whatLabel, n: summary.count, lo: show(summary.min), hi: show(summary.max) })}
              bins={bins}
              ends={{ low: show(bins[0].lo), high: show(bins[bins.length - 1].hi) }}
              tone={toneOf}
              barLabel={barLabel}
              onOpen={openBin}
              disabled={readOnly}
            />
            <p className="text-sm text-muted text-pretty">{readOnly ? t("builds.open.readOnly") : t("builds.histogram.hint")}</p>
          </>
        )}
        {without > 0 && summary !== null ? (
          <p className="text-sm text-muted text-pretty" data-testid="builds-no-reading">
            {shown.measure.quantity === "hz"
              ? t("builds.results.noReading.hz", { n: without, time: formatValue(shown.seconds, "second") })
              : t("builds.results.noReading.plain", { n: without })}
          </p>
        ) : null}
        <div className="flex flex-col gap-2" data-testid="builds-burnt">
          <div className="kicker">{t("builds.results.burnt")}</div>
          {burns.length === 0 ? (
            <p className="text-sm text-muted">{t("builds.results.burntNone")}</p>
          ) : (
            <>
              <p className="text-sm text-bad">{t("builds.results.burntSome", { n: burntBuilds, total: run.results.length })}</p>
              <ul className="flex flex-wrap gap-2">
                {burns.map((burn) => {
                  const name = refdesOf.get(burn.part) ?? burn.part;
                  const why = run.results[burn.first].burnt.find((b) => b.part === burn.part);
                  return (
                    <li key={burn.part}>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={readOnly}
                        title={why ? tf(why.key.slice(FIDELITY_PREFIX.length) as MessageKey<Messages["fidelity"]>, { ...why.args, name }) : undefined}
                        aria-label={t("builds.results.burntOpen", { part: name })}
                        onClick={() => onOpened(run.results[burn.first])}
                      >
                        <Icon name="danger" size={16} className="text-bad" />
                        {t("builds.results.burntPart", { part: name, n: burn.count })}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        <p className="text-sm text-muted tabular-nums">{t("builds.results.took", { total: run.results.length, seconds: (run.wallMs / 1000).toFixed(1) })}</p>
      </section>
    );
  }

  return (
    <section aria-label={t("builds.run")} className="flex min-w-0 flex-col gap-4 p-2" data-testid="builds-panel">
      <p className="text-sm text-muted text-pretty">{t("builds.lede")}</p>

      <div className="flex flex-col gap-3">
        <Select
          label={t("builds.quantity.label")}
          value={settings.quantity}
          disabled={running}
          onChange={(e) => change({ quantity: e.target.value as Quantity, target: null })}
        >
          {quantityOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select
          label={t(settings.quantity === "amps" ? "builds.where.amps" : "builds.where.volts")}
          value={picked?.value ?? ""}
          disabled={running || options.length === 0}
          hint={options.length === 0 ? t("builds.where.none") : undefined}
          onChange={(e) => change({ target: e.target.value })}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <TextInput
          label={t("builds.time.label")}
          value={settings.seconds}
          inputMode="decimal"
          disabled={running}
          className="font-mono tabular-nums"
          hint={seconds === null ? undefined : t("builds.time.hint")}
          error={seconds === null ? t("builds.time.invalid") : undefined}
          onChange={(e) => change({ seconds: e.target.value })}
        />
        <Select label={t("builds.resistors.label")} value={settings.resistors} disabled={running} onChange={(e) => change({ resistors: e.target.value as "part" | "precision" })}>
          <option value="part">{t("builds.resistors.part")}</option>
          <option value="precision">{t("builds.resistors.precision")}</option>
        </Select>
        <fieldset className="flex flex-col gap-1">
          <legend className="field-label mb-1">{t("builds.range.title")}</legend>
          <div className="grid grid-cols-2 gap-3">
            <TextInput
              label={t("builds.range.min")}
              value={settings.min}
              inputMode="decimal"
              className="font-mono tabular-nums"
              error={min.error ? t("builds.range.invalid") : undefined}
              onChange={(e) => change({ min: e.target.value })}
            />
            <TextInput
              label={t("builds.range.max")}
              value={settings.max}
              inputMode="decimal"
              className="font-mono tabular-nums"
              error={max.error ? t("builds.range.invalid") : undefined}
              onChange={(e) => change({ max: e.target.value })}
            />
          </div>
          <p className="text-sm text-muted text-pretty">{t("builds.range.hint")}</p>
        </fieldset>
      </div>

      <div className="flex items-center gap-2">
        {running ? (
          <Button variant="secondary" onClick={builds.cancel}>
            <Icon name="stop" size={16} />
            {t("builds.cancel")}
          </Button>
        ) : (
          <Button variant="primary" disabled={measure === null || seconds === null} onClick={() => builds.start(measure)}>
            <Icon name="play" size={16} />
            {t("builds.run")}
          </Button>
        )}
      </div>

      {run.phase === "running" ? (
        <div role="status" data-testid="builds-progress">
          <Meter label={t("builds.progress", { done: run.done, total: BUILDS })} value={run.done} max={BUILDS} valueText={`${run.done} / ${BUILDS}`} />
        </div>
      ) : null}
      {run.phase === "cancelled" ? <Callout tone="note" live>{t("builds.cancelled", { done: run.done })}</Callout> : null}
      {run.phase === "failed" ? <Callout tone="danger" live>{t("builds.failed", { message: run.message })}</Callout> : null}
      {run.phase === "refused" ? (
        <Callout tone="warn" live>
          {run.reason === "bad-doc" ? t("builds.refused.bad-doc", { detail: run.detail ?? "" }) : t(`builds.refused.${run.reason}` as MessageKey<Messages["studio"]>)}
        </Callout>
      ) : null}

      {seeded ? (
        <Callout tone="note" live title={t("builds.open.label")}>
          <p>{open ? t("builds.open.from", { index: open.index + 1, seed: open.seed }) : t("builds.open.banner", { seed: state.simulation.seed })}</p>
          <Button variant="secondary" size="sm" className="mt-2" disabled={readOnly} onClick={builds.back}>
            {t("builds.open.back")}
          </Button>
        </Callout>
      ) : null}

      {run.phase === "idle" ? <EmptyState icon="empty" title={t("builds.empty.title")} bordered>{t("builds.empty.body")}</EmptyState> : null}
      {renderResults()}
    </section>
  );
}
