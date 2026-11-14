import { NS_PER_MS, type SimTime } from "../core/clock.ts";
import type { ResetFact, RobotFacts, RobotSample } from "../mech/facts.ts";
import type { RobotNets } from "../mech/rails.ts";
import { regulatorOut } from "../registry/power-models.ts";
import type { RunFacts } from "./types.ts";

const START_WINDOW_NS = 50 * NS_PER_MS;
const START_FROM_A = 0.05;
const START_TO_A = 0.1;

function packVoltageAt(supply: RobotFacts["supply"], at: SimTime): number {
  let found = Number.NaN;
  for (const s of supply) {
    if (s.atNs > at) break;
    found = s.v;
  }
  return found;
}

/** The first sample in the window before `at` where a joint's armature current climbed from idle to running. */
function motorStartBefore(samples: readonly RobotSample[], at: SimTime): number | null {
  const previous = new Map<string, number>();
  for (const s of samples) {
    if (s.atNs > at) break;
    const before = previous.get(s.joint);
    previous.set(s.joint, s.armatureA);
    if (s.atNs >= at - START_WINDOW_NS && before !== undefined && before < START_FROM_A && s.armatureA > START_TO_A) return s.atNs;
  }
  return null;
}

/**
 * What the regulator input and the logic rail read at each reset. A solved run gives them as node voltages; the
 * worker has no solver, so otherwise they follow the pack: the regulator input is the pack when they share a net,
 * and the rail is the regulator's output, or the pack itself when the rail is wired straight to it.
 */
export function buildResetFacts(resets: readonly SimTime[], robot: RobotFacts, node: RunFacts["node"], nets: RobotNets): ResetFact[] {
  const { regulator } = robot;
  return resets.map((atNs) => {
    const packV = packVoltageAt(robot.supply, atNs);
    const regV = node(nets.regulator, atNs)?.v ?? (nets.regulator && nets.regulator === nets.pack ? packV : Number.NaN);
    const fed = regulator ? regulatorOut(regulator, regV) : Number.NaN;
    const direct = nets.rail && nets.rail === nets.pack ? packV : Number.NaN;
    return {
      atNs,
      packV,
      regV,
      railV: node(nets.rail, atNs)?.v ?? (regulator ? fed : direct),
      motorStartNs: motorStartBefore(robot.samples, atNs),
    };
  });
}

export function withRobotFacts(base: RunFacts, robot: RobotFacts, nets: RobotNets): RunFacts {
  return { ...base, robot: { ...robot, resets: buildResetFacts(base.resets, robot, base.node, nets) } };
}
