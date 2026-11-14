import { writeIynk } from "../../src/export/iynk";
import { builtinRegistry } from "../../src/parts/builtin";
import { interfaceOf } from "../../src/parts/pins";
import { blankProject } from "../../src/project/blank";
import type { Net } from "../../src/project/generated/types";

const GRID = 14;
const PITCH_MM = 14;

/**
 * An RC ladder off the Uno's 5 V: every stage is a 1 kohm resistor, a 100 nF capacitor and a 1N4007 to ground, so a
 * stage is 3 parts and a nonlinear node, and the time constant sizes the step at its 10 microsecond floor. 14 stages are 42 analog parts.
 */
export function ladderFile(stages: number): Uint8Array {
  const registry = builtinRegistry();
  const state = blankProject({ board: "uno", title: "Ladder", locale: "en", actor: "usr_perf", now: "2026-11-10T00:00:00.000Z", id: "prj_ladder" });
  const view = state.views.find((v) => v.id === "vw_sch")!;
  const nets: Net[] = [{ id: "net_5v", name: "5V", class: "power", connections: [{ c: "brd_uno", p: "P5V" }, { c: "cmp_r1", p: "P1" }] }];
  const ground = [{ c: "brd_uno", p: "GND" }];
  let placed = 0;
  const add = (c: string, ref: string, refdes: string, params: Record<string, number>) => {
    const descriptor = registry.latest(ref)!;
    state.components.push({ id: c, definition: { ref: descriptor.id, version: descriptor.version }, refdes, params });
    view.placements.push({ c, x_mm: (placed % GRID) * PITCH_MM, y_mm: Math.floor(placed++ / GRID) * PITCH_MM });
    if (!state.dependencies.components.some((d) => d.ref === descriptor.id)) {
      state.dependencies.components.push({ ref: descriptor.id, version: descriptor.version, origin: "builtin", interface: interfaceOf(descriptor) });
    }
  };

  for (let s = 1; s <= stages; s++) {
    add(`cmp_r${s}`, "core.resistor", `R${s}`, { ohms: 1000 });
    add(`cmp_c${s}`, "core.capacitor-ceramic", `C${s}`, { farads: 1e-7 });
    add(`cmp_d${s}`, "core.diode-1n4007", `D${s}`, {});
    const node = [{ c: `cmp_r${s}`, p: "P2" }, { c: `cmp_c${s}`, p: "P1" }, { c: `cmp_d${s}`, p: "A" }];
    if (s < stages) node.push({ c: `cmp_r${s + 1}`, p: "P1" });
    nets.push({ id: `net_n${s}`, connections: node as Net["connections"] });
    ground.push({ c: `cmp_c${s}`, p: "P2" }, { c: `cmp_d${s}`, p: "K" });
  }
  nets.push({ id: "net_gnd", name: "GND", class: "ground", connections: ground as Net["connections"] });
  state.nets = nets;
  state.simulation.solver = { engine: "iynk-mna", options: { mode: "transient" } } as typeof state.simulation.solver;
  return writeIynk(state);
}
