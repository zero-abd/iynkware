import type { PartRegistry } from "../../parts/registry.ts";
import { PROFILES, boardIdOf, pinElectrical } from "../boards/profiles.ts";
import type { SimPart } from "../engine.ts";
import { loadRegistry } from "../registry/entries.ts";
import type { Registry } from "../registry/types.ts";
import { type BoardPin, type LiveAnalog, createLiveAnalog } from "./live.ts";
import { type BoardPower, readBoardPower } from "./rails.ts";
import { solve } from "./solve.ts";

const profileOf = (part: SimPart) => (part.kind === "board" ? PROFILES[boardIdOf(part.descriptor)] : undefined);

/**
 * The live solver of a Studio run: board pins carry the electrical figures of the board they sit on and the brown-out
 * minimum comes from the board's own descriptor. `parts` is where descriptors are looked up.
 */
export function createRunAnalog(parts: Pick<PartRegistry, "get">, registry: Registry = loadRegistry()): LiveAnalog {
  const descriptorOf = (part: SimPart) => {
    const at = part.descriptor.lastIndexOf("@");
    return parts.get(part.descriptor.slice(0, at), part.descriptor.slice(at + 1));
  };
  return createLiveAnalog({
    solve,
    registry,
    pins(part): BoardPin | null {
      const profile = profileOf(part);
      return profile ? { ...pinElectrical(profile), logicVolts: profile.logicV } : null;
    },
    power(part): BoardPower | null {
      const descriptor = profileOf(part) ? descriptorOf(part) : undefined;
      return descriptor ? readBoardPower(descriptor) : null;
    },
  });
}
