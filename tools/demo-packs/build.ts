/**
 * Builds the demo part packs in public/demo-packs/ (the 2D site) and xr/public/demo-packs/ (the headset), with an
 * index.json listing them: parts a person could bring as their own file and import, each a
 * re-badged variant of a modelled core part, so it runs on the bench the moment it is imported. Deterministic: the same
 * inputs give the same bytes. Every pack is read back through `readPack` with the parts library's own context and
 * refused if any part has an error diagnostic.
 *
 *   node --experimental-strip-types tools/demo-packs/build.ts           write the packs
 *   node --experimental-strip-types tools/demo-packs/build.ts --check   rebuild in memory, fail if a file differs
 *
 * An imported part reuses a simulation model the app already has; a new kind of chip still needs a code model.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPack, readPack } from "../../src/export/pack.ts";
import type { PackItem, ReadContext } from "../../src/export/pack.ts";
import { BUILTIN_DESCRIPTORS } from "../../src/parts/builtin.ts";
import { digestOf } from "../../src/parts/descriptor.ts";
import type { Descriptor } from "../../src/parts/descriptor.ts";
import { CORE_CAUSE_IDS } from "../../src/sim/faults/cause-ids.ts";
import { SYMPTOM_IDS } from "../../src/sim/faults/symptoms.ts";
import { builtinRefsForImport } from "../../src/sim/models/builtins.ts";
import { DEMO_PARTS, PACK_AUTHOR, PACK_CREATED } from "./parts.ts";
import type { DemoPart } from "./parts.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The 2D site and the headset app each serve their own copy; the bytes are the same. */
const outDirs = [join(root, "public", "demo-packs"), join(root, "xr", "public", "demo-packs")];
const check = process.argv.includes("--check");

/** The same set the parts library checks imports against (src/parts/browser/library.ts). */
const CAUSE_IDS: ReadonlySet<string> = new Set<string>([...CORE_CAUSE_IDS, ...SYMPTOM_IDS]);

const core = new Map<string, Descriptor>();
for (const value of BUILTIN_DESCRIPTORS) {
  const d = value as Descriptor;
  core.set(d.id, d);
}

/** A core descriptor turned into the person's imported variant. Behaviour, pins and simulation stay the base part's. */
export function variantOf(spec: DemoPart): Descriptor {
  const base = core.get(spec.base);
  if (!base) throw new Error(`${spec.slug}: no core part ${spec.base}`);
  const d = structuredClone(base) as Descriptor & Record<string, unknown>;
  d.id = `demo.${spec.slug}`;
  d.version = "1.0.0";
  const identity = d.identity as Record<string, unknown>;
  identity.manufacturer = spec.manufacturer;
  identity.model = spec.model;
  // Generic: the demo brands are invented, so there is no datasheet to cite (the schema asks a non-generic part for one).
  identity.generic = true;
  identity.description = { en: spec.description };
  identity.tags = [...new Set([...(spec.tags ?? []), ...((identity.tags as string[] | undefined) ?? [])])];
  delete identity.legacy_ids;
  if (spec.mpn) identity.mpn = spec.mpn;
  const provenance = d.provenance as Record<string, unknown>;
  provenance.origin = "imported-pack";
  provenance.authors = [PACK_AUTHOR];
  provenance.created = PACK_CREATED.slice(0, 10);
  provenance.changelog = [{
    version: "1.0.0",
    date: PACK_CREATED.slice(0, 10),
    note: `Demo import: a re-badged ${base.id}@${base.version}; behaviour, pins and simulation are unchanged.`,
    behaviour_change: false,
  }];
  // Imported parts may not ship executable figure pages (HTML with script); they draw with the generic fallback.
  const visual = d.visual as Record<string, unknown>;
  delete visual.breadboard;
  const fallback = visual.fallback as Record<string, unknown> | undefined;
  if (fallback) {
    fallback.label = spec.label;
    if (spec.colour) fallback.body_colour = spec.colour;
  }
  // Imported parts must name registered cause and symptom ids or mark their own with x-. Some core files spell a
  // registered id with a dot (led.dark for led-dark); use the registered spelling, else mark the id as the part's own.
  const known = (id: string): string => {
    if (id.startsWith("x-") || CAUSE_IDS.has(id)) return id;
    const hyphen = id.replaceAll(".", "-");
    return CAUSE_IDS.has(hyphen) ? hyphen : `x-${hyphen}`;
  };
  for (const list of [d.failure_modes, d.injectable_faults] as ({ cause_id: string; symptom_ids: string[] }[] | undefined)[]) {
    for (const f of list ?? []) {
      f.cause_id = known(f.cause_id);
      f.symptom_ids = f.symptom_ids.map(known);
    }
  }
  spec.edit?.(d);
  return d;
}

const ctx: ReadContext = {
  sender: "demo-packs build",
  installed: new Map(),
  builtinRefs: builtinRefsForImport(),
  causeIds: CAUSE_IDS,
};

function errorsOf(item: PackItem): string[] {
  return item.issues.filter((i) => i.severity === "error").map((i) => `${i.code} ${i.path}: ${i.message}`);
}

let failed = false;

/** Writes `bytes` to `file`, or with --check fails when the file on disk differs. */
function write(file: string, bytes: Uint8Array): void {
  if (!check) return writeFileSync(file, bytes);
  if (!existsSync(file) || Buffer.compare(readFileSync(file), Buffer.from(bytes)) !== 0) {
    failed = true;
    console.error(`${file.slice(root.length + 1)}: out of date; run node --experimental-strip-types tools/demo-packs/build.ts`);
  }
}
if (!check) for (const dir of outDirs) mkdirSync(dir, { recursive: true });
/** What `index.json` lists: the file and the part it holds, so a picker can show the part before fetching the pack. */
const index: { file: string; id: string; version: string; manufacturer: string; model: string }[] = [];
for (const spec of DEMO_PARTS) {
  const def = variantOf(spec);
  const bytes = await buildPack([{ def, files: new Map() }], {
    id: `demo.${spec.slug}`,
    version: "1.0.0",
    authors: [PACK_AUTHOR],
    createdIso: PACK_CREATED,
  });
  const plan = await readPack(bytes, ctx);
  const name = `${spec.slug}.iynkpack`;
  if (!plan.ok) {
    failed = true;
    console.error(`${name}: refused: ${plan.error.code} ${plan.error.detail}`);
    continue;
  }
  const errors = plan.items.flatMap(errorsOf);
  const warnings = plan.items.flatMap((i) => i.issues.filter((d) => d.severity !== "error").map((d) => `${d.code} ${d.path}`));
  if (errors.length) {
    failed = true;
    console.error(`${name}: ${errors.length} error(s)\n  ${errors.join("\n  ")}`);
    continue;
  }
  index.push({ file: name, id: def.id, version: def.version, manufacturer: def.identity.manufacturer, model: def.identity.model });
  for (const dir of outDirs) write(join(dir, name), bytes);
  console.log(`${name}  ${bytes.length} B  ${digestOf(def).slice(0, 12)}  labels=${JSON.stringify(plan.items[0].labels)}` +
    (warnings.length ? `  warnings=${warnings.length}` : ""));
}
const indexBytes = new TextEncoder().encode(`${JSON.stringify({ packs: index }, null, 2)}\n`);
for (const dir of outDirs) write(join(dir, "index.json"), indexBytes);
if (failed) process.exit(1);
