import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FloatingControls } from "./FloatingControls";

type Entry = { isIntersecting: boolean; target: Element };
let observers: StubObserver[] = [];

class StubObserver {
  targets: Element[] = [];
  disconnect = vi.fn();
  constructor(private callback: (entries: Entry[]) => void) {
    observers.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  fire(el: Element, isIntersecting: boolean) {
    this.callback([{ isIntersecting, target: el }]);
  }
}

const labels = { font: "Reading face", theme: "Theme", light: "Light", dark: "Dark" };

function stubWidth(narrow: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: narrow, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

function page(narrow: boolean) {
  stubWidth(narrow);
  render(
    <>
      <section data-pill-home="">hero</section>
      <section data-pill-clear="">last call</section>
      <footer>footer</footer>
      <FloatingControls labels={labels} />
    </>,
  );
  const pill = screen.getByRole("group", { name: "Theme" }).parentElement!;
  const bottom = observers.find((o) => o.targets.length === 2)!;
  const top = observers.find((o) => o.targets.length === 1)!;
  return { pill, bottom, top };
}

const flushFrame = () => act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", StubObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FloatingControls", () => {
  it("steps aside while the last call to action or the footer reaches the bottom of the screen", async () => {
    const { pill, bottom } = page(false);
    await flushFrame();
    expect(pill.dataset.tucked).toBe("false");

    const [cta, footer] = bottom.targets;
    act(() => bottom.fire(cta, true));
    expect(pill.dataset.tucked).toBe("true");
    expect(pill.hasAttribute("inert")).toBe(true);

    act(() => bottom.fire(footer, true));
    act(() => bottom.fire(cta, false));
    expect(pill.dataset.tucked).toBe("true");

    act(() => bottom.fire(footer, false));
    expect(pill.dataset.tucked).toBe("false");
    expect(pill.hasAttribute("inert")).toBe(false);
  });

  it("on a narrow screen shows only while the hero is on screen", async () => {
    const { pill, top } = page(true);
    await flushFrame();
    expect(pill.dataset.tucked).toBe("false");

    act(() => top.fire(top.targets[0], false));
    expect(pill.dataset.tucked).toBe("true");

    act(() => top.fire(top.targets[0], true));
    expect(pill.dataset.tucked).toBe("false");
  });

  it("stays on a wide screen when the hero scrolls away", async () => {
    const { pill, top } = page(false);
    await flushFrame();
    act(() => top.fire(top.targets[0], false));
    expect(pill.dataset.tucked).toBe("false");
  });

  it("stays put where there is no IntersectionObserver", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    stubWidth(true);
    render(<FloatingControls labels={labels} />);
    await flushFrame();
    expect(screen.getByRole("group", { name: "Theme" }).parentElement!.dataset.tucked).toBe("false");
  });
});
