// @vitest-environment node
import { deflateText } from "@/collab/gzip";
import { describe, expect, it } from "vitest";
import { assignmentLink, codeOf, decodeAssignment, decodeValue, encodeAssignment, encodeValue, fromBase64Url, INFLATED_CAP, LINK_LIMIT, parseAssignmentFragment, toBase64Url } from "./codec";
import { blinkAssignment, parts } from "./fixture.testing";
import { MAX_INSTRUCTIONS } from "./types";

describe("codes", () => {
  it("round trip any value through base64url", async () => {
    const value = { a: [1, 2, { b: "ü€😀" }], c: null };
    expect(await decodeValue(await encodeValue(value))).toEqual({ ok: true, value });
  });

  it("use only the characters of a fragment", async () => {
    expect(await encodeValue({ x: "~~~???>>>".repeat(50) })).toMatch(/^[A-Za-z0-9_-]+$/);
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });

  it.each(["", "   ", "not a code", "AAAA", "a+b/c=", "x".repeat(5)])("refuse the text %j", async (text) => {
    expect((await decodeValue(text)).ok).toBe(false);
  });

  it("refuse gzip that is not marked, and a mark with no gzip behind it", async () => {
    const marked = await deflateText('{"a":1}');
    expect((await decodeValue(toBase64Url(marked.subarray(1)))).ok).toBe(false);
    expect((await decodeValue(toBase64Url(Uint8Array.of(1, 2, 3, 4)))).ok).toBe(false);
  });

  it("stop inflating at the cap, so a small code cannot become a huge text", async () => {
    const bomb = await encodeValue({ filler: "0".repeat(INFLATED_CAP + 1) });
    expect(bomb.length).toBeLessThan(10_000);
    expect(await decodeValue(bomb)).toMatchObject({ ok: false, error: { code: "too-large" } });
  });

  it("refuse JSON with a repeated key", async () => {
    const text = '{"a":1,"a":2}';
    expect((await decodeValue(toBase64Url(await deflateText(text)))).ok).toBe(false);
  });
});

describe("the address of an assignment", () => {
  it("is read from a fragment and from a pasted link", () => {
    const link = assignmentLink("de", "https://iynk.example", "abc_DEF-123");
    expect(link).toBe("https://iynk.example/de/studio#assignment=abc_DEF-123");
    expect(parseAssignmentFragment("#assignment=abc_DEF-123")).toBe("abc_DEF-123");
    expect(parseAssignmentFragment("#share=abc")).toBeNull();
    expect(parseAssignmentFragment("#assignment=a b")).toBeNull();
    expect(codeOf(`  ${link}\n`)).toBe("abc_DEF-123");
    expect(codeOf("abc_DEF-123")).toBe("abc_DEF-123");
    expect(codeOf("https://iynk.example/en/studio#share=abc")).toBeNull();
    expect(codeOf("two words")).toBeNull();
  });
});

describe("an assignment in a link", () => {
  it("comes back the same, with the interface of the shipped parts rebuilt", async () => {
    const a = blinkAssignment({ mode: "unwired", locked: ["cmp_led1"] });
    const back = await decodeAssignment(await encodeAssignment(a, parts), parts);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.ext).toEqual(a.ext);
    expect(back.value.components).toEqual(a.components);
    expect(back.value.sources).toEqual(a.sources);
    expect(back.value.dependencies.components.map((d) => d.ref).sort()).toEqual(a.dependencies.components.map((d) => d.ref).sort());
  });

  it("fits in a link for a small circuit, and does not for one with a page of instructions", async () => {
    const small = await encodeAssignment(blinkAssignment({ mode: "board-only" }), parts);
    expect(small.length).toBeLessThan(LINK_LIMIT);
    let seed = 1;
    const noise = Array.from({ length: MAX_INSTRUCTIONS }, () => String.fromCharCode(33 + ((seed = (seed * 48271) % 2147483647) % 90))).join("");
    const long = await encodeAssignment(blinkAssignment({ instructions: noise }), parts);
    expect(long.length).toBeGreaterThan(LINK_LIMIT);
  });

  it("is refused when the code holds something else, or a project with a check that does not belong", async () => {
    expect((await decodeAssignment(await encodeValue({ hello: 1 }), parts)).ok).toBe(false);
    expect((await decodeAssignment(await encodeValue([1, 2]), parts)).ok).toBe(false);
    expect((await decodeAssignment("garbage", parts)).ok).toBe(false);
    const a = blinkAssignment();
    const forged = { ...a, ext: { ...a.ext, "x-iynk-assignment": { ...a.ext["x-iynk-assignment"], checks: [] } } };
    expect((await decodeAssignment(await encodeValue(forged), parts)).ok).toBe(false);
  });
});
