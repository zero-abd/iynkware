"use client";

import { useState } from "react";
import { Button, Dialog, InlineStatus, TextInput } from "@/components/ui";
import { utf8Encode } from "@/core/canonical";
import { getAppRegistry } from "@/parts/builtin";
import type { Project } from "@/project/generated/types";
import { buildSubmission, submissionCode, submissionFile } from "@/studio/assignment/submission";
import { MAX_STUDENT, type AssignmentInfo, type Submission } from "@/studio/assignment/types";
import type { Grader } from "@/studio/assignment/verify";
import { download, fileStem } from "../download";
import type { AssignmentT } from "./describe";
import { rememberStudent, rememberedStudent } from "./memory";

type Props = {
  open: boolean;
  onClose(): void;
  project: Project;
  info: AssignmentInfo;
  grade: Grader;
  t: AssignmentT;
};

type Status = { tone: "good" | "bad"; text: string };

/** Hands the work in as a file or as a code. The checks run again on the way, so the file carries what they find now. */
export function HandIn({ open, onClose, project, info, grade, t }: Props) {
  const [student, setStudent] = useState(rememberedStudent);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  async function make(): Promise<Submission | null> {
    const name = student.trim();
    if (name === "") {
      setNameError(t("handIn.nameRequired"));
      return null;
    }
    setNameError(null);
    rememberStudent(name);
    setBusy(true);
    setStatus({ tone: "good", text: t("handIn.working") });
    try {
      const results = await grade(project, info.checks);
      const passed = results.filter((r) => r.ok).length;
      setStatus({ tone: "good", text: t("handIn.score", { passed, total: results.length }) });
      return buildSubmission(project, info, { student: name, at: new Date().toISOString(), results }, getAppRegistry());
    } catch {
      setStatus({ tone: "bad", text: t("handIn.failed") });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveFile() {
    const submission = await make();
    if (!submission) return;
    const name = `${fileStem(info.title)}-${fileStem(submission.student)}.iynk-submission.json`;
    download(utf8Encode(submissionFile(submission)), name, "application/json");
    setStatus({ tone: "good", text: t("handIn.downloaded", { name }) });
  }

  async function copyCode() {
    const submission = await make();
    if (!submission) return;
    try {
      await navigator.clipboard.writeText(await submissionCode(submission));
      setStatus({ tone: "good", text: t("handIn.copied") });
    } catch {
      setStatus({ tone: "bad", text: t("handIn.copyFailed") });
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("handIn.title")} description={t("handIn.lede")} closeLabel={t("handIn.close")}>
      <div className="flex flex-col gap-4">
        <TextInput label={t("handIn.name")} value={student} maxLength={MAX_STUDENT} autoComplete="name" error={nameError ?? undefined} onChange={(e) => setStudent(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" busy={busy} onClick={() => void saveFile()}>
            {t("handIn.download")}
          </Button>
          <Button variant="secondary" busy={busy} onClick={() => void copyCode()}>
            {t("handIn.copy")}
          </Button>
        </div>
        <div className="min-h-6">
          {status ? (
            <InlineStatus tone={status.tone} live>
              {status.text}
            </InlineStatus>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
