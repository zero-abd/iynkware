"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Button, Chip, EmptyState, Icon, IconButton, InlineStatus, Select, TextArea, cx } from "@/components/ui";
import { cryptoRandom, newProjectId } from "@/core/ids";
import { writeIynk, readIynk } from "@/export/iynk";
import type { Locale } from "@/i18n/config";
import type { StudioMessages } from "@/i18n/namespaces";
import { createTranslator } from "@/i18n/translate";
import { getAppRegistry } from "@/parts/builtin";
import { forkProject } from "@/project/fork";
import { checkAssignment } from "@/studio/assignment/assignment";
import { codeOf, decodeAssignment } from "@/studio/assignment/codec";
import { createGrading } from "@/studio/assignment/grade-client";
import { readSubmission } from "@/studio/assignment/submission";
import { ASSIGNMENT_EXT, type AssignmentInfo, type AssignmentProject, type PartRef } from "@/studio/assignment/types";
import { gradeSubmission, type Graded } from "@/studio/assignment/verify";
import { navigate } from "@/studio/router";
import { LOCAL_ACTOR } from "@/studio/templates";
import { useServices } from "../wiring/services";
import { checkText, detailText, partNameIn, type AssignmentT } from "./describe";
import { madeAssignments } from "./memory";

type Props = { messages: StudioMessages; lang: Locale };

type Row = { key: number; file: string } & ({ state: "grading" } | { state: "done"; graded: Graded } | { state: "error"; reason: string });

/** Submissions larger than this are not read: a project is far below it. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type Loaded = { project: AssignmentProject; info: AssignmentInfo };

const loadedFrom = (project: AssignmentProject): Loaded => ({ project, info: project.ext[ASSIGNMENT_EXT] });

export function GradeSubmissions({ messages, lang }: Props) {
  const t = useMemo(() => createTranslator(lang, messages.assignment, `${lang}/assignment`), [lang, messages.assignment]);
  const { files } = useServices();
  const [saved] = useState(madeAssignments);
  const [assignment, setAssignment] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState(false);
  const [paste, setPaste] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [code, setCode] = useState("");
  const [dragging, setDragging] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);
  const grading = useRef<ReturnType<typeof createGrading> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const next = useRef(0);
  const alive = useRef(true);
  const picker = useRef<HTMLInputElement>(null);
  const assignmentPicker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      grading.current?.dispose();
    };
  }, []);

  function choose(project: AssignmentProject) {
    setAssignment(loadedFrom(project));
    setRows([]);
    setProblem(false);
  }

  async function openCode(text: string) {
    const found = codeOf(text);
    const decoded = found === null ? null : await decodeAssignment(found, getAppRegistry());
    if (decoded?.ok) choose(decoded.value);
    else setProblem(true);
  }

  async function openAssignmentFile(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    const read = file.size > MAX_FILE_BYTES ? null : readIynk(new Uint8Array(await file.arrayBuffer()), Date.now);
    const checked = read?.ok ? checkAssignment(read.project) : null;
    if (checked?.ok) choose(checked.value);
    else setProblem(true);
  }

  function addText(name: string, read: () => Promise<string>) {
    const key = ++next.current;
    const current = assignment;
    if (!current) return;
    setRows((all) => [...all, { key, file: name, state: "grading" }]);
    const finish = (row: Row) => {
      if (alive.current) setRows((all) => all.map((r) => (r.key === key ? row : r)));
    };
    queue.current = queue.current.then(async () => {
      try {
        const parsed = await readSubmission(await read(), getAppRegistry());
        if (!parsed.ok) return finish({ key, file: name, state: "error", reason: parsed.error.message });
        grading.current ??= createGrading();
        const graded = await gradeSubmission(current.project, parsed.value, grading.current.grade);
        finish({ key, file: name, state: "done", graded });
      } catch (e) {
        finish({ key, file: name, state: "error", reason: e instanceof Error ? e.message : String(e) });
      }
    });
  }

  function addFiles(list: FileList | null) {
    for (const file of list ? [...list] : []) {
      addText(file.name, async () => {
        if (file.size > MAX_FILE_BYTES) throw new Error("too large");
        return file.text();
      });
    }
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  async function openCopy(row: Row & { state: "done" }) {
    if (!assignment) return;
    const { graded } = row;
    setOpening(row.key);
    try {
      const copy = forkProject(graded.project, {
        id: newProjectId(Date.now(), cryptoRandom),
        now: new Date().toISOString(),
        actor: LOCAL_ACTOR,
        title: t("grade.copyTitle", { title: assignment.info.title, student: graded.student }),
      });
      const outcome = await files.importBytes(writeIynk(copy), `${copy.meta.title}.iynk`);
      if (outcome.ok) navigate({ kind: "project", id: outcome.id, autorun: false });
    } finally {
      if (alive.current) setOpening(null);
    }
  }

  const checks = assignment?.info.checks ?? [];
  const part = assignment ? partNameIn(assignment.project) : (c: PartRef) => c.part;
  const pending = rows.filter((r) => r.state === "grading").length;

  return (
    <div className="mt-8 flex flex-col gap-8">
      <header className="max-w-[65ch]">
        <h2 className="text-balance text-2xl font-semibold tracking-tight">{t("grade.title")}</h2>
        <p className="mt-2 text-pretty text-base text-muted">{t("grade.lede")}</p>
      </header>

      <section aria-labelledby="grade-assignment" className="flex max-w-2xl flex-col gap-3">
        <h3 id="grade-assignment" className="kicker">
          {t("grade.assignment")}
        </h3>
        {saved.length > 0 ? (
          <Select
            label={t("grade.saved")}
            value={saved.find((s) => s.id === assignment?.info.id)?.id ?? ""}
            onChange={async (e) => {
              const picked = saved.find((s) => s.id === e.target.value);
              const decoded = picked && (await decodeAssignment(picked.code, getAppRegistry()));
              if (decoded?.ok) choose(decoded.value);
              else setProblem(true);
            }}
          >
            <option value="" disabled>
              {t("grade.choose")}
            </option>
            {saved.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </Select>
        ) : null}
        <TextArea label={t("grade.paste")} rows={2} value={paste} className="font-mono text-xs tabular-nums" onChange={(e) => setPaste(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={paste.trim() === ""} onClick={() => void openCode(paste)}>
            {t("grade.use")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => assignmentPicker.current?.click()}>
            {t("grade.file")}
          </Button>
          <input
            ref={assignmentPicker}
            type="file"
            accept=".iynk"
            data-testid="grade-assignment-file"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void openAssignmentFile(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {problem ? (
          <InlineStatus tone="bad" live>
            {t("grade.invalid")}
          </InlineStatus>
        ) : assignment ? (
          <InlineStatus tone="good" live>
            {t("grade.loaded", { title: assignment.info.title, n: checks.length })}
          </InlineStatus>
        ) : (
          <p className="text-sm text-muted">{t("grade.none")}</p>
        )}
      </section>

      {assignment ? (
        <section aria-labelledby="grade-submissions" className="flex flex-col gap-4">
          <h3 id="grade-submissions" className="kicker">
            {t("grade.submissions")}
          </h3>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
            className={cx("flex flex-col items-start gap-3 rounded-2xl border border-dashed p-4 motion-fade sm:flex-row sm:items-center", dragging ? "border-accent bg-hover" : "border-rule")}
          >
            <Icon name="download" size={32} className="shrink-0 text-muted" />
            <p className="min-w-0 flex-1 text-base">{t("grade.drop")}</p>
            <Button variant="secondary" onClick={() => picker.current?.click()}>
              {t("grade.choose2")}
            </Button>
            <input
              ref={picker}
              type="file"
              multiple
              accept=".json,.iynk-submission"
              data-testid="grade-files"
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          <div className="flex max-w-2xl flex-col gap-2">
            <TextArea label={t("grade.pasteCode")} rows={2} value={code} className="font-mono text-xs tabular-nums" onChange={(e) => setCode(e.target.value)} />
            <div>
              <Button
                variant="secondary"
                size="sm"
                disabled={code.trim() === ""}
                onClick={() => {
                  const text = code;
                  setCode("");
                  addText("code", async () => text);
                }}
              >
                {t("grade.add")}
              </Button>
            </div>
          </div>

          {pending > 0 ? (
            <p role="status" className="text-sm text-muted tabular-nums">
              {t("grade.grading", { done: rows.length - pending, total: rows.length })}
            </p>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState icon="people" title={t("grade.empty")} bordered />
          ) : (
            <>
              <ol className="grid max-w-3xl gap-1 text-sm">
                {checks.map((c, i) => (
                  <li key={c.id} className="flex gap-2">
                    <span className="w-6 shrink-0 text-end font-mono tabular-nums text-muted">{i + 1}</span>
                    <span className="min-w-0">{checkText(t, { ...c, visibility: "visible" }, part)}</span>
                  </li>
                ))}
              </ol>
              <div className="overflow-x-auto rounded-2xl border border-rule">
                <table data-testid="grade-table" className="w-full min-w-max border-collapse text-start text-sm">
                  <thead>
                    <tr className="bg-sunken text-start">
                      <th scope="col" className="p-3 text-start font-semibold">
                        {t("grade.student")}
                      </th>
                      <th scope="col" className="p-3 text-start font-semibold">
                        {t("grade.score")}
                      </th>
                      {checks.map((c, i) => (
                        <th key={c.id} scope="col" title={checkText(t, { ...c, visibility: "visible" }, part)} className="p-3 text-center font-mono tabular-nums">
                          {i + 1}
                        </th>
                      ))}
                      <th scope="col" className="p-3 text-start font-semibold">
                        {t("grade.notes")}
                      </th>
                      <th scope="col" className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <SubmissionRow key={row.key} row={row} checks={checks} t={t} part={part} opening={opening === row.key} onOpen={openCopy} onRemove={() => setRows((all) => all.filter((r) => r.key !== row.key))} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

function notesOf(g: Graded, t: AssignmentT): string[] {
  return [!g.hashOk && t("grade.hashBad"), !g.assignmentOk && t("grade.otherAssignment"), g.lockedLost.length > 0 && t("grade.lockedLost"), g.mismatched.length > 0 && t("grade.mismatch")].filter((n): n is string => n !== false);
}

type RowProps = {
  row: Row;
  checks: AssignmentInfo["checks"];
  t: AssignmentT;
  part: (c: PartRef) => string;
  opening: boolean;
  onOpen(row: Row & { state: "done" }): void;
  onRemove(): void;
};

function SubmissionRow({ row, checks, t, part, opening, onOpen, onRemove }: RowProps) {
  const cells = 4 + checks.length;
  const remove = <IconButton icon="close" size="sm" label={t("grade.remove", { name: row.state === "done" ? row.graded.student : row.file })} onClick={onRemove} />;
  if (row.state !== "done") {
    return (
      <tr className="border-t border-rule" data-testid="grade-row" data-state={row.state}>
        <td colSpan={cells - 1} className="p-3 text-muted">
          {row.state === "grading" ? row.file : t("grade.unreadable", { name: row.file, reason: row.reason })}
        </td>
        <td className="p-3 text-end">{row.state === "error" ? remove : null}</td>
      </tr>
    );
  }
  const { graded } = row;
  const verdicts = new Map(graded.verdicts.map((v) => [v.id, v]));
  const notes = notesOf(graded, t);
  return (
    <tr className="border-t border-rule align-top" data-testid="grade-row" data-state="done">
      <th scope="row" className="p-3 text-start font-medium">
        {graded.student}
      </th>
      <td className="p-3 font-mono tabular-nums" data-testid="grade-score">
        {graded.passed}/{graded.total}
      </td>
      {checks.map((c) => {
        const v = verdicts.get(c.id);
        const detail = v && detailText(t, c, v.detail);
        return (
          <td key={c.id} className="p-3 text-center" title={detail}>
            {v ? (
              <>
                <Icon name={v.ok ? "check-circle" : "warn-circle"} size={16} className={cx("inline", v.ok ? "text-good" : "text-bad")} />
                <span className="sr-only">{v.ok ? t("grade.pass") : t("grade.fail")}</span>
              </>
            ) : (
              <span className="text-muted" aria-hidden="true">
                0
              </span>
            )}
          </td>
        );
      })}
      <td className="p-3">
        {notes.length === 0 ? (
          <span className="text-muted">{t("grade.ok")}</span>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {notes.map((n) => (
              <li key={n}>
                <Chip tone="warn">{n}</Chip>
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="p-3 text-end">
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="secondary" busy={opening} onClick={() => onOpen(row)}>
            {opening ? t("grade.opening") : t("grade.open")}
          </Button>
          {remove}
        </div>
      </td>
    </tr>
  );
}
