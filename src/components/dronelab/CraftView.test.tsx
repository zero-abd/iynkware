import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import agrihex from "@/content/drones/agrihex";
import type { FigureHandle } from "@/components/figure";
import { I18nProvider } from "@/i18n/client";
import common from "@/i18n/messages/en/common.json";
import { initialState } from "@/lib/dronelab/workshop";
import messages from "@/i18n/messages/en/dronelab.json";
import text from "@/i18n/content/en/drones/agrihex.json";
import { CraftView } from "./CraftView";
import { contentT, type DroneLabMessages } from "./text";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every observed box reports this width as soon as it is observed. */
function frameWidth(width: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
    },
  );
}

function setup(sheet: "wiring" | null = null) {
  const send = vi.fn();
  const dispatch = vi.fn();
  const focus = vi.fn();
  const figure = {
    send,
    focus,
    sendCustom: vi.fn(),
    observe: () => () => {},
    isReady: () => true,
    info: () => null,
  } as unknown as FigureHandle;
  const state = { ...initialState(agrihex), figureReady: true, sheet };
  render(
    <I18nProvider locale="en" messages={common.client}>
      <CraftView
        lang="en"
        content={agrihex}
        text={contentT("en", agrihex.id, text)}
        messages={messages as unknown as DroneLabMessages}
        state={state}
        dispatch={dispatch}
        figure={figure}
        figureRef={() => {}}
        onFigure={() => {}}
        flyHref="/en/drones/agrihex/fly"
      />
    </I18nProvider>,
  );
  return { send, focus, dispatch };
}

test("See through and Labels are toolbar buttons that drive the figure and show their state", () => {
  const { send } = setup();
  const xr = screen.getByRole("button", { name: "See through" });
  const labels = screen.getByRole("button", { name: "Labels" });
  expect(xr.getAttribute("aria-pressed")).toBe("false");
  expect(labels.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(xr);
  expect(send).toHaveBeenLastCalledWith("xr", { on: true });
  expect(xr.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(labels);
  expect(send).toHaveBeenLastCalledWith("labels", { on: false });
  expect(labels.getAttribute("aria-pressed")).toBe("false");
});

test("T and L toggle them from the keyboard, but not while typing", () => {
  const { send } = setup();
  fireEvent.keyDown(window, { key: "t" });
  expect(send).toHaveBeenLastCalledWith("xr", { on: true });
  fireEvent.keyDown(window, { key: "L" });
  expect(send).toHaveBeenLastCalledWith("labels", { on: false });
  send.mockClear();
  const field = document.body.appendChild(document.createElement("input"));
  fireEvent.keyDown(field, { key: "t" });
  expect(send).not.toHaveBeenCalled();
});

test("the wiring sheet disables them and their keys", () => {
  const { send } = setup("wiring");
  expect(
    screen
      .getByRole("button", { name: "See through" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.keyDown(window, { key: "t" });
  expect(send).not.toHaveBeenCalled();
});

test("X turns Exploded view on from the keyboard", () => {
  const { dispatch } = setup();
  expect(screen.getByRole("button", { name: "Exploded view" }).getAttribute("aria-keyshortcuts")).toBe("X");
  fireEvent.keyDown(window, { key: "x" });
  expect(dispatch).toHaveBeenLastCalledWith({ type: "exploded", on: true });
});

test("a phone-width figure has no Labels switch, and L does nothing there", () => {
  frameWidth(400);
  const { send } = setup();
  expect(screen.queryByRole("button", { name: "Labels" })).toBeNull();
  fireEvent.keyDown(window, { key: "l" });
  expect(send).not.toHaveBeenCalled();
});

test("a wider figure keeps the Labels switch", () => {
  frameWidth(800);
  setup();
  expect(screen.getByRole("button", { name: "Labels" })).toBeTruthy();
});
