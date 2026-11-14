import { CHECK_BUDGET_MS } from "@/lib/interp/check-limits";
import type { Project } from "@/project/generated/types";
import type { AssignmentCheck, Verdict } from "./types";
import type { Grader } from "./verify";

export type GradeRequest = { id: number; project: Project; checks: readonly AssignmentCheck[]; budgetMs: number };
export type GradeReply = { id: number; verdicts: Verdict[] };

export interface Grading {
  grade: Grader;
  dispose(): void;
}

/** Grace on top of the two runs a grade may make, for a worker stuck inside one step. */
const KILL_GRACE_MS = 2_000;

const failed = (checks: readonly AssignmentCheck[], detail: string): Verdict[] => checks.map((c) => ({ id: c.id, ok: false, detail }));

/**
 * One worker for any number of grades, one grade at a time. A grade that outlasts its budget ends the worker and answers
 * every check with `limit`; the next grade starts a new one. Where there is no Worker the grade runs in this thread.
 */
export function createGrading(budgetMs = CHECK_BUDGET_MS): Grading {
  let worker: Worker | null = null;
  let last: Promise<unknown> = Promise.resolve();
  let next = 0;

  const stop = () => {
    worker?.terminate();
    worker = null;
  };

  function run(project: Project, checks: readonly AssignmentCheck[]): Promise<Verdict[]> {
    if (typeof Worker === "undefined") {
      return import("./grade").then(({ gradeProject }) => gradeProject(project, checks, { budgetMs, now: () => performance.now() }));
    }
    const id = ++next;
    worker ??= new Worker(new URL("./grade.worker.ts", import.meta.url), { type: "module" });
    const mine = worker;
    return new Promise<Verdict[]>((resolve) => {
      const timer = setTimeout(() => {
        if (worker === mine) stop();
        resolve(failed(checks, "limit"));
      }, 2 * budgetMs + KILL_GRACE_MS);
      const settle = (verdicts: Verdict[]) => {
        clearTimeout(timer);
        resolve(verdicts);
      };
      mine.onmessage = ({ data }: MessageEvent<GradeReply>) => data.id === id && settle(data.verdicts);
      mine.onerror = (e) => {
        e.preventDefault();
        if (worker === mine) stop();
        settle(failed(checks, "error"));
      };
      mine.postMessage({ id, project, checks, budgetMs } satisfies GradeRequest);
    });
  }

  return {
    grade: (project, checks) => (last = last.then(() => run(project, checks), () => run(project, checks))) as Promise<Verdict[]>,
    dispose: stop,
  };
}
