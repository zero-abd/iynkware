// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { actuatorCircuit } from "./actuator-circuit.ts";

const FIXTURE = join(import.meta.dirname, "../../../e2e/fixtures/actuators.project.json");

// The e2e cannot load the builder (it reads import.meta), so it opens this file. UPDATE_FIXTURE=1 rewrites it.
it("matches the project file the actuators e2e opens", () => {
  const text = `${JSON.stringify(actuatorCircuit().project, null, 2)}\n`;
  if (process.env.UPDATE_FIXTURE === "1") writeFileSync(FIXTURE, text);
  expect(readFileSync(FIXTURE, "utf8")).toBe(text);
});
