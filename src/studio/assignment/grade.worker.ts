// Grades one project off the main thread: the run is the Studio's own, and it may take seconds.
import type { GradeReply, GradeRequest } from "./grade-client";
import { gradeProject } from "./grade";

const scope = self as unknown as { onmessage: ((e: MessageEvent<GradeRequest>) => void) | null; postMessage(m: GradeReply): void };

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, verdicts: gradeProject(data.project, data.checks, { budgetMs: data.budgetMs, now: () => performance.now() }) });
  } catch {
    scope.postMessage({ id: data.id, verdicts: data.checks.map((c) => ({ id: c.id, ok: false, detail: "error" })) });
  }
};
