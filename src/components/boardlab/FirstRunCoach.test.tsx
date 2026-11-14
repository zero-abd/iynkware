import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import uno from "@/content/boards/uno-r3";
import prose from "@/i18n/content/en/boards/uno-r3.json";
import boardlab from "@/i18n/messages/en/boardlab.json";
import { createBoardLabStore, initialState } from "@/lib/boardlab/store";
import { FirstRunCoach } from "./FirstRunCoach";
import { BoardLabText } from "./text";

const blink = uno.lessons.find((l) => l.id === "blink")!;

function setup(onBreakIt?: () => void) {
  const store = createBoardLabStore(initialState({ board: "uno-r3", lesson: "blink", language: "arduino-cpp", template: blink.code.source, params: blink.params }));
  render(
    <BoardLabText locale="en" messages={boardlab} text={prose}>
      <FirstRunCoach store={store} onBreakIt={onBreakIt} />
    </BoardLabText>,
  );
  return store;
}

function run(store: ReturnType<typeof setup>) {
  act(() => store.dispatch({ type: "run/start" }));
  act(() => store.dispatch({ type: "run/phase", id: store.getState().run.id, status: "running" }));
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/en/boards/uno-r3/blink?try=1");
});
afterEach(() => window.history.replaceState(null, "", "/"));

test("shows nothing unless the landing page sent the visitor", () => {
  window.history.replaceState(null, "", "/en/boards/uno-r3/blink");
  setup();
  expect(screen.queryByTestId("first-run-coach")).toBeNull();
});

test("asks for an edit, and a run of the untouched code doesn't count", () => {
  const store = setup();
  expect(screen.getByText(boardlab.tryIt.edit)).toBeTruthy();
  run(store);
  expect(screen.getByText(boardlab.tryIt.edit)).toBeTruthy();
  expect(store.getState().code).toContain("delay(500)");
});

test("a run of edited code says so and opens Break it", () => {
  const onBreakIt = vi.fn();
  const store = setup(onBreakIt);
  act(() => store.dispatch({ type: "param/set", id: "on", value: 100 }));
  run(store);
  expect(screen.getByText(boardlab.tryIt.done)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: boardlab.tryIt.breakIt }));
  expect(onBreakIt).toHaveBeenCalledOnce();
  expect(screen.queryByTestId("first-run-coach")).toBeNull();
  expect(localStorage.getItem("iynk:first-run:v1")).toBe("1");
});

test("once closed it stays closed, now and on the next visit", () => {
  const store = setup();
  fireEvent.click(screen.getByRole("button", { name: boardlab.tryIt.close }));
  act(() => store.dispatch({ type: "code/replace", code: "void setup() {}\nvoid loop() {}\n" }));
  run(store);
  expect(screen.queryByTestId("first-run-coach")).toBeNull();
  expect(localStorage.getItem("iynk:first-run:v1")).toBe("1");
});

test("a visitor who closed it once isn't asked again", () => {
  localStorage.setItem("iynk:first-run:v1", "1");
  setup();
  expect(screen.queryByTestId("first-run-coach")).toBeNull();
});
