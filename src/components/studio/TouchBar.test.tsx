import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import studio from "@/i18n/messages/en/studio.json";
import { registerCommand, type CommandCtx } from "@/studio/commands";
import { createStore } from "@/studio/stores/select";
import { createSessionStore } from "@/studio/stores/session";
import { createUiStore } from "@/studio/stores/ui";
import { TouchBar } from "./TouchBar";

const touch = studio.canvas.touch;
const offs: (() => void)[] = [];

afterEach(() => {
  cleanup();
  while (offs.length > 0) offs.pop()!();
});

function rig(readOnly = false) {
  const ran: string[] = [];
  for (const id of ["view.zoomIn", "view.zoomOut", "view.fit", "place.rotate", "edit.delete"]) {
    offs.push(registerCommand({ id, labelKey: id, scope: "canvas", enabled: () => true, run: () => void ran.push(id) }));
  }
  const doc = createStore({ readOnly }) as unknown as CommandCtx["doc"];
  const session = createSessionStore("vw_bb");
  const ui = createUiStore("prj_a", { getItem: () => null, setItem: () => {} }, {});
  render(<TouchBar doc={doc} session={session} ui={ui} messages={touch} />);
  return { ran, session };
}

describe("TouchBar", () => {
  it("zooms and fits through the commands the keys run", () => {
    const { ran } = rig();
    fireEvent.click(screen.getByRole("button", { name: touch.zoomIn }));
    fireEvent.click(screen.getByRole("button", { name: touch.zoomOut }));
    fireEvent.click(screen.getByRole("button", { name: touch.fit }));
    expect(ran).toEqual(["view.zoomIn", "view.zoomOut", "view.fit"]);
  });

  it("offers turn and delete only while something is selected", () => {
    const { ran, session } = rig();
    expect(screen.queryByRole("button", { name: touch.delete })).toBeNull();
    act(() => session.setSelection([{ kind: "part", view: "vw_bb", id: "cmp_1" }]));
    fireEvent.click(screen.getByRole("button", { name: touch.rotate }));
    fireEvent.click(screen.getByRole("button", { name: touch.delete }));
    expect(ran).toEqual(["place.rotate", "edit.delete"]);
  });

  it("leaves turn and delete out of a read only project", () => {
    const { session } = rig(true);
    act(() => session.setSelection([{ kind: "part", view: "vw_bb", id: "cmp_1" }]));
    expect(screen.queryByRole("button", { name: touch.delete })).toBeNull();
  });
});
