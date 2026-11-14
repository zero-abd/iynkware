import type { Project } from "@/project/generated/types";
import type { Drawn } from "@/sim/analog/part-tolerance";
import type { ProgramImage } from "@/sim/engine";

export type Quantity = "volts" | "amps" | "hz";

/** What each build is read for: the voltage or frequency of a net, or the current through a part, at the end of the run. */
export interface Measure {
  quantity: Quantity;
  /** A net id for volts and hz, a part id for amps. */
  target: string;
}

export interface BatchRequest {
  doc: Project;
  program: ProgramImage | null;
  builds: number;
  simSeconds: number;
  measure: Measure;
  /** The tolerance every resistor is drawn from, in percent, in place of the part's own. */
  resistorPct?: number;
}

export interface Burnt {
  part: string;
  /** A key of the `fidelity.states` messages and the numbers its text names. */
  key: string;
  args: Record<string, string | number>;
}

export interface BuildResult {
  index: number;
  /** The seed that makes this build: put it on the project with the seeded tolerance mode to run it in the normal run view. */
  seed: number;
  /** Null when the build gave no reading: the net did not swing, or the run stopped early. */
  value: number | null;
  burnt: Burnt[];
  drawn: Drawn;
}

export type BatchRefusal = "no-circuit" | "no-spread" | "firmware-image" | "no-target" | "bad-doc";

export type WorkerRequest = { t: "run"; req: BatchRequest } | { t: "cancel" };

export type WorkerReply =
  | { t: "progress"; done: number; of: number }
  | { t: "done"; results: BuildResult[]; wallMs: number }
  | { t: "cancelled"; done: number }
  | { t: "refused"; reason: BatchRefusal; detail?: string };
