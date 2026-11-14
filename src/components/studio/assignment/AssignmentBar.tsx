"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Chip, Icon, InlineStatus, cx } from "@/components/ui";
import type { Locale } from "@/i18n/config";
import type { StudioMessages } from "@/i18n/namespaces";
import { createTranslator } from "@/i18n/translate";
import { readAssignment } from "@/studio/assignment/assignment";
import { createGrading } from "@/studio/assignment/grade-client";
import type { Verdict } from "@/studio/assignment/types";
import type { DocStore } from "@/studio/stores/doc";
import { useStoreSelector } from "@/studio/stores/select";
import { checkText, detailText, hintText, partNameIn } from "./describe";
import { HandIn } from "./HandIn";

type Props = { doc: DocStore; messages: StudioMessages; lang: Locale };

type Results = { revision: number; byId: ReadonlyMap<string, Verdict> };

/** The student's strip above the editor: the assignment, its checks and the two buttons that matter. */
export function AssignmentBar({ doc, messages, lang }: Props) {
  const t = useMemo(() => createTranslator(lang, messages.assignment, `${lang}/assignment`), [lang, messages.assignment]);
  const state = useStoreSelector(doc, (s) => s.state);
  const revision = useStoreSelector(doc, (s) => s.revision);
  const info = readAssignment(state);
  const grading = useRef<ReturnType<typeof createGrading> | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(true);
  const [handing, setHanding] = useState(false);
  const bodyId = useId();

  useEffect(() => () => grading.current?.dispose(), []);
  const grader = () => (grading.current ??= createGrading());

  if (!info) return null;
  const part = partNameIn(state);
  const stale = results !== null && results.revision !== revision;
  const passed = results ? info.checks.filter((c) => results.byId.get(c.id)?.ok).length : 0;

  async function check() {
    if (!info || running) return;
    setRunning(true);
    setFailed(false);
    const at = doc.getState().revision;
    try {
      const verdicts = await grader().grade(doc.getState().state, info.checks);
      setResults({ revision: at, byId: new Map(verdicts.map((v) => [v.id, v])) });
    } catch {
      setFailed(true);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section aria-label={t("bar.label")} data-testid="assignment-bar" className="mx-2 mt-2 rounded-2xl border border-rule bg-surface">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <Icon name="book" size={20} className="shrink-0 text-muted" />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{info.title}</h2>
        <Chip tone="neutral">{t("bar.label")}</Chip>
        <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
          {open ? t("bar.hide") : t("bar.show")}
          <Icon name="chevron-down" size={16} className={cx("motion-move", open && "rotate-180")} />
        </Button>
        <Button size="sm" variant="secondary" busy={running} onClick={() => void check()}>
          {running ? t("bar.checking") : t("bar.check")}
        </Button>
        <Button size="sm" variant="primary" onClick={() => setHanding(true)}>
          {t("bar.handIn")}
        </Button>
      </div>
      {open ? (
        <div id={bodyId} className="grid gap-4 border-t border-rule p-3 md:grid-cols-2">
          <div className="min-w-0">
            <h3 className="kicker">{t("bar.instructions")}</h3>
            <p className="mt-1 max-w-[65ch] whitespace-pre-line text-pretty text-sm">{info.instructions || t("bar.noInstructions")}</p>
          </div>
          <div className="min-w-0">
            <h3 className="kicker">{t("bar.checks")}</h3>
            <p className="mt-1 text-sm tabular-nums" aria-live="polite">
              {results ? t("bar.summary", { passed, total: info.checks.length }) : t("bar.notRun")}
            </p>
            {stale ? (
              <InlineStatus tone="warn" className="mt-1">
                {t("bar.stale")}
              </InlineStatus>
            ) : null}
            {failed ? (
              <InlineStatus tone="bad" live className="mt-1">
                {t("bar.failed")}
              </InlineStatus>
            ) : null}
            <ul className="mt-2 flex flex-col gap-2">
              {info.checks.map((c) => {
                const verdict = results?.byId.get(c.id);
                const detail = verdict && detailText(t, c, verdict.detail);
                return (
                  <li key={c.id} data-testid="assignment-check" data-state={verdict ? (verdict.ok ? "pass" : "fail") : "idle"} className="flex items-start gap-2 text-sm">
                    <Icon name={verdict ? (verdict.ok ? "check-circle" : "warn-circle") : "target"} size={16} className={cx("mt-0.5 shrink-0", verdict ? (verdict.ok ? "text-good" : "text-bad") : "text-muted")} />
                    <div className="min-w-0">
                      <p>
                        {checkText(t, c, part)}
                        {verdict ? <span className="sr-only"> {verdict.ok ? t("bar.pass") : t("bar.fail")}</span> : null}
                      </p>
                      {detail ? <p className="font-mono text-xs tabular-nums text-muted">{detail}</p> : null}
                      {verdict && !verdict.ok && c.visibility !== "hidden" ? (
                        <p className="mt-0.5 text-pretty text-muted">{t("bar.hint", { text: hintText(t, c) })}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
      {handing ? <HandIn open onClose={() => setHanding(false)} project={state} info={info} grade={(p, c) => grader().grade(p, c)} t={t} /> : null}
    </section>
  );
}
