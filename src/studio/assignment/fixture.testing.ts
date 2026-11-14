import { builtinRegistry } from "@/parts/builtin";
import type { Project } from "@/project/generated/types";
import blink from "@/studio/starters/blink.project.json";
import { buildAssignment, type AssignmentDraft } from "./assignment";
import type { AssignmentCheck, AssignmentProject } from "./types";

export const parts = builtinRegistry();

export const IDS = { id: "prj_assign", now: "2026-11-10T00:00:00.000Z", actor: "usr_local" };

export const teacherBlink = (): Project => JSON.parse(JSON.stringify(blink)) as Project;

/** What a teacher would ask of the Blink circuit: the pin toggles once a second, the LED carries current and sees volts, nothing burns. */
export const BLINK_CHECKS: AssignmentCheck[] = [
  { id: "toggles", kind: "pin-toggles", label: "D13 toggles", pin: "D13", periodMs: [900, 1100], minCycles: 3, hint: "Wait 500 ms between the two writes." },
  { id: "amps", kind: "part-amps", part: "cmp_led1", refdes: "LED1", ref: "core.led-5mm", amps: [0.005, 0.02], atMs: 200 },
  { id: "volts", kind: "pin-volts", part: "cmp_led1", refdes: "LED1", ref: "core.led-5mm", pin: "A", volts: [1.5, 3.5], atMs: 200 },
  { id: "freq", kind: "pin-frequency", part: "brd_main", pin: "D13", hz: [0.9, 1.1], atMs: 8000, windowMs: 4000 },
  { id: "clean", kind: "no-errors" },
];

export function blinkAssignment(over: Partial<AssignmentDraft> = {}): AssignmentProject {
  return buildAssignment(teacherBlink(), { title: "Blink an LED", instructions: "Make the LED blink once a second.", checks: BLINK_CHECKS, mode: "as-is", locked: [], blankCode: false, ...over }, IDS);
}

export const CLOCK = { budgetMs: 60_000, now: () => 0 };
