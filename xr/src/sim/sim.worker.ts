/// <reference lib="webworker" />
/** The XR app's simulation worker. The render thread never runs the solver; it only posts requests here. */
import { serveWorker, type WorkerScopeLike } from '@/protocol';
import { createXrSimHandler } from './handler-deps';

serveWorker(
  self as unknown as WorkerScopeLike,
  createXrSimHandler({ wallMs: () => performance.now(), schedule: (fn) => void setTimeout(fn, 0) }),
);
