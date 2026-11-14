import { describe, expect, test } from "vitest";
import { NAV, showNavEntry } from "./nav";

describe("showNavEntry", () => {
  test("Together stays in the nav", () => {
    const together = NAV.find((entry) => entry.id === "together");
    expect(together && showNavEntry(together, "bar")).toBe(true);
    expect(together && showNavEntry(together, "footer")).toBe(true);
  });
});

describe("prefetching", () => {
  test("every page but the dashboard waits for a click, so a lab page's script budget is not spent on its neighbours", () => {
    expect(NAV.filter((entry) => !entry.heavy).map((entry) => entry.id)).toEqual(["dashboard"]);
  });
});
