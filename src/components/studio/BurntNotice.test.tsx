import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import messages from "@/i18n/messages/en/fidelity.json";
import type { Problem } from "@/studio/problems";
import { BurntNotice } from "./BurntNotice";

const burnt = (part: string, name: string, n: number): Problem => ({
  id: `run:burnt:${part}`,
  severity: "error",
  source: "run",
  titleKey: "fidelity.states.led",
  args: { name, n, imax: 20, limit: 50 },
});

describe("BurntNotice", () => {
  it("says nothing while nothing has burnt", () => {
    render(<BurntNotice problems={[]} messages={messages} lang="en" />);
    expect(screen.queryByTestId("burnt-notice")).toBeNull();
  });

  it("names each part that burnt with the current through it and its rating", () => {
    render(<BurntNotice problems={[burnt("a", "D1", 120), burnt("b", "D2", 90)]} messages={messages} lang="en" />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("D1 burned out: 120 mA went through it");
    expect(items[0]).toContain("(2.5 times its 20 mA rating)");
    expect(items[1]).toContain("D2 burned out: 90 mA");
  });
});
