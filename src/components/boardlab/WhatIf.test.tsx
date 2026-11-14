import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import uno from "@/content/boards/uno-r3";
import prose from "@/i18n/content/en/boards/uno-r3.json";
import boardlab from "@/i18n/messages/en/boardlab.json";
import { createBoardLabStore, initialState } from "@/lib/boardlab/store";
import { BoardLabText } from "./text";
import { WhatIf } from "./WhatIf";

function setup(circuit: string | null) {
  const store = createBoardLabStore(initialState({ board: "uno-r3", lesson: "blink", language: "arduino-cpp" }));
  const onOpen = vi.fn();
  render(
    <BoardLabText locale="en" messages={boardlab} text={prose}>
      <WhatIf store={store} failures={uno.failures} figure={() => null} circuit={circuit} onOpen={onOpen} />
    </BoardLabText>,
  );
  return { store, onOpen };
}

const ask = (fault: string) => boardlab.whatIf.break.replace("{fault}", fault);

test("on Blink it offers the lesson's own fault, breaks the circuit and opens Break it", () => {
  const { store, onOpen } = setup("blink");
  fireEvent.click(screen.getByRole("button", { name: ask(prose.failures["led-no-resistor"].title) }));
  expect(store.getState().fault).toBe("led-no-resistor");
  expect(onOpen).toHaveBeenCalledOnce();
});

test("while a fault is on, the same button repairs it", () => {
  const { store } = setup("blink");
  act(() => store.dispatch({ type: "fault/trigger", id: "led-backwards" }));
  fireEvent.click(screen.getByRole("button", { name: boardlab.whatIf.repair.replace("{fault}", prose.failures["led-backwards"].title) }));
  expect(store.getState().fault).toBeNull();
});

test("a lesson with no faults of its own offers the board's first", () => {
  setup("servo");
  expect(screen.getByRole("button", { name: ask(prose.failures[uno.failures[0].id as keyof typeof prose.failures].title) })).toBeTruthy();
});
