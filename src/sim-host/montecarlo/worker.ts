import { builtinRegistry } from "@/parts/builtin";
import { loadRegistry } from "@/sim/registry/entries";
import { prepare, runBatch } from "./build";
import type { WorkerReply, WorkerRequest } from "./protocol";

interface Scope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerReply): void;
}

const scope = self as unknown as Scope;
const PROGRESS_EVERY_MS = 50;

let cancelled = false;
let running = false;

async function run(req: Extract<WorkerRequest, { t: "run" }>["req"]): Promise<void> {
  const parts = builtinRegistry();
  const prepared = prepare(req, parts);
  if (!prepared.ok) {
    scope.postMessage({ t: "refused", reason: prepared.reason, ...(prepared.detail === undefined ? {} : { detail: prepared.detail }) });
    return;
  }
  const started = performance.now();
  let posted = started;
  const outcome = await runBatch(prepared.prepared, parts, loadRegistry(), {
    progress(done, of) {
      const now = performance.now();
      if (done < of && now - posted < PROGRESS_EVERY_MS) return;
      posted = now;
      scope.postMessage({ t: "progress", done, of });
    },
    breathe: () => new Promise((resolve) => setTimeout(resolve, 0)),
    cancelled: () => cancelled,
  });
  scope.postMessage(outcome.t === "done" ? { t: "done", results: outcome.results, wallMs: Math.round(performance.now() - started) } : outcome);
}

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.t === "cancel") {
    cancelled = true;
    return;
  }
  if (running) return;
  running = true;
  cancelled = false;
  void run(msg.req).finally(() => {
    running = false;
  });
};
