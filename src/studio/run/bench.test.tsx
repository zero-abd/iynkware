import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InstrumentSource } from "@/sim/analog/types";
import type { SimEv } from "@/sim-host/protocol";
import { createRunStore } from "@/studio/stores/run";
import { useBenchSource, useInstrumentReading } from "./bench";

const source: InstrumentSource = { kind: "psu", pos: "n1", neg: "gnd", volts: 5, limitAmps: 0.1 };

function rig(reply: Awaited<ReturnType<Parameters<typeof useBenchSource>[0]["setInstrument"]>> = { ok: true }) {
  const run = createRunStore();
  const host = { setInstrument: vi.fn(async () => reply), clearInstrument: vi.fn(async () => {}) };
  const going = () => act(() => {
    run.apply({ t: "phase", phase: "starting" });
    run.apply({ t: "phase", phase: "running" });
  });
  return { run, host, going };
}

describe("useBenchSource", () => {
  it("says nothing to the run until there is one", () => {
    const { host, run } = rig();
    const { result } = renderHook(() => useBenchSource(host, run, "ins_a", source));
    expect(result.current).toBe("idle");
    expect(host.setInstrument).not.toHaveBeenCalled();
  });

  it("puts the source in once the run is going and reports that it took", async () => {
    const { host, run, going } = rig();
    const { result } = renderHook(() => useBenchSource(host, run, "ins_a", source));
    going();
    await waitFor(() => expect(result.current).toBe("on"));
    expect(host.setInstrument).toHaveBeenCalledWith("ins_a", source);
  });

  it("passes on why the run refused", async () => {
    const { host, run, going } = rig({ ok: false, reason: "not-modelled-yet" });
    const { result } = renderHook(() => useBenchSource(host, run, "ins_a", source));
    going();
    await waitFor(() => expect(result.current).toBe("not-modelled-yet"));
  });

  it("sends a changed source again, and takes it out when the output goes off", async () => {
    const { host, run, going } = rig();
    going();
    const { result, rerender } = renderHook(({ s }: { s: InstrumentSource | null }) => useBenchSource(host, run, "ins_a", s), { initialProps: { s: source as InstrumentSource | null } });
    await waitFor(() => expect(result.current).toBe("on"));
    rerender({ s: { ...source, volts: 9 } });
    await waitFor(() => expect(host.setInstrument).toHaveBeenLastCalledWith("ins_a", { ...source, volts: 9 }));
    rerender({ s: null });
    expect(result.current).toBe("off");
    await waitFor(() => expect(host.clearInstrument).toHaveBeenCalledWith("ins_a"));
  });

  it("takes the source out when the panel goes away", () => {
    const { host, run } = rig();
    const { unmount } = renderHook(() => useBenchSource(host, run, "ins_a", source));
    unmount();
    expect(host.clearInstrument).toHaveBeenCalledWith("ins_a");
  });
});

describe("useInstrumentReading", () => {
  it("follows the readings of its own instrument in the run's frames", () => {
    let emit: (e: SimEv) => void = () => {};
    const host = { onEvent: (fn: (e: SimEv) => void) => ((emit = fn), () => {}) };
    const { result } = renderHook(() => useInstrumentReading(host, "ins_a"));
    expect(result.current).toBeNull();
    const frame = (instruments: Record<string, { volts: number; amps: number; limiting: boolean }>): SimEv => ({ t: "frame", run: 1, at: 0, pins: {}, parts: [], serial: [], analog: { full: false, instruments } });
    act(() => emit(frame({ ins_b: { volts: 1, amps: 1, limiting: false } })));
    expect(result.current).toBeNull();
    act(() => emit(frame({ ins_a: { volts: 4.9, amps: 0.1, limiting: true } })));
    expect(result.current).toEqual({ volts: 4.9, amps: 0.1, limiting: true });
  });
});
