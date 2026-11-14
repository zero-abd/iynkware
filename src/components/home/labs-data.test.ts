// @vitest-environment node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { BENEFIT_IDS, BENEFIT_STILL } from "./labs-data";

const thumb = (item: string) => join(process.cwd(), "public/thumbs", `${item}.webp`);

test("every benefit has a still that exists", () => {
  expect(Object.keys(BENEFIT_STILL).sort()).toEqual([...BENEFIT_IDS].sort());
  for (const [id, item] of Object.entries(BENEFIT_STILL)) expect(existsSync(thumb(item)), id).toBe(true);
});
