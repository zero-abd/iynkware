// @vitest-environment node
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "./builtin";
import { modelLabelOf } from "./model-label";
import { buildPartIndex, searchParts } from "./search";

const registry = builtinRegistry();
const label = (ref: string) => modelLabelOf(registry.latest(ref)!);

describe("modelLabelOf", () => {
  it("reads Mechanical for the robot's plate, wheel and caster, which have no electrical job", () => {
    for (const ref of ["core.chassis-2wd", "core.wheel-65", "core.caster-ball"]) expect(label(ref)).toBe("mechanical");
  });

  it("leaves a part with a circuit job as its status says, and a battery holder as not modelled", () => {
    expect(label("core.resistor")).toBe("modelled");
    expect(label("core.uno-r3")).toBe("modelled");
    expect(registry.latest("core.chassis-2wd")!.simulation.status).toBe("not-modelled-yet");
  });

  it("keeps mechanical parts out of the runnable filter, like other parts the solver has nothing for", () => {
    const index = buildPartIndex(registry);
    expect(searchParts(index, "chassis", "en").map((e) => e.model)).toEqual(["mechanical"]);
    expect(searchParts(index, "chassis", "en", { runnable: true })).toEqual([]);
  });
});
