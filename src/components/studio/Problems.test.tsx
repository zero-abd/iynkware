import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import faultMessages from "@/i18n/messages/en/faults.json";
import fidelityMessages from "@/i18n/messages/en/fidelity.json";
import robotMessages from "@/i18n/messages/en/robot.json";
import messages from "@/i18n/messages/en/studioCode.json";
import type { Problem } from "@/studio/problems";
import { Problems, type FixActions } from "./Problems";

const include: Problem = {
  id: "code:0",
  severity: "error",
  source: "code",
  titleKey: "problem.include.unknown",
  args: { name: "Foo.h" },
  line: 2,
  col: 1,
  hint: "supported libraries: Servo.h",
};
const plain: Problem = { id: "code:1", severity: "warning", source: "code", titleKey: "problem.interp", args: {}, fallbackText: "pin 40 does not exist", line: 7 };
const flag: Problem = { id: "static:short-circuit:net_a", severity: "error", source: "static", titleKey: "problem.static.short-circuit", args: { net: "net_a", count: 2 } };

const noFixes: FixActions = { apply: () => ({ ok: true }), applyAll: () => ({ ok: true }), undo: () => {} };

const view = (problems: Problem[], onJump = vi.fn(), fixes: FixActions = noFixes) => {
  render(<Problems problems={problems} onJump={onJump} messages={messages} faultMessages={faultMessages} fidelityMessages={fidelityMessages} robotMessages={robotMessages} lang="en" onCheck={() => {}} checkDisabled={false} counts={{ skipped: 0, errors: 0 }} fixes={fixes} />);
  return onJump;
};

const burnt: Problem = {
  id: "run:burnt:cmp_led1",
  severity: "error",
  source: "run",
  titleKey: "fidelity.states.led",
  args: { name: "D1", n: 120, imax: 20, limit: 50 },
  targets: [{ kind: "part", id: "cmp_led1" }],
};

describe("Problems", () => {
  it("explains a part that burnt with the current, its rating and what to do", () => {
    view([burnt]);
    const text = screen.getAllByRole("button").find((b) => b.dataset.severity)!.textContent!;
    expect(text).toContain("D1 burned out: 120 mA went through it");
    expect(text).toContain("50 mA (2.5 times its 20 mA rating)");
    expect(text).toContain("Add a series resistor.");
  });

  it("says so when there is nothing wrong", () => {
    view([]);
    expect(screen.getByText(messages.problems.empty)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Error|Warning/ })).toBeNull();
  });

  it("shows each problem as a button named by its severity, line and text", () => {
    view([include, plain, flag]);
    const rows = screen.getAllByRole("button").filter((b) => b.dataset.severity);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("Error");
    expect(rows[0]!.textContent).toContain("Line 2");
    expect(rows[0]!.textContent).toContain("Foo.h is not a library iynk can simulate.");
    expect(rows[0]!.textContent).toContain("supported libraries: Servo.h");
    expect(rows[1]!.textContent).toContain("Warning");
    expect(rows[1]!.textContent).toContain("pin 40 does not exist");
    expect(rows[2]!.textContent).not.toContain("Line");
    expect(screen.getByRole("button", { name: /Error.*Line 2.*Foo\.h/ })).toBe(rows[0]);
  });

  it("counts the problems", () => {
    view([include, plain]);
    expect(screen.getByRole("status").textContent).toBe("2 problems");
  });

  it("jumps to the problem that was pressed", () => {
    const onJump = view([include, plain]);
    fireEvent.click(screen.getAllByRole("button").filter((b) => b.dataset.severity)[1]!);
    expect(onJump).toHaveBeenCalledWith(plain);
  });

  describe("fixes", () => {
    const op = { k: "net.disconnect", pin: { c: "cmp_led", p: "A" } } as const;
    const series = {
      kind: "value" as const,
      messageKey: "fix.led-series",
      args: { led: "D1", ohms: "330 \u03A9" },
      ops: [op],
      plan: { t: "series" as const, at: { part: "cmp_led", pin: "A" }, ohms: 330 },
      safe: true,
      preview: { before: ["U1.D13 - D1.A"], after: ["R1: 330 \u03A9", "U1.D13 - R1.P1", "D1.A - R1.P2"] },
    };
    const advice = { kind: "wiring" as const, messageKey: "fix.motor-driver", args: { part: "M1", pin: "D5" }, ops: [], safe: false, preview: { before: [], after: [] } };
    const rule = (fixes: Problem["fixes"]): Problem => ({
      id: "rule:led-series@1:cmp_led",
      severity: "error",
      source: "static",
      titleKey: "check.led-series",
      args: {},
      rule: "rule:led-series@1",
      diagnosis: { cause_id: "led-no-series-resistor", symptom_id: "led-burnt", evidence: [], hint_level: 3 },
      fixes,
    });

    it("shows the fix with what it changes and applies it on Fix", () => {
      const fixes = { ...noFixes, apply: vi.fn(() => ({ ok: true as const })) };
      view([rule([series])], vi.fn(), fixes);
      expect(screen.getByText("Add a 330 \u03A9 resistor in series with D1.")).toBeTruthy();
      expect(screen.getByText("U1.D13 - D1.A")).toBeTruthy();
      expect(screen.getByText("D1.A - R1.P2")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Fix" }));
      expect(fixes.apply).toHaveBeenCalledWith(series, "Add a 330 \u03A9 resistor in series with D1.");
      expect(screen.getByText(/^Fixed: Add a 330/)).toBeTruthy();
    });

    it("takes the fix back with Undo", () => {
      const fixes = { ...noFixes, undo: vi.fn() };
      view([rule([series])], vi.fn(), fixes);
      fireEvent.click(screen.getByRole("button", { name: "Fix" }));
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(fixes.undo).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });

    it("says why a fix did not apply", () => {
      view([rule([series])], vi.fn(), { ...noFixes, apply: () => ({ ok: false, message: "pin_in_use" }) });
      fireEvent.click(screen.getByRole("button", { name: "Fix" }));
      expect(screen.getByRole("alert").textContent).toContain("The fix did not apply. pin_in_use");
    });

    it("offers Fix all safe with the count of safe fixes, each change once", () => {
      const fixes = { ...noFixes, applyAll: vi.fn(() => ({ ok: true as const })) };
      view([rule([series]), { ...rule([series]), id: "solve:led-overcurrent@1:cmp_led" }, rule([{ ...series, safe: false, plan: { ...series.plan, ohms: 470 } }])], vi.fn(), fixes);
      fireEvent.click(screen.getByRole("button", { name: "Fix all safe (1)" }));
      expect(fixes.applyAll).toHaveBeenCalledWith([series], "Fix all safe");
    });

    it("has no Fix all button when nothing is safe, and gives advice when a fix has no ops", () => {
      view([rule([advice, { ...series, safe: false }])]);
      expect(screen.queryByRole("button", { name: /Fix all safe/ })).toBeNull();
      expect(screen.getByText("No automatic fix. Change this by hand.")).toBeTruthy();
      expect(screen.getByText("Check the preview")).toBeTruthy();
    });
  });
});
