import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import messages from "@/i18n/messages/en/partinfo.json";
import { builtinRegistry } from "@/parts/builtin";
import { makeModelEnv } from "@/sim/models/kinds";
import { partFacts } from "@/sim/models/part-facts";
import { PartPage } from "./PartPage";

const registry = builtinRegistry();

function page(ref: string) {
  const facts = partFacts(registry.latest(ref)!, "core", makeModelEnv((r, v) => registry.get(r, v)), []);
  render(<PartPage facts={facts} messages={messages as never} lang="en" />);
}

describe("PartPage status", () => {
  it("says Modelled for a resistor and keeps its limits listed", () => {
    page("core.resistor");
    expect(screen.getByText(messages.status.modelled)).toBeTruthy();
    expect(screen.getByText(/never overheats/)).toBeTruthy();
  });

  it("says Mechanical part for a chassis, with the line about the robot builder", () => {
    page("core.chassis-2wd");
    expect(screen.getByText(messages.status.mechanical)).toBeTruthy();
    expect(screen.getByText(messages.mechanicalNote)).toBeTruthy();
  });
});
