import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import studio from "@/i18n/messages/en/studio.json";
import studioEdit from "@/i18n/messages/en/studioEdit.json";
import studioInspect from "@/i18n/messages/en/studioInspect.json";
import studioWire from "@/i18n/messages/en/studioWire.json";
import { createSessionStore } from "@/studio/stores/session";
import { ToolMessage } from "./ToolMessage";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function rig() {
  const session = createSessionStore("vw_bb");
  render(<ToolMessage session={session} messages={{ studio, studioEdit, studioInspect, studioWire }} lang="en" />);
  return { session, live: screen.getByRole("status") };
}

describe("ToolMessage", () => {
  it("is empty until a tool reports something, then says it in words", () => {
    const { session, live } = rig();
    expect(live.textContent).toBe("");
    act(() => session.setStatus({ key: "edit.place.placedLoose", params: { refdes: "D1" } }));
    expect(live.textContent).toBe(studioEdit.edit.place.placedLoose.replace("{refdes}", "D1"));
    act(() => session.setStatus({ key: "wire.refuse.empty-target" }));
    expect(live.textContent).toBe(studioWire.wire.refuse["empty-target"]);
    act(() => session.setStatus({ key: "select.deleted", params: { count: 2 } }));
    expect(live.textContent).toBe("2 items deleted. Undo brings them back.");
    act(() => session.setStatus({ key: "ops.rejected", params: { message: "no such part" } }));
    expect(live.textContent).toBe("That change was refused: no such part");
  });

  it("lets go of a message after a while, and shows the next one in full", () => {
    vi.useFakeTimers();
    const { session, live } = rig();
    act(() => session.setStatus({ key: "wire.cancelled" }));
    act(() => vi.advanceTimersByTime(8000));
    expect(live.textContent).toBe("");
    act(() => session.setStatus({ key: "wire.cancelled" }));
    expect(live.textContent).toBe(studioWire.wire.cancelled);
  });

  it("leaves the scene error to its own callout", () => {
    const { session, live } = rig();
    act(() => session.setStatus({ key: "views.sceneError" }));
    expect(live.textContent).toBe("");
  });
});
