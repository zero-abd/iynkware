import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { DashItem } from "@/components/shell/dashboard/data";
import { HomeSection, workbenchHref } from "./primitives";

test("HomeSection is a section named by its heading", () => {
  render(
    <HomeSection id="labs" n="01" motif="chip" title="Three labs">
      <p>body</p>
    </HomeSection>,
  );
  const section = screen.getByRole("region", { name: "Three labs" });
  const heading = screen.getByRole("heading", { name: "Three labs" });
  expect(section.tagName).toBe("SECTION");
  expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
  expect(section.textContent).toContain("body");
});

test("workbenchHref falls back to the board page in the language", () => {
  expect(workbenchHref("de")).toBe("/de/boards/uno-r3");
});

test("workbenchHref opens the Blink lesson with its first-run tip", () => {
  const uno: DashItem = {
    lab: "board",
    id: "uno-r3",
    title: "Arduino Uno R3",
    href: "/en/boards/uno-r3",
    entries: [
      { key: "boards:uno-r3:lesson:board", kind: "lesson", href: "/en/boards/uno-r3/board" },
      { key: "boards:uno-r3:lesson:blink", kind: "lesson", href: "/en/boards/uno-r3/blink" },
    ],
  };
  expect(workbenchHref("en", uno)).toBe("/en/boards/uno-r3/blink?try=1");
});

test("workbenchHref takes the first lesson when there is no Blink", () => {
  const uno: DashItem = {
    lab: "board",
    id: "uno-r3",
    title: "Arduino Uno R3",
    href: "/en/boards/uno-r3",
    entries: [{ key: "boards:uno-r3:lesson:board", kind: "lesson", href: "/en/boards/uno-r3/board" }],
  };
  expect(workbenchHref("en", uno)).toBe("/en/boards/uno-r3/board");
});
