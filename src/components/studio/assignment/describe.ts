import type { Messages } from "@/i18n/namespaces";
import type { MessageKey, Translate } from "@/i18n/translate";
import type { Project } from "@/project/generated/types";
import { resolvePart } from "@/studio/assignment/assignment";
import { isHidden, type AssignmentCheck, type PartRef } from "@/studio/assignment/types";

export type AssignmentT = Translate<Messages["assignment"]>;

type Key = MessageKey<Messages["assignment"]>;

const range = ([lo, hi]: readonly number[]): string => (lo === hi ? String(lo) : `${lo}–${hi}`);

/** How the part a check reads is called: its reference in this project, else the one the teacher saw, else its id. */
export const partNameIn =
  (project: Pick<Project, "boards" | "components">) =>
  (c: PartRef): string => {
    const id = resolvePart(project, c);
    return [...project.boards, ...project.components].find((p) => p.id === id)?.refdes ?? c.refdes ?? c.part;
  };

/** The check as a sentence in the reader's language. A hidden check says only that it is hidden. */
export function checkText(t: AssignmentT, c: AssignmentCheck, part: (c: PartRef) => string): string {
  if (isHidden(c)) return t("describe.hidden");
  const key = `describe.${c.kind}` as Key;
  switch (c.kind) {
    case "runs":
      return t(key, { minMs: c.minMs });
    case "serial":
      return t(key, { match: c.match });
    case "pin-level":
      return t(key, { pin: c.pin, level: t(c.level ? "describe.high" : "describe.low"), atMs: c.atMs });
    case "pin-toggles":
      return t(key, { pin: c.pin, periodMs: range(c.periodMs) });
    case "pwm":
      return t(key, { pin: c.pin, duty: range(c.duty), atMs: c.atMs });
    case "tone":
      return t(key, { pin: c.pin, hz: range(c.hz), atMs: c.atMs });
    case "servo":
      return t(key, { pin: c.pin, deg: range(c.deg), atMs: c.atMs });
    case "responds":
      return t(key, { pin: c.pin, withinMs: c.withinMs, input: c.after.input });
    case "pin-volts":
      return t(key, { part: part(c), pin: c.pin, volts: range(c.volts), atMs: c.atMs });
    case "part-amps":
      return t(key, { part: part(c), amps: range(c.amps), atMs: c.atMs });
    case "pin-frequency":
      return t(key, { part: part(c), pin: c.pin, hz: range(c.hz) });
    case "code":
    case "no-errors":
      return t(key);
  }
}

/** What the student reads under a check that fails: the teacher's hint, or the one the kind has. */
export function hintText(t: AssignmentT, c: AssignmentCheck): string {
  if (c.hint) return c.hint;
  const key = `hint.${c.kind}` as Key;
  return "pin" in c ? t(key, { pin: c.pin }) : t(key);
}

const CODES = new Set(["no-source", "no-board", "unsupported-language", "limit", "error", "refused", "no-program", "no-engine", "no-reading"]);

/** What a check measured, or why it could not: a code of the grader in words, a count of errors, or the measurement itself. */
export function detailText(t: AssignmentT, c: AssignmentCheck, detail: string | undefined): string | undefined {
  if (detail === undefined) return undefined;
  if (CODES.has(detail)) return t(`detail.${detail}` as Key);
  return c.kind === "no-errors" ? t("detail.errors", { n: Number(detail) }) : detail;
}
