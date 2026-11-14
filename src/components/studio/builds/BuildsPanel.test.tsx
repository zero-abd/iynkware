import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import fidelity from "@/i18n/messages/en/fidelity.json";
import studio from "@/i18n/messages/en/studio.json";
import type { Project } from "@/project/generated/types";
import { createSession } from "@/project/session";
import { seededRandom, steppingClock } from "@/project/session.testing";
import type { BuildResult } from "@/sim-host/montecarlo/protocol";
import starter from "@/studio/starters/blinker-555.project.json";
import { createRecordingDoc } from "@/studio/testing/recording-doc";
import { BuildsPanel } from "./BuildsPanel";
import type { Builds, BuildsRun } from "./useBuilds";

afterEach(cleanup);

const doc = () => createRecordingDoc(createSession({ state: starter as unknown as Project, clock: steppingClock(), rnd: seededRandom() }));

const result = (index: number, value: number | null, burnt: string[] = []): BuildResult => ({
  index,
  seed: 1000 + index,
  value,
  burnt: burnt.map((part) => ({ part, key: "fidelity.states.led", args: { n: 60, limit: 50, imax: 20 } })),
  drawn: {},
});

function setup(run: BuildsRun, over: Partial<Builds> = {}, readOnly = false) {
  const store = doc();
  if (readOnly) store.setAccess({ mode: "readonly", reason: "shared" });
  const builds: Builds = {
    settings: { quantity: "hz", target: null, seconds: "2", resistors: "part", min: "0.9", max: "1.1" },
    change: vi.fn(),
    run,
    seconds: 2,
    opened: null,
    start: vi.fn(),
    cancel: vi.fn(),
    open: vi.fn(() => true),
    back: vi.fn(),
    ...over,
  };
  const onOpened = vi.fn();
  render(<BuildsPanel doc={store} builds={builds} onOpened={onOpened} messages={studio} fidelity={fidelity} lang="en" />);
  return { builds, onOpened };
}

const done = (results: BuildResult[]): BuildsRun => ({ phase: "done", results, wallMs: 1700, shown: { measure: { quantity: "hz", target: "n" }, seconds: 2, baseSeed: 1102 } });

describe("BuildsPanel", () => {
  it("starts empty and builds on the pin it was told to measure", () => {
    const { builds } = setup({ phase: "idle" });
    expect(screen.getByText(studio.builds.empty.title)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: studio.builds.run }));
    expect(builds.start).toHaveBeenCalledWith({ quantity: "hz", target: expect.any(String) });
  });

  it("shows progress while the builds run, and cancels", () => {
    const { builds } = setup({ phase: "running", done: 37 });
    expect(screen.getByRole("meter", { name: "Building 37 of 100" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: studio.builds.cancel }));
    expect(builds.cancel).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: studio.builds.run })).toBeNull();
  });

  it("gives the lowest, median and highest, and the share inside the range, from the results", () => {
    const values = [0.8, 0.95, 1, 1.05, 1.2, null];
    setup(done(values.map((v, i) => result(i, v))));
    const stats = within(screen.getByTestId("builds-stats"));
    expect(stats.getByText("0.8 Hz")).toBeTruthy();
    expect(stats.getByText("1 Hz")).toBeTruthy();
    expect(stats.getByText("1.2 Hz")).toBeTruthy();
    expect(stats.getByText("3 of 6")).toBeTruthy();
    expect(stats.getByText("Builds that read inside 0.9 Hz to 1.1 Hz")).toBeTruthy();
    expect(screen.getByTestId("builds-no-reading").textContent).toContain("1 builds gave no reading");
  });

  it("opens the middle build of a bar when the bar is pressed", () => {
    const values = [1, 1.0001, 1.0002, 2];
    const { onOpened } = setup(done(values.map((v, i) => result(i, v))));
    const bars = screen.getAllByTestId("build-bar");
    expect(bars[0].getAttribute("aria-label")).toContain("Builds in this bar: 3");
    fireEvent.click(bars[0]);
    expect(onOpened).toHaveBeenCalledWith(expect.objectContaining({ index: 1 }));
  });

  it("names the parts that burnt, how often, and opens a build where one did", () => {
    const { onOpened } = setup(done([result(0, 1), result(1, 1, ["cmp_led1"]), result(2, 1, ["cmp_led1"])]));
    expect(screen.getByText("Builds that burnt a part: 2 of 3")).toBeTruthy();
    const chip = screen.getByRole("button", { name: "Open a build where LED1 burnt" });
    expect(chip.textContent).toContain("LED1: 2");
    fireEvent.click(chip);
    expect(onOpened).toHaveBeenCalledWith(expect.objectContaining({ index: 1 }));
  });

  it("says no build burnt a part when none did", () => {
    setup(done([result(0, 1), result(1, 1.1)]));
    expect(screen.getByText(studio.builds.results.burntNone)).toBeTruthy();
  });

  it("says plainly when no build gave a reading", () => {
    setup(done([result(0, null), result(1, null)]));
    expect(screen.getByText(studio.builds.results.allNone)).toBeTruthy();
    expect(screen.queryAllByTestId("build-bar")).toHaveLength(0);
  });

  it("says why the builds could not run", () => {
    setup({ phase: "refused", reason: "no-spread" });
    expect(screen.getByText(studio.builds.refused["no-spread"])).toBeTruthy();
  });

  it("will not open a build of a read only project", () => {
    setup(done([result(0, 1), result(1, 2)]), {}, true);
    for (const bar of screen.getAllByTestId("build-bar")) expect((bar as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(studio.builds.open.readOnly)).toBeTruthy();
  });

  it("reads a mistyped range as an error and a prefix as a number", () => {
    setup(done([result(0, 1)]), { settings: { quantity: "hz", target: null, seconds: "2", resistors: "part", min: "abc", max: "900m" } });
    expect(screen.getByText(studio.builds.range.invalid)).toBeTruthy();
    expect(screen.getByText("Builds that read inside at most 0.9 Hz")).toBeTruthy();
  });
});
