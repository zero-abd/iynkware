import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import messages from "@/i18n/messages/en/instruments.json";
import type { TraceChunk } from "@/sim/probe/tap";
import { Scope } from "./Scope";

function sine(id: string, hz: number, peak: number, toNs: number, stepNs = 20_000): TraceChunk {
  const n = Math.floor(toNs / stepNs) + 1;
  const t = Float64Array.from({ length: n }, (_, i) => i * stepNs);
  return { id, from: 0, to: toNs, t, v: Float64Array.from(t, (ns) => peak * Math.sin(2 * Math.PI * hz * (ns / 1e9))), dropped: 0, staircase: false };
}

const meta = { docHash: "r1", seed: 1, versions: {}, provenance: {} };

function view(chunks: Record<string, TraceChunk>, channels = Object.keys(chunks).map((id) => ({ id, kind: "analog" as const })), nowNs = 20e6) {
  return render(
    <Scope channels={channels} chunks={chunks} nowNs={nowNs} paused={false} capacity={4096} onCapacity={vi.fn()} meta={meta} messages={messages} lang="en" />,
  );
}

describe("Scope", () => {
  it("says a generator above a tenth of the sample rate is drawn from few points, and is quiet below it", () => {
    const withGenerator = (sourceHz: number, stepNs: number) =>
      render(<Scope channels={[{ id: "a", kind: "analog" }]} chunks={{ a: sine("a", 40_000, 1, 2e6, stepNs) }} nowNs={2e6} paused={false} capacity={4096} onCapacity={vi.fn()} meta={meta} messages={messages} lang="en" sourceHz={sourceHz} />);
    const { unmount } = withGenerator(40_000, 10_000);
    expect(screen.getByTestId("scope-few-points").textContent).toBe(
      "A generator runs at 40kHz. At this sample rate of 100kHz, a wave above 10kHz is drawn from few points, so its shape and the frequency measured here can be wrong.",
    );
    unmount();
    withGenerator(1000, 10_000);
    expect(screen.queryByTestId("scope-few-points")).toBeNull();
  });

  it("says nothing about few points when no generator is on", () => {
    view({ a: sine("a", 40_000, 1, 2e6, 10_000) });
    expect(screen.queryByTestId("scope-few-points")).toBeNull();
  });

  it("measures the frequency, peak to peak and RMS of what it shows", () => {
    view({ a: sine("a", 1000, 1.5, 20e6) });
    const table = screen.getByTestId("scope-measure");
    expect(within(table).getByTestId("scope-freq-0").textContent).toBe("1kHz");
    expect(within(table).getByText(/^(2\.99\d|3)V$/)).toBeTruthy();
    expect(within(table).getByText(/^1\.0[56]\dV$/)).toBeTruthy();
  });

  it("measures two channels apart", () => {
    view({ a: sine("a", 1000, 1, 20e6), b: sine("b", 2000, 0.5, 20e6) });
    expect(screen.getByTestId("scope-freq-0").textContent).toBe("1kHz");
    expect(screen.getByTestId("scope-freq-1").textContent).toBe("2kHz");
  });

  it("scales a channel on Auto and lets the volts per division be set", () => {
    view({ a: sine("a", 1000, 1.5, 20e6) });
    expect(screen.getByText("500mV/div")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Volts per division/), { target: { value: "2" } });
    expect(screen.getByText("2V/div")).toBeTruthy();
  });

  it("offers the time per division in 1, 2, 5 steps and shows a window of ten of them", () => {
    view({ a: sine("a", 1000, 1, 20e6) });
    const select = screen.getByTestId("scope-timebase") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent).slice(0, 4)).toEqual(["1µs", "2µs", "5µs", "10µs"]);
    expect(select.value).toBe("0.001");
    fireEvent.change(select, { target: { value: "0.0005" } });
    expect(screen.getByTestId("scope-freq-0").textContent).toBe("1kHz");
  });

  it("keeps the last triggered picture in normal mode when nothing crosses the level, and says it is waiting", () => {
    view({ a: sine("a", 1000, 1, 20e6) });
    fireEvent.change(screen.getByTestId("scope-mode"), { target: { value: "normal" } });
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "5" } });
    expect(screen.getByTestId("scope-armed").textContent).toBe("Waiting for a trigger.");
    expect(screen.getByTestId("scope-freq-0").textContent).toBe("1kHz");
  });

  it("holds a single capture until it is armed again", () => {
    const first = sine("a", 1000, 1, 20e6);
    const { rerender } = view({ a: first });
    fireEvent.change(screen.getByTestId("scope-mode"), { target: { value: "single" } });
    expect(screen.getByTestId("scope-armed").textContent).toBe("Captured. Press Arm for another.");
    const held = screen.getByTestId("scope-summary").textContent;
    rerender(<Scope channels={[{ id: "a", kind: "analog" }]} chunks={{ a: sine("a", 1000, 1, 30e6) }} nowNs={30e6} paused={false} capacity={4096} onCapacity={vi.fn()} meta={meta} messages={messages} lang="en" />);
    expect(screen.getByTestId("scope-summary").textContent).toBe(held);
    fireEvent.click(screen.getByRole("button", { name: "Arm" }));
    expect(screen.getByTestId("scope-summary").textContent).not.toBe(held);
  });

  it("puts the two cursors a known time apart and reads the voltage under them", () => {
    view({ a: sine("a", 1000, 1, 20e6) });
    const [one, two] = [screen.getByRole("slider", { name: "Cursor 1" }), screen.getByRole("slider", { name: "Cursor 2" })];
    fireEvent.keyDown(one, { key: "Home" });
    fireEvent.keyDown(two, { key: "End" });
    expect(screen.getByTestId("scope-delta").textContent).toMatch(/^Delta: 10\.000 ms, 100Hz/);
    expect(one.getAttribute("aria-valuetext")).toMatch(/ms, [-\d.]+m?V$/);
  });
});
