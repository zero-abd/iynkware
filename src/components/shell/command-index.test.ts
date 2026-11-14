import { describe, expect, it } from "vitest";
import { BOARD_IDS, DRONE_IDS, ROBOTICS_IDS } from "@/content/ids";
import { AVAILABLE, loadBoard } from "@/content/index.generated";
import { LOCALES } from "@/i18n/config";
import { rankCommands } from "./command-items";
import { buildCommandIndex, type IndexEntry } from "./command-index";

const index = buildCommandIndex("en");
const byGroup = (group: IndexEntry["group"]) => index.filter((entry) => entry.group === group);

describe("buildCommandIndex", () => {
  it("finds a board, a lesson, a bench, a drone and a Studio example by what a person would type", () => {
    const find = (query: string) => rankCommands(index, query).map((entry) => entry.group);
    expect(find("uno")).toContain("boards");
    expect(find("servo")).toContain("lessons");
    expect(find("l298n")).toContain("robotics");
    expect(find("quad")).toContain("drones");
    expect(find("reaction")).toContain("studio");
  });

  it("links each board, bench and drone to a page that exists", () => {
    const pages = (group: IndexEntry["group"], prefix: string) => byGroup(group).map((entry) => entry.href.slice(prefix.length));
    for (const id of pages("boards", "/boards/")) expect(BOARD_IDS).toContain(id);
    for (const id of pages("robotics", "/robotics/")) expect(ROBOTICS_IDS).toContain(id);
    for (const id of pages("drones", "/drones/")) expect(DRONE_IDS).toContain(id);
  });

  it("links each lesson to a lesson the board has", async () => {
    const lessons = new Map<string, string[]>();
    for (const id of AVAILABLE.board) lessons.set(id, ((await loadBoard(id))?.lessons ?? []).map((lesson) => lesson.id));
    for (const { href } of byGroup("lessons")) {
      const [, , board, lesson] = href.split("/");
      expect(lessons.get(board), href).toContain(lesson);
    }
  });

  it("opens a Studio example by the template id in the hash", () => {
    for (const { id, href } of byGroup("studio")) expect(href).toBe(`/studio#/t/${id}`);
  });

  it("names every entry in the page's language", () => {
    for (const lang of LOCALES) {
      const entries = buildCommandIndex(lang);
      expect(entries.length).toBe(index.length);
      expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
      for (const entry of entries) expect(entry.label.trim(), `${lang} ${entry.id}`).not.toBe("");
    }
    expect(buildCommandIndex("de").find((entry) => entry.id === "prj_uno-r3-blink")?.label).not.toBe(index.find((entry) => entry.id === "prj_uno-r3-blink")?.label);
  });
});
