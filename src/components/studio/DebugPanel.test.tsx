import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import fidelity from "@/i18n/messages/en/fidelity.json";
import { DebugPanel } from "./DebugPanel";

afterEach(cleanup);

describe("DebugPanel", () => {
  it("lets the four buttons wrap and drops the key caps on a touch screen, so a phone does not scroll them out of sight", () => {
    render(<DebugPanel state="paused" at={null} onStep={vi.fn()} onResume={vi.fn()} strings={fidelity.debug} />);
    expect(screen.getByRole("group", { name: fidelity.debug.toggle }).className).toContain("flex-wrap");
    for (const key of ["F5", "F10", "F11", "Shift F11"]) expect(screen.getByText(key).className).toContain("[@media(pointer:coarse)]:hidden");
  });
});
