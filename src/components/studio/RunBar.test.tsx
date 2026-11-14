import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import instruments from "@/i18n/messages/en/instruments.json";
import roomRun from "@/i18n/messages/en/run.json";
import messages from "@/i18n/messages/en/studioRun.json";
import { runCommand, type CommandCtx } from "@/studio/commands";
import { createRunStore } from "@/studio/stores/run";
import { errorText, RunBar } from "./RunBar";
import type { SimLink } from "./wiring/simLink";

function rig() {
  const run = createRunStore();
  const link: SimLink = { run: vi.fn(async () => {}), stop: vi.fn(), reset: vi.fn(), pause: vi.fn(), resume: vi.fn(), step: vi.fn(), setSpeed: vi.fn(), restart: vi.fn(async () => {}), sendSerial: vi.fn(), press: vi.fn(), setInput: vi.fn(), partInput: vi.fn(), dispose: vi.fn() };
  render(<RunBar run={run} link={link} messages={messages} instruments={instruments} roomRun={roomRun} lang="en" />);
  return { run, link };
}

const phase = (run: ReturnType<typeof createRunStore>, p: Parameters<typeof run.apply>[0] & { t: "phase" }) => act(() => run.apply(p));

describe("RunBar", () => {
  it("offers Run first, with Stop and Reset off", () => {
    rig();
    expect((screen.getByRole("button", { name: "Run" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reset" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("toolbar", { name: messages.bar.label })).toBeTruthy();
  });

  it("calls the link from the buttons", () => {
    const { run, link } = rig();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(link.run).toHaveBeenCalled();
    phase(run, { t: "phase", phase: "starting" });
    phase(run, { t: "phase", phase: "running" });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(link.stop).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(link.reset).toHaveBeenCalled();
  });

  it("runs from the command registry, which Ctrl+Enter is bound to", () => {
    const { link } = rig();
    expect(runCommand("sim.run", {} as CommandCtx)).toBe(true);
    expect(link.run).toHaveBeenCalled();
  });

  it("frees the commands when it unmounts", () => {
    const run = createRunStore();
    const link = { run: vi.fn(), stop: vi.fn(), reset: vi.fn() } as unknown as SimLink;
    render(<RunBar run={run} link={link} messages={messages} instruments={instruments} roomRun={roomRun} lang="en" />).unmount();
    expect(runCommand("sim.run", {} as CommandCtx)).toBe(false);
  });

  it("shows the state and the virtual time", () => {
    const { run } = rig();
    phase(run, { t: "phase", phase: "starting" });
    phase(run, { t: "phase", phase: "running" });
    act(() => run.apply({ t: "frame", frame: { tNs: 1_250_000_000, pins: {}, parts: [] } }));
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toBe("1.250 s");
  });

  it("turns Run into Restart when the run is stale", () => {
    const { run } = rig();
    phase(run, { t: "phase", phase: "starting" });
    phase(run, { t: "phase", phase: "running" });
    act(() => run.markStale());
    expect(screen.getByRole("button", { name: "Restart" })).toBeTruthy();
    expect(screen.getByText(messages.bar.stale)).toBeTruthy();
  });

  it("names the limit that stopped the run", () => {
    const { run } = rig();
    phase(run, { t: "phase", phase: "starting" });
    phase(run, { t: "phase", phase: "limit", limit: { which: "statements", text: "x" } });
    expect(screen.getByText(messages.limit.statements)).toBeTruthy();
    expect(screen.getByText(messages.phase.limit)).toBeTruthy();
  });

  it("shows the first error of a failed start", () => {
    const { run } = rig();
    phase(run, { t: "phase", phase: "starting" });
    act(() => run.apply({ t: "diagnostics", diagnostics: [{ id: "parse", severity: "error", text: "expected ;" }] }));
    phase(run, { t: "phase", phase: "error" });
    expect(screen.getByText("expected ;")).toBeTruthy();
  });

  it("steps by event by default, in units the simulator can step", () => {
    const { run, link } = rig();
    phase(run, { t: "phase", phase: "running" });
    phase(run, { t: "phase", phase: "paused" });
    fireEvent.click(screen.getByRole("button", { name: "Step" }));
    expect(link.step).toHaveBeenLastCalledWith("event", 1);
    const unit = screen.getByRole("combobox", { name: instruments.run.stepUnit }) as HTMLSelectElement;
    fireEvent.change(unit, { target: { value: "ns" } });
    fireEvent.click(screen.getByRole("button", { name: "Step" }));
    expect(link.step).toHaveBeenLastCalledWith("ns", 1_000_000);
    const off = [...unit.options].filter((o) => o.disabled).map((o) => o.value);
    expect(off).toEqual(["statement", "line", "cycle"]);
  });

  it("shows a readable message for a simulator error key, never the key", () => {
    const { run } = rig();
    phase(run, { t: "phase", phase: "starting" });
    act(() => run.apply({ t: "diagnostics", diagnostics: [{ id: "unknown-ground", severity: "error", text: "diag.unknown-ground" }] }));
    phase(run, { t: "phase", phase: "error" });
    expect(screen.getByText(messages.diag["unknown-ground"])).toBeTruthy();
    expect(screen.queryByText("diag.unknown-ground")).toBeNull();
  });

  it("says when the simulator was restarted", () => {
    const { run } = rig();
    phase(run, { t: "phase", phase: "starting" });
    phase(run, { t: "phase", phase: "killed" });
    expect(screen.getByText(messages.killed)).toBeTruthy();
  });
});

describe("errorText", () => {
  const t = (key: string) => key;
  it("keeps a message that is already text", () => {
    expect(errorText("expected ;", messages, t)).toBe("expected ;");
    expect(errorText(null, messages, t)).toBeNull();
  });

  it("maps a known key to its text and an unknown key to null, so the caller falls back", () => {
    expect(errorText("diag.no-convergence", messages, (key) => `text:${key}`)).toBe("text:diag.no-convergence");
    expect(errorText("diag.something-new", messages, t)).toBeNull();
  });
});
