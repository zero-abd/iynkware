"use client";

import { useMemo, useState } from "react";
import { Button, Callout, Dialog, IconButton, InlineStatus, Select, TextArea, TextInput, Toggle } from "@/components/ui";
import { utf8Encode } from "@/core/canonical";
import { cryptoRandom, newProjectId } from "@/core/ids";
import { writeIynk } from "@/export/iynk";
import type { Locale } from "@/i18n/config";
import type { StudioMessages } from "@/i18n/namespaces";
import { createTranslator } from "@/i18n/translate";
import { getAppRegistry } from "@/parts/builtin";
import { buildAssignment, checkAssignment, projectChecks } from "@/studio/assignment/assignment";
import { LINK_LIMIT, assignmentLink, encodeAssignment } from "@/studio/assignment/codec";
import { STARTER_MODES, canBlankCode, type StarterMode } from "@/studio/assignment/starter";
import { MAX_HINT, MAX_INSTRUCTIONS, MAX_TITLE, type AssignmentCheck, type AssignmentProject } from "@/studio/assignment/types";
import { navigate } from "@/studio/router";
import { LOCAL_ACTOR } from "@/studio/templates";
import type { DocStore } from "@/studio/stores/doc";
import { useStoreSelector } from "@/studio/stores/select";
import { download, fileStem } from "../download";
import { checkText, partNameIn } from "./describe";
import { rememberMade } from "./memory";
import { NewCheck } from "./NewCheck";
import { useAssignmentServer } from "./server";

type Props = { open: boolean; onClose(): void; doc: DocStore; messages: StudioMessages; lang: Locale };

type Made = { assignment: AssignmentProject; code: string };
type Status = { tone: "good" | "bad" | "warn"; text: string };

const KB = 1024;

export function MakeAssignment(props: Props) {
  // The form starts again from the project each time it opens.
  return props.open ? <Form {...props} /> : null;
}

function Form({ onClose, doc, messages, lang }: Props) {
  const t = useMemo(() => createTranslator(lang, messages.assignment, `${lang}/assignment`), [lang, messages.assignment]);
  const state = useStoreSelector(doc, (s) => s.state);
  const server = useAssignmentServer();
  const [title, setTitle] = useState(state.meta.title);
  const [instructions, setInstructions] = useState("");
  const [mode, setMode] = useState<StarterMode>("as-is");
  const [blankCode, setBlankCode] = useState(false);
  const [locked, setLocked] = useState<ReadonlySet<string>>(new Set());
  const [checks, setChecks] = useState<AssignmentCheck[]>(() => projectChecks(state));
  const [titleError, setTitleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<string | null>(null);
  // One identity per opening, so the same form gives the same link and file every time.
  const [stamp] = useState(() => ({ id: newProjectId(Date.now(), cryptoRandom), now: new Date().toISOString() }));
  const part = partNameIn(state);
  const surfaces = useMemo(() => new Set(state.views.flatMap((v) => (v.surface === undefined ? [] : [v.surface]))), [state.views]);
  const lockable = state.components.filter((c) => mode !== "board-only" || surfaces.has(c.id));

  const edit = (id: string, change: Partial<Pick<AssignmentCheck, "hint" | "visibility">>) => setChecks((all) => all.map((c) => (c.id === id ? ({ ...c, ...change } as AssignmentCheck) : c)));

  /** The assignment and its code, or null once the form says what is wrong. */
  async function make(): Promise<Made | null> {
    if (title.trim() === "") {
      setTitleError(t("make.titleRequired"));
      return null;
    }
    setTitleError(null);
    if (checks.length === 0) {
      setStatus({ tone: "bad", text: t("make.noChecks") });
      return null;
    }
    setBusy(true);
    setStatus({ tone: "good", text: t("make.building") });
    try {
      const cleaned = checks.map((c) => (c.hint === "" ? ({ ...c, hint: undefined } as AssignmentCheck) : c)).map((c) => JSON.parse(JSON.stringify(c)) as AssignmentCheck);
      const assignment = buildAssignment(state, { title, instructions, checks: cleaned, mode, locked: [...locked], blankCode }, { ...stamp, actor: LOCAL_ACTOR });
      const valid = checkAssignment(assignment);
      if (!valid.ok) {
        setStatus({ tone: "bad", text: t("make.failed", { reason: valid.error.message }) });
        return null;
      }
      const code = await encodeAssignment(assignment, getAppRegistry());
      rememberMade({ id: assignment.ext["x-iynk-assignment"].id, title: assignment.meta.title, code });
      setStatus(null);
      return { assignment, code };
    } catch (e) {
      setStatus({ tone: "bad", text: t("make.failed", { reason: e instanceof Error ? e.message : String(e) }) });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    const made = await make();
    if (!made) return;
    if (made.code.length > LINK_LIMIT) {
      setLink(null);
      return setStatus({ tone: "warn", text: t("make.tooLarge", { kb: Math.ceil(made.code.length / KB) }) });
    }
    const url = assignmentLink(lang, window.location.origin, made.code);
    setLink(url);
    try {
      await navigator.clipboard.writeText(url);
      setStatus({ tone: "good", text: t("make.copied") });
    } catch {
      setStatus({ tone: "bad", text: t("make.copyFailed") });
    }
  }

  async function saveFile() {
    const made = await make();
    if (!made) return;
    const name = `${fileStem(made.assignment.meta.title)}.iynk`;
    download(writeIynk(made.assignment), name, "application/octet-stream");
    setStatus({ tone: "good", text: t("make.saved", { name }) });
  }

  async function shareFromServer() {
    const made = await make();
    if (!made || !server) return;
    setBusy(true);
    try {
      const { createShare } = await import("@/collab/share");
      const shared = await createShare(server.client, made.assignment, { audience: "link", expiry: { kind: "default" }, allowFork: true, label: title.trim().slice(0, 60) }, { readBlob: server.readBlob, lang, origin: window.location.origin });
      setLink(shared.link);
      setStatus({ tone: "good", text: t("make.serverDone") });
    } catch {
      setStatus({ tone: "bad", text: t("make.serverFailed") });
    } finally {
      setBusy(false);
    }
  }

  const tooLarge = status?.tone === "warn";

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={t("make.title")}
      description={t("make.lede")}
      closeLabel={t("make.close")}
      footer={
        <>
          <Button variant="ghost" onClick={() => (onClose(), navigate({ kind: "grade" }))}>
            {t("make.grade")}
          </Button>
          {tooLarge && server ? (
            <Button variant="secondary" busy={busy} onClick={() => void shareFromServer()}>
              {t("make.serverShare")}
            </Button>
          ) : null}
          <Button variant={tooLarge ? "primary" : "secondary"} busy={busy} onClick={() => void saveFile()}>
            {t("make.saveFile")}
          </Button>
          {tooLarge ? null : (
            <Button variant="primary" busy={busy} onClick={() => void copyLink()}>
              {t("make.copyLink")}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <TextInput label={t("make.titleField")} value={title} maxLength={MAX_TITLE} error={titleError ?? undefined} onChange={(e) => setTitle(e.target.value)} />
          <TextArea label={t("make.instructionsField")} hint={t("make.instructionsHint")} value={instructions} maxLength={MAX_INSTRUCTIONS} rows={4} onChange={(e) => setInstructions(e.target.value)} />
        </div>

        <div className="flex flex-col gap-3">
          <Select label={t("make.starterField")} value={mode} onChange={(e) => setMode(e.target.value as StarterMode)}>
            {STARTER_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`make.starter.${m}`)}
              </option>
            ))}
          </Select>
          {canBlankCode(state) ? <Toggle label={t("make.blankCode")} checked={blankCode} onChange={setBlankCode} /> : null}
        </div>

        <fieldset className="min-w-0">
          <legend className="kicker mb-1">{t("make.locked")}</legend>
          {lockable.length === 0 ? (
            <p className="text-sm text-muted">{t("make.lockedNone")}</p>
          ) : (
            <ul className="grid gap-x-6 sm:grid-cols-2">
              {lockable.map((c) => (
                <li key={c.id}>
                  <Toggle
                    label={c.refdes}
                    description={c.label}
                    checked={locked.has(c.id)}
                    onChange={(on) => setLocked((now) => new Set(on ? [...now, c.id] : [...now].filter((id) => id !== c.id)))}
                  />
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <section aria-labelledby="make-checks" className="flex flex-col gap-3">
          <div>
            <h3 id="make-checks" className="kicker">
              {t("make.checks")}
            </h3>
            <p className="mt-1 text-sm text-muted">{t("make.checksLede")}</p>
          </div>
          {checks.length === 0 ? <Callout tone="note">{t("make.noChecks")}</Callout> : null}
          <ul className="flex flex-col gap-3">
            {checks.map((c) => (
              <li key={c.id} data-testid="make-check" className="flex flex-col gap-2 rounded-xl border border-rule p-3">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-sm font-medium">{checkText(t, { ...c, visibility: "visible" }, part)}</p>
                  <IconButton icon="close" size="sm" label={t("make.remove")} onClick={() => setChecks((all) => all.filter((x) => x.id !== c.id))} />
                </div>
                <TextInput label={t("make.hintField")} maxLength={MAX_HINT} value={c.hint ?? ""} onChange={(e) => edit(c.id, { hint: e.target.value })} />
                <Toggle label={t("make.hiddenField")} checked={c.visibility === "hidden"} onChange={(on) => edit(c.id, { visibility: on ? "hidden" : "visible" })} />
              </li>
            ))}
          </ul>
          <NewCheck project={state} ids={new Set(checks.map((c) => c.id))} t={t} onAdd={(c) => setChecks((all) => [...all, c])} />
        </section>

        <div className="flex flex-col gap-2" aria-live="polite">
          {status ? <InlineStatus tone={status.tone === "warn" ? "warn" : status.tone}>{status.text}</InlineStatus> : null}
          {link ? <TextInput label={t("make.linkField")} readOnly value={link} className="text-xs" onFocus={(e) => e.currentTarget.select()} /> : null}
        </div>
      </div>
    </Dialog>
  );
}
