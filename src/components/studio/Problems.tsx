"use client";

import { useMemo, useState } from "react";
import { Button, Chip, EmptyState, Icon, InlineStatus, cx, type ChipTone, type IconName } from "@/components/ui";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/namespaces";
import { createTranslator, messageAt, type MessageKey } from "@/i18n/translate";
import type { ResolvedFix } from "@/studio/fixes";
import { FIDELITY_PREFIX, type Problem, type ProblemSeverity } from "@/studio/problems";
import { CHECK_BLOCK_TEXT, type CheckBlock } from "./wiring/faultLink";

/** What the project says to a fix that was asked for. */
export type FixOutcome = { ok: true } | { ok: false; message: string };

export interface FixActions {
  /** Applies one fix as one undoable step; `label` is its text, for the history. */
  apply(fix: ResolvedFix, label: string): FixOutcome;
  /** Applies the fixes together as one step. */
  applyAll(fixes: ResolvedFix[], label: string): FixOutcome;
  undo(): void;
}

export interface ProblemsProps {
  problems: readonly Problem[];
  onJump(problem: Problem): void;
  messages: Messages["studioCode"];
  /** The strings of the fault rules, which name their problems with keys of this namespace. */
  faultMessages: Messages["faults"];
  /** The strings of the parts that burn, which name their problems with keys of this namespace. */
  fidelityMessages: Messages["fidelity"];
  /** The strings of the robot checks, which name their problems with keys of this namespace. */
  robotMessages: Messages["robot"];
  lang: Locale;
  onCheck(): void;
  /** Why Check cannot run now; false when it can. */
  checkDisabled: false | CheckBlock;
  counts: { skipped: number; errors: number };
  fixes: FixActions;
}

const ICON: Record<ProblemSeverity, IconName> = { error: "danger", warning: "warn", note: "info" };
const TEXT: Record<ProblemSeverity, string> = { error: "text-bad", warning: "text-warn", note: "text-info" };
const TONE: Record<ProblemSeverity, ChipTone> = { error: "bad", warning: "warn", note: "info" };

type Notice = { tone: "good" | "bad"; text: string; undo: boolean };

/** One entry per distinct change: a solved finding and a static one that offer the same fix count once. */
function safeFixesOf(problems: readonly Problem[]): ResolvedFix[] {
  const seen = new Set<string>();
  return problems
    .flatMap((p) => p.fixes ?? [])
    .filter((fix) => fix.safe && fix.plan !== undefined && !seen.has(JSON.stringify(fix.plan)) && seen.add(JSON.stringify(fix.plan)));
}

export function Problems({ problems, onJump, messages, faultMessages, fidelityMessages, robotMessages, lang, onCheck, checkDisabled, counts, fixes }: ProblemsProps) {
  const t = useMemo(() => createTranslator(lang, messages, `${lang}/studioCode`), [lang, messages]);
  const ft = useMemo(() => createTranslator(lang, faultMessages, `${lang}/faults`), [lang, faultMessages]);
  const dt = useMemo(() => createTranslator(lang, fidelityMessages, `${lang}/fidelity`), [lang, fidelityMessages]);
  const rt = useMemo(() => createTranslator(lang, robotMessages, `${lang}/robot`), [lang, robotMessages]);
  const errors = problems.filter((p) => p.severity === "error").length;
  const safe = useMemo(() => safeFixesOf(problems), [problems]);
  const [notice, setNotice] = useState<Notice | null>(null);

  const report = (outcome: FixOutcome, text: string) =>
    setNotice(outcome.ok ? { tone: "good", text: ft("fixUi.applied", { fix: text }), undo: true } : { tone: "bad", text: ft("fixUi.failed", { message: outcome.message }), undo: false });
  const fixText = (fix: ResolvedFix): string => ft(`fix.${fix.messageKey.slice("fix.".length)}` as MessageKey<Messages["faults"]>, fix.args);

  const faultTitle = (p: Problem): string => {
    const cause = p.diagnosis ? `cause.${p.diagnosis.cause_id}.title` : "";
    if (typeof messageAt(faultMessages, cause) === "string") return ft(cause as MessageKey<Messages["faults"]>);
    return typeof messageAt(faultMessages, p.titleKey) === "string" ? ft(p.titleKey as MessageKey<Messages["faults"]>, p.args) : (p.rule ?? p.id);
  };

  return (
    <section aria-label={t("problems.title")} className="flex min-h-0 flex-col gap-2" data-testid="problems">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("problems.title")}</h3>
        {problems.length > 0 ? (
          <Chip tone={errors > 0 ? "bad" : "warn"} role="status">
            {t("problems.count", { count: problems.length })}
          </Chip>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-start gap-1">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={checkDisabled !== false} onClick={onCheck}>
            <Icon name="check-circle" size={16} />
            {ft("check.run")}
          </Button>
          {safe.length > 0 ? (
            <Button size="sm" variant="primary" onClick={() => report(fixes.applyAll(safe, ft("fixUi.all")), ft("fixUi.all"))}>
              <Icon name="tools" size={16} />
              {ft("fixUi.allCount", { count: safe.length })}
            </Button>
          ) : null}
        </div>
        {checkDisabled === false ? null : <p className="text-sm text-pretty text-muted">{ft(CHECK_BLOCK_TEXT[checkDisabled])}</p>}
      </div>
      {notice ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <InlineStatus tone={notice.tone} live>
            {notice.text}
          </InlineStatus>
          {notice.undo ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                fixes.undo();
                setNotice(null);
              }}
            >
              {ft("fixUi.undo")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {problems.length === 0 ? (
        <EmptyState icon="check-circle" title={t("problems.empty")} className="py-8">
          {t("problems.emptyHint")}
        </EmptyState>
      ) : (
        <ul className="flex min-h-0 flex-col overflow-y-auto">
          {problems.map((p) => {
            const severity = t(`problems.severity.${p.severity}`);
            const title =
              p.source === "robot"
                ? rt(p.titleKey as MessageKey<Messages["robot"]>, p.args)
                : p.titleKey.startsWith(FIDELITY_PREFIX)
                  ? dt(p.titleKey.slice(FIDELITY_PREFIX.length) as MessageKey<Messages["fidelity"]>, p.args)
                  : p.rule !== undefined
                    ? faultTitle(p)
                    : (p.fallbackText ?? t(p.titleKey as MessageKey<Messages["studioCode"]>, p.args));
            const where = p.line === undefined ? null : t("problems.line", { line: p.line });
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onJump(p)}
                  data-severity={p.severity}
                  className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-start text-sm motion-fade hover:bg-hover active:scale-98"
                >
                  <Icon name={ICON[p.severity]} size={16} className={cx("mt-0.5 shrink-0", TEXT[p.severity])} />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Chip tone={TONE[p.severity]}>{severity}</Chip>
                      {where ? <span className="font-mono tabular-nums text-muted">{where}</span> : null}
                    </span>
                    <span className="text-pretty">{title}</span>
                    {p.path ? <code className="text-muted break-all">{p.path}</code> : null}
                    {p.hint ? <span className="text-pretty text-muted">{t("problems.hint", { hint: p.hint })}</span> : null}
                  </span>
                </button>
                {p.fixes?.length ? (
                  <ul aria-label={ft("fixUi.heading")} className="mb-2 ms-8 flex flex-col gap-2">
                    {p.fixes.map((fix) => {
                      const text = fixText(fix);
                      return (
                        <li key={fix.messageKey + JSON.stringify(fix.args)} className="flex flex-col gap-2 rounded-lg border border-rule p-3 text-sm" data-testid="problem-fix">
                          <p className="text-pretty">{text}</p>
                          {fix.ops.length === 0 ? (
                            <p className="text-pretty text-muted">{ft("fixUi.advice")}</p>
                          ) : (
                            <>
                              <div className="grid grid-cols-2 gap-3">
                                {(["before", "after"] as const).map((side) => (
                                  <div key={side} className="flex min-w-0 flex-col gap-1">
                                    <span className="kicker">{ft(`fixUi.${side}`)}</span>
                                    <ul className="flex flex-col gap-1 font-mono text-xs tabular-nums break-words">
                                      {fix.preview[side].map((line) => (
                                        <li key={line}>{line}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button size="sm" variant="secondary" onClick={() => report(fixes.apply(fix, text), text)}>
                                  <Icon name="tools" size={16} />
                                  {ft("fixUi.apply")}
                                </Button>
                                <Chip tone={fix.safe ? "good" : "warn"}>{ft(fix.safe ? "fixUi.safe" : "fixUi.review")}</Chip>
                              </div>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="shrink-0 text-sm tabular-nums text-muted">{ft("check.footer", counts)}</p>
    </section>
  );
}
