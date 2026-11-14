import { describe, expect, it } from "vitest";
import { importEngineScript, type LoadedFile } from "./loader";

const file = (url: string): LoadedFile => ({ path: "x", url, kind: "js", bytes: new ArrayBuffer(0) });

describe("importEngineScript", () => {
  it("imports the module from the file's own URL, not from a blob", async () => {
    const mod = await importEngineScript<{ answer: number }>(file("data:text/javascript,export const answer = 42"));
    expect(mod.answer).toBe(42);
  });

  it("rejects when the module cannot be loaded", async () => {
    await expect(importEngineScript(file("data:text/javascript,throw new Error('boom')"))).rejects.toThrow("boom");
  });
});
