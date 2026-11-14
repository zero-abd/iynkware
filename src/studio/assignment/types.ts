import type { Check, Project } from "../../project/generated/types.ts";
import type { AuthorCheckKind } from "../checks.ts";

/** The key in `Project.ext` that makes a project an assignment. */
export const ASSIGNMENT_EXT = "x-iynk-assignment";

export const SUBMISSION_FORMAT = "iynk.submission";

export const MAX_TITLE = 120;
export const MAX_INSTRUCTIONS = 4000;
export const MAX_HINT = 300;
export const MAX_CHECKS = 40;
export const MAX_STUDENT = 80;

type Range = [number, number];

type Visibility = { visibility?: "visible" | "hidden" };

export type AuthorCheck = Extract<Check, { kind: AuthorCheckKind }>;

/**
 * The part a check reads. `part` is its id in the teacher's project. A student who starts from the board alone adds
 * parts of their own with ids of their own, so a check also names the part's definition (`ref`): when the id is gone
 * and exactly one part has that definition, that is the part. `refdes` is only what the check shows.
 */
export type PartRef = { part: string; refdes?: string; ref?: string };

/** The volts between a pin and the ground net, read at an instant of the run. */
export type PinVoltsCheck = Visibility & PartRef & { kind: "pin-volts"; id: string; pin: string; volts: Range; atMs: number };

/** The amps through a part, read at an instant of the run. The sign does not matter. */
export type PartAmpsCheck = Visibility & PartRef & { kind: "part-amps"; id: string; amps: Range; atMs: number };

/** How often the voltage on a pin crosses the middle of its swing, over the `windowMs` that end at `atMs`. */
export type PinFrequencyCheck = Visibility & PartRef & { kind: "pin-frequency"; id: string; pin: string; hz: Range; atMs: number; windowMs: number };

/** The run raises no problem of severity error. */
export type NoErrorsCheck = Visibility & { kind: "no-errors"; id: string };

export type AssignmentCheck = (AuthorCheck | PinVoltsCheck | PartAmpsCheck | PinFrequencyCheck | NoErrorsCheck) & { hint?: string };

export const ANALOG_KINDS = ["pin-volts", "part-amps", "pin-frequency", "no-errors"] as const;

export type AnalogKind = (typeof ANALOG_KINDS)[number];

export type AssignmentInfo = {
  v: 1;
  /** What a submission names. It depends on the title, the instructions and the checks only. */
  id: string;
  title: string;
  instructions: string;
  checks: AssignmentCheck[];
};

/** A project that carries its assignment in `ext`. */
export type AssignmentProject = Project & { ext: Record<typeof ASSIGNMENT_EXT, AssignmentInfo> };

export type Verdict = { id: string; ok: boolean; detail?: string };

export type Submission = {
  format: typeof SUBMISSION_FORMAT;
  version: 1;
  assignment: string;
  student: string;
  at: string;
  /** What the student's device found. The teacher's view never takes it for true. */
  results: Verdict[];
  project: Project;
  hash: string;
};

export const isHidden = (c: AssignmentCheck): boolean => c.visibility === "hidden";
