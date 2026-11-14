import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/project/generated/types";
import { createSession } from "@/project/session";
import { seededRandom, steppingClock } from "@/project/session.testing";
import type { BatchEnd } from "@/sim-host/montecarlo/client";
import starter from "@/studio/starters/blinker-555.project.json";
import { createDocStore } from "@/studio/stores/doc";
import { useBuilds } from "./useBuilds";

const batches: { cancel: ReturnType<typeof vi.fn>; finish(end: BatchEnd): void }[] = [];

vi.mock("@/sim-host/montecarlo/client", () => ({
  startBatch: vi.fn(() => {
    let finish: (end: BatchEnd) => void = () => undefined;
    const done = new Promise<BatchEnd>((resolve) => (finish = resolve));
    const batch = { cancel: vi.fn(() => finish({ t: "cancelled", done: 7 })), finish: (end: BatchEnd) => finish(end) };
    batches.push(batch);
    return { cancel: batch.cancel, done };
  }),
}));

afterEach(() => {
  batches.length = 0;
  vi.clearAllMocks();
});

const measure = { quantity: "hz" as const, target: "n" };

function setup() {
  const doc = createDocStore(createSession({ state: starter as unknown as Project, clock: steppingClock(), rnd: seededRandom() }));
  return renderHook(() => useBuilds(doc));
}

describe("useBuilds", () => {
  // The worker client loads after Run is pressed, and the panel shows Cancel from the start. A press in between used
  // to do nothing, and the hundred builds ran on.
  it("a cancel before the worker client has loaded stops the batch before it starts", async () => {
    const { result } = setup();
    act(() => result.current.start(measure));
    expect(result.current.run).toEqual({ phase: "running", done: 0 });
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.run).toEqual({ phase: "cancelled", done: 0 }));
    expect(batches).toHaveLength(0);
  });

  it("a cancel during the batch is passed to the worker, and its count is shown", async () => {
    const { result } = setup();
    act(() => result.current.start(measure));
    await waitFor(() => expect(batches).toHaveLength(1));
    act(() => result.current.cancel());
    expect(batches[0].cancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(result.current.run).toEqual({ phase: "cancelled", done: 7 }));
  });

  it("a finished batch lets the next one start", async () => {
    const { result } = setup();
    act(() => result.current.start(measure));
    await waitFor(() => expect(batches).toHaveLength(1));
    await act(async () => batches[0].finish({ t: "done", results: [], wallMs: 5 }));
    expect(result.current.run.phase).toBe("done");
    act(() => result.current.start(measure));
    await waitFor(() => expect(batches).toHaveLength(2));
  });
});
