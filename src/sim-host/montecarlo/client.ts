import type { BatchRequest, WorkerReply, WorkerRequest } from "./protocol";

export type BatchEnd = Exclude<WorkerReply, { t: "progress" }> | { t: "failed"; message: string };

export interface BatchHandle {
  cancel(): void;
  done: Promise<BatchEnd>;
}

/** How long a cancelled batch gets to answer before its worker is ended. */
const CANCEL_GRACE_MS = 3000;

/** Runs the builds in a worker of their own, so the page keeps painting. */
export function startBatch(req: BatchRequest, onProgress: (done: number, of: number) => void): BatchHandle {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "montecarlo" });
  let grace: ReturnType<typeof setTimeout> | undefined;
  let finish: (end: BatchEnd) => void = () => undefined;
  const done = new Promise<BatchEnd>((resolve) => {
    finish = (end) => {
      clearTimeout(grace);
      worker.terminate();
      resolve(end);
    };
  });
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    if (event.data.t === "progress") onProgress(event.data.done, event.data.of);
    else finish(event.data);
  };
  worker.onerror = (event) => finish({ t: "failed", message: event.message });
  worker.onmessageerror = () => finish({ t: "failed", message: "the worker sent a message the page could not read" });
  const start: WorkerRequest = { t: "run", req };
  worker.postMessage(start);
  return {
    cancel() {
      const stop: WorkerRequest = { t: "cancel" };
      worker.postMessage(stop);
      grace ??= setTimeout(() => finish({ t: "cancelled", done: 0 }), CANCEL_GRACE_MS);
    },
    done,
  };
}
