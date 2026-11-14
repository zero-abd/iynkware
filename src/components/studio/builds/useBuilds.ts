"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "@/project/generated/types";
import type { BatchHandle } from "@/sim-host/montecarlo/client";
import type { BatchRefusal, BuildResult, Measure, Quantity } from "@/sim-host/montecarlo/protocol";
import { programOf } from "../wiring/simLink";
import type { DocStore } from "@/studio/stores/doc";
import { parseValue } from "@/studio/units";
import { BUILDS, DEFAULT_SECONDS, SECONDS_LIMITS, nominalOps, openBuildOps } from "./model";

export interface BuildsSettings {
  quantity: Quantity;
  /** The node, or part, to read; null until the person picks, when the first one on the list stands in. */
  target: string | null;
  seconds: string;
  resistors: "part" | "precision";
  min: string;
  max: string;
}

/** What a set of results was made from, kept with them so a later change of the controls does not relabel them. */
export interface Shown {
  measure: Measure;
  seconds: number;
  baseSeed: number;
}

export type BuildsRun =
  | { phase: "idle" }
  | { phase: "running"; done: number }
  | { phase: "done"; results: BuildResult[]; wallMs: number; shown: Shown }
  | { phase: "refused"; reason: BatchRefusal; detail?: string }
  | { phase: "failed"; message: string }
  | { phase: "cancelled"; done: number };

export interface OpenBuild {
  index: number;
  seed: number;
  /** The project's seed before the build was opened, put back with the nominal parts. */
  previousSeed: number;
}

export interface Builds {
  settings: BuildsSettings;
  change(patch: Partial<BuildsSettings>): void;
  run: BuildsRun;
  /** The seconds the field holds, or null while it does not read as a time. */
  seconds: number | null;
  opened: OpenBuild | null;
  start(measure: Measure | null): void;
  cancel(): void;
  /** Puts the project at the build's seed in the seeded mode; false when the edit was refused. */
  open(result: BuildResult): boolean;
  back(): void;
}

interface Launch {
  batch: BatchHandle | null;
  cancelled: boolean;
}

const INITIAL: BuildsSettings = { quantity: "volts", target: null, seconds: String(DEFAULT_SECONDS), resistors: "part", min: "", max: "" };

export function secondsOf(text: string): number | null {
  const parsed = parseValue(text, "second", SECONDS_LIMITS);
  return parsed.ok ? parsed.value : null;
}

const modeOf = (state: Project): unknown => (state.simulation.solver.options as { toleranceMode?: unknown } | undefined)?.toleranceMode;

/** The build the project still has open: the seed and the seeded mode it was put at have not been changed since. */
export const stillOpen = (state: Project, opened: OpenBuild | null): OpenBuild | null =>
  opened && modeOf(state) === "seeded" && state.simulation.seed === opened.seed ? opened : null;

/** The state of the Builds panel and the batch behind it. It lives above the tab, so the builds go on while another tab shows. */
export function useBuilds(doc: DocStore): Builds {
  const [settings, setSettings] = useState(INITIAL);
  const [run, setRun] = useState<BuildsRun>({ phase: "idle" });
  const [opened, setOpened] = useState<OpenBuild | null>(null);
  // Set as soon as a batch is asked for. The worker client loads after that, so a cancel can come before the batch exists.
  const active = useRef<Launch | null>(null);
  const seconds = useMemo(() => secondsOf(settings.seconds), [settings.seconds]);

  const cancel = useCallback(() => {
    const launch = active.current;
    if (!launch) return;
    launch.cancelled = true;
    launch.batch?.cancel();
  }, []);

  const start = useCallback(
    (measure: Measure | null) => {
      if (active.current || measure === null || seconds === null) return;
      const state: Project = doc.getState().state;
      const compiled = state.simulation.runtimes[0]?.engine === "avr8js";
      if (compiled) return setRun({ phase: "refused", reason: "firmware-image" });
      const launch: Launch = { batch: null, cancelled: false };
      active.current = launch;
      setRun({ phase: "running", done: 0 });
      const open = stillOpen(state, opened);
      const baseSeed = open ? open.previousSeed : state.simulation.seed;
      const doc0 = open ? { ...state, simulation: { ...state.simulation, seed: baseSeed } } : state;
      const end = (to: BuildsRun) => {
        if (active.current !== launch) return;
        active.current = null;
        setRun(to);
      };
      import("@/sim-host/montecarlo/client").then(
        ({ startBatch }) => {
          if (launch.cancelled) return end({ phase: "cancelled", done: 0 });
          const batch = startBatch(
            { doc: doc0, program: programOf(state), builds: BUILDS, simSeconds: seconds, measure, ...(settings.resistors === "precision" ? { resistorPct: 1 } : {}) },
            (done) => setRun({ phase: "running", done }),
          );
          launch.batch = batch;
          void batch.done.then((e) => {
            if (e.t === "done") end({ phase: "done", results: e.results, wallMs: e.wallMs, shown: { measure, seconds, baseSeed } });
            else if (e.t === "cancelled") end({ phase: "cancelled", done: e.done });
            else if (e.t === "refused") end({ phase: "refused", reason: e.reason, ...(e.detail === undefined ? {} : { detail: e.detail }) });
            else end({ phase: "failed", message: e.message });
          });
        },
        (error: unknown) => end({ phase: "failed", message: error instanceof Error ? error.message : String(error) }),
      );
    },
    [doc, opened, seconds, settings.resistors],
  );

  const open = useCallback(
    (result: BuildResult) => {
      const state = doc.getState().state;
      const previousSeed = stillOpen(state, opened)?.previousSeed ?? state.simulation.seed;
      const committed = doc.commit(openBuildOps(state, result.seed), { label: `Open build ${result.index + 1}` });
      if (committed.ok) setOpened({ index: result.index, seed: result.seed, previousSeed });
      return committed.ok;
    },
    [doc, opened],
  );

  const back = useCallback(() => {
    const state = doc.getState().state;
    const open = stillOpen(state, opened);
    const ops = [...nominalOps(state), ...(open ? [{ k: "sim.set" as const, key: "seed" as const, value: open.previousSeed }] : [])];
    if (doc.commit(ops, { label: "Use nominal parts" }).ok) setOpened(null);
  }, [doc, opened]);

  useEffect(
    () =>
      doc.onChange(({ origin }) => {
        if (origin !== "load") return;
        setRun({ phase: "idle" });
        setOpened(null);
      }),
    [doc],
  );
  useEffect(() => cancel, [cancel]);

  return useMemo(
    () => ({ settings, change: (patch) => setSettings((s) => ({ ...s, ...patch })), run, seconds, opened, start, cancel, open, back }),
    [settings, run, seconds, opened, start, cancel, open, back],
  );
}
