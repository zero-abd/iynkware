/**
 * The core part an imported part is electrically identical to: same pins and same behaviour, byte for byte once
 * canonicalised. The simulator keys its solver specs, sensor inputs and part-state providers on the core catalogue
 * name, and the run worker resolves only built-in descriptors, so an imported variant of a modelled part (a vendor's
 * re-badged LED or BME280 breakout) runs as its twin. Anything that differs in pins or behaviour has no twin and is
 * simulated, or reported as unmodelled, exactly as before. Core parts never take a twin.
 */
import { canonicalize } from "../core/canonical.ts";
import type { Descriptor } from "../parts/descriptor.ts";
import type { PartRegistry } from "../parts/registry.ts";

export type TwinRegistry = Pick<PartRegistry, "get" | "list" | "originOf">;

/** What makes two parts the same to the simulator. Identity, provenance and art are free to differ. */
function electricalKey(d: Descriptor): string {
  return canonicalize({ pins: d.pins, behaviour: d.behaviour });
}

/** Core parts by electrical key; null where two core parts share a key, so a twin is never a guess. */
const indexes = new WeakMap<object, Map<string, string | null>>();
const twins = new WeakMap<Descriptor, string | null>();

function coreIndex(reg: TwinRegistry): Map<string, string | null> {
  let index = indexes.get(reg);
  if (index) return index;
  index = new Map();
  for (const summary of reg.list()) {
    if (reg.originOf(summary.ref, summary.version) !== "core") continue;
    const d = reg.get(summary.ref, summary.version);
    if (!d) continue;
    const key = electricalKey(d);
    const id = `${summary.ref}@${summary.version}`;
    index.set(key, index.has(key) ? null : id);
  }
  indexes.set(reg, index);
  return index;
}

/** `core.<name>@<version>` for an imported or local part with a unique core twin, else undefined. */
export function coreTwinOf(d: Descriptor, reg: TwinRegistry): string | undefined {
  if (reg.originOf(d.id, d.version) === "core") return undefined;
  let twin = twins.get(d);
  if (twin === undefined) {
    twin = coreIndex(reg).get(electricalKey(d)) ?? null;
    twins.set(d, twin);
  }
  return twin ?? undefined;
}
