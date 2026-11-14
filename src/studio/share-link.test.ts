// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Project } from "../project/generated/types.ts";
import { blinkAssignment, parts } from "./assignment/fixture.testing.ts";
import { openProjectLink, parseProjectFragment, PROJECT_LINK_LIMIT, projectLink } from "./share-link.ts";

const at = { origin: "https://iynk.example", lang: "en" };

async function linked(doc: Project): Promise<string> {
  const made = await projectLink(doc, parts, at);
  if (!made.ok) throw new Error(made.reason);
  return made.link;
}

describe("project links", () => {
  it("carry the project in the fragment and open it as a read-only share that can be copied", async () => {
    const doc = blinkAssignment();
    const link = await linked(doc);
    expect(link.startsWith("https://iynk.example/en/studio#project=")).toBe(true);
    const code = parseProjectFragment(link.slice(link.indexOf("#")));
    expect(code).not.toBeNull();
    const result = await openProjectLink(code!, parts);
    if (!result.ok) throw new Error(result.reason);
    const { opened } = result;
    expect(opened.doc.id).toBe(doc.id);
    expect(opened.doc.sources).toEqual(doc.sources);
    expect(opened.doc.components).toEqual(doc.components);
    expect(opened.doc.boards).toEqual(doc.boards);
    expect(opened.share.allowFork).toBe(true);
    expect(opened.share.expiresAt).toBeNull();
  });

  it("refuse a project with attached files, since the link carries no file bodies", async () => {
    const doc = { ...blinkAssignment(), assets: [{ sha256: "a".repeat(64), mediaType: "image/png", name: "photo.png", bytes: 10 }] } as unknown as Project;
    expect(await projectLink(doc, parts, at)).toEqual({ ok: false, reason: "hasFiles" });
  });

  it("refuse a project too big for an address", async () => {
    const doc = blinkAssignment();
    // random-looking text doesn't compress, so this is well past the limit once encoded
    const noise = Array.from(crypto.getRandomValues(new Uint8Array(PROJECT_LINK_LIMIT)), (n) => String.fromCharCode(33 + (n % 94))).join("");
    const big = { ...doc, sources: doc.sources.map((s) => ({ ...s, content: s.content + noise })) };
    expect(await projectLink(big, parts, at)).toEqual({ ok: false, reason: "tooLarge" });
  });

  it("open nothing from a code that isn't a project", async () => {
    expect(await openProjectLink("not-a-code", parts)).toEqual({ ok: false, reason: "invalid" });
    expect(parseProjectFragment("#share=abcdefghijklmnopqrstuv")).toBeNull();
    expect(parseProjectFragment("#assignment=abc")).toBeNull();
  });
});
