import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPack } from "../export/pack.ts";
import { builtinRegistry } from "../parts/builtin.ts";
import type { Descriptor } from "../parts/descriptor.ts";
import { CORE_CAUSE_IDS } from "./faults/cause-ids.ts";
import { SYMPTOM_IDS } from "./faults/symptoms.ts";
import { coreTwinOf } from "./import-twin.ts";
import { builtinRefsForImport } from "./models/builtins.ts";
import { buildSimNetlist } from "./netlist.ts";

const PACKS = join(__dirname, "..", "..", "public", "demo-packs");
const PROJECT = join(__dirname, "..", "..", "content", "projects", "boards", "arduino", "prj_uno-r4-blink.project.json");

async function registryWithDemoPacks() {
  const reg = builtinRegistry();
  const causeIds = new Set<string>([...CORE_CAUSE_IDS, ...SYMPTOM_IDS]);
  const imported: Descriptor[] = [];
  for (const file of readdirSync(PACKS).filter((n) => n.endsWith(".iynkpack")).sort()) {
    const plan = await readPack(new Uint8Array(readFileSync(join(PACKS, file))), {
      sender: "test",
      installed: new Map(),
      builtinRefs: builtinRefsForImport(),
      causeIds,
    });
    if (!plan.ok) throw new Error(`${file}: ${plan.error.code}`);
    const item = plan.items[0];
    const added = reg.add(item.descriptor, {
      ctx: { trust: "imported", installed: new Map(), builtinRefs: builtinRefsForImport(), causeIds, candidateDigest: item.digest },
    });
    if (!added.ok) throw new Error(`${file}: ${added.error.map((d) => d.code).join(", ")}`);
    imported.push(added.value);
  }
  return { reg, imported };
}

describe("coreTwinOf", () => {
  it("maps each demo pack to the core part it re-badges", async () => {
    const { reg, imported } = await registryWithDemoPacks();
    const twins = Object.fromEntries(imported.map((d) => [d.id, coreTwinOf(d, reg)?.split("@")[0]]));
    expect(twins).toEqual({
      "demo.blue-led-10mm": "core.led-5mm",
      "demo.bme280-breakout": "core.bme280-module",
      "demo.mpu6050-board": "core.gy521-mpu6050",
      "demo.oled-096": "core.ssd1306",
      "demo.photoresistor-module": "core.ldr",
      "demo.piezo-buzzer": "core.buzzer-piezo",
    });
  });

  it("never gives a core part a twin", async () => {
    const { reg } = await registryWithDemoPacks();
    for (const s of reg.list().filter((p) => p.ref.startsWith("core."))) {
      expect(coreTwinOf(reg.get(s.ref, s.version)!, reg)).toBeUndefined();
    }
  });

  it("gives no twin when pins or behaviour differ", async () => {
    const { reg, imported } = await registryWithDemoPacks();
    const changed = structuredClone(imported[0]) as Descriptor;
    changed.behaviour.layers[0].summary = { en: "different" };
    expect(coreTwinOf(changed, reg)).toBeUndefined();
  });
});

describe("buildSimNetlist with an imported part", () => {
  it("simulates an imported LED as its core twin, wired the same", async () => {
    const { reg } = await registryWithDemoPacks();
    const doc = JSON.parse(readFileSync(PROJECT, "utf8"));
    const led = doc.components.find((c: { definition: { ref: string } }) => c.definition.ref === "core.led-5mm");
    const core = buildSimNetlist(doc, reg).net.parts.find((p) => p.id === led.id)!;
    led.definition = { ...led.definition, ref: "demo.blue-led-10mm", version: "1.0.0" };
    const built = buildSimNetlist(doc, reg);
    const part = built.net.parts.find((p) => p.id === led.id)!;
    expect(part.descriptor).toBe(core.descriptor);
    expect(part.pins).toEqual(core.pins);
    expect(built.diagnostics.some((d) => d.id === "unknown-part")).toBe(false);
  });

  it("leaves callers that pass only get() unchanged", async () => {
    const { reg } = await registryWithDemoPacks();
    const doc = JSON.parse(readFileSync(PROJECT, "utf8"));
    const led = doc.components.find((c: { definition: { ref: string } }) => c.definition.ref === "core.led-5mm");
    led.definition = { ...led.definition, ref: "demo.blue-led-10mm", version: "1.0.0" };
    const part = buildSimNetlist(doc, { get: (r, v) => reg.get(r, v) }).net.parts.find((p) => p.id === led.id)!;
    expect(part.descriptor).toBe("demo.blue-led-10mm@1.0.0");
  });
});
