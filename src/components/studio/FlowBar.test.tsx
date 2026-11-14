import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import runMessages from "@/i18n/messages/en/studioRun.json";
import type { FlowLens } from "@/studio/overlays/flow/lens";
import type { FlowReading } from "@/studio/overlays/flow/readout";
import { createRunStore } from "@/studio/stores/run";
import { createSessionStore } from "@/studio/stores/session";
import { createUiStore } from "@/studio/stores/ui";
import { FlowBar } from "./FlowBar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function rig(reading: FlowReading | null = null) {
  const ui = createUiStore("prj_a", { getItem: () => null, setItem: () => {} }, {});
  const run = createRunStore();
  const session = createSessionStore("vw_bb");
  const lens: FlowLens = { mount: () => () => undefined, range: () => ({ max: 5, low: 0, high: 3.3 }), reading: () => reading };
  render(<FlowBar lens={lens} ui={ui} run={run} session={session} messages={runMessages.flow} />);
  return { ui, run, session };
}

describe("FlowBar", () => {
  it("is a switch that starts on and turns the lens off", () => {
    const { ui } = rig();
    const toggle = screen.getByRole("button", { name: "Flow" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(ui.getState().flowLens).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows what the colours stand for once the run has reported volts, in both directions", () => {
    const { run } = rig();
    expect(screen.queryByLabelText("Volts")).toBeNull();
    act(() => run.apply({ t: "analog", frame: { full: true, volts: { a: 3.3 } } }));
    expect(screen.getByLabelText("Volts").textContent).toBe("-5 V5 V");
  });

  it("reads the part under the pointer in words and numbers", () => {
    const { run, session } = rig({ kind: "part", part: "R1", volts: 2.82, amps: 0.0123, watts: 0.0347, state: "hot" });
    act(() => run.apply({ t: "analog", frame: { full: true, volts: { a: 3.3 } } }));
    act(() => session.setHover({ kind: "part", c: "cmp_r1" }));
    expect(screen.getByRole("status").textContent).toBe("R1, Voltage 2.82 V, Current 12.3 mA, Power 34.7 mW, hot");
  });

  it("names a pin by its part and leaves the power of the whole part out", () => {
    const { run, session } = rig({ kind: "part", part: "U1", watts: 0.0574, state: "ok", pin: { name: "GND", volts: 0 } });
    act(() => run.apply({ t: "analog", frame: { full: true, volts: { a: 3.3 } } }));
    act(() => session.setHover({ kind: "pin", c: "brd_uno", p: "GND" }));
    expect(screen.getByRole("status").textContent).toBe("U1 GND, Voltage 0 V");
  });

  it("describes the lens by its dots, and by its arrows when motion is reduced", () => {
    rig();
    const toggle = screen.getByRole("button", { name: "Flow" });
    expect(toggle.getAttribute("aria-describedby")).toBe(screen.getByText(runMessages.flow.hint).id);
    cleanup();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion"), addEventListener: () => {}, removeEventListener: () => {} }));
    rig();
    expect(screen.getByText(runMessages.flow.hintStill)).toBeTruthy();
    expect(screen.queryByText(runMessages.flow.hint)).toBeNull();
  });
});
