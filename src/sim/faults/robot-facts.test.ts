// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NS_PER_MS } from "../core/clock.ts";
import type { RobotFacts } from "../mech/facts.ts";
import type { RobotNets } from "../mech/rails.ts";
import { buildResetFacts } from "./robot-facts.ts";
import type { RunFacts } from "./types.ts";

const nets: RobotNets = { pack: "pack", regulator: "pack", rail: "rail" };
const none: RunFacts["node"] = () => undefined;

const robot = (over: Partial<RobotFacts> = {}): RobotFacts => ({
  samples: [
    { atNs: 0, joint: "l", speedRadS: 0, angleRad: 0, cmdSign: 0, armatureA: 0, torqueNm: 0, surfaceSpeedMps: 0, groundSpeedMps: 0, tiltDeg: 0, driverState: "coast" },
    { atNs: 60 * NS_PER_MS, joint: "l", speedRadS: 0, angleRad: 0, cmdSign: 1, armatureA: 1.5, torqueNm: 0, surfaceSpeedMps: 0, groundSpeedMps: 0, tiltDeg: 0, driverState: "run" },
  ],
  sensorHeights: {},
  sensors: [],
  supply: [{ atNs: 0, v: 7.4 }, { atNs: 70 * NS_PER_MS, v: 5.2 }],
  resets: [],
  decimated: false,
  ...over,
});

const at = (r: RobotFacts, n: RobotNets = nets, node = none) => buildResetFacts([80 * NS_PER_MS], r, node, n)[0];

describe("reset facts", () => {
  it("reads the pack from the supply history and finds the motor start before the reset", () => {
    expect(at(robot())).toMatchObject({ atNs: 80 * NS_PER_MS, packV: 5.2, motorStartNs: 60 * NS_PER_MS });
  });

  it("takes the regulator input as the pack when they share a net", () => {
    expect(at(robot()).regV).toBe(5.2);
    expect(at(robot(), { ...nets, regulator: "vin" }).regV).toBeNaN();
  });

  it("holds the rail at the regulator output until the pack drops within its dropout", () => {
    const regulator = { kind: "linear", voutVolts: 5, dropoutVolts: 1.1 } as const;
    expect(at(robot({ regulator })).railV).toBeCloseTo(4.1);
    expect(at(robot({ regulator, supply: [{ atNs: 0, v: 7.4 }] })).railV).toBe(5);
    expect(at(robot({ regulator, supply: [{ atNs: 0, v: 0.5 }] })).railV).toBe(0);
  });

  it("holds a buck-boost rail across its input range and drops it outside", () => {
    const regulator = { kind: "buck-boost", voutVolts: 3.3, minInVolts: 1.8, maxInVolts: 5.5 } as const;
    expect(at(robot({ regulator, supply: [{ atNs: 0, v: 2 }] })).railV).toBe(3.3);
    expect(at(robot({ regulator, supply: [{ atNs: 0, v: 1.5 }] })).railV).toBe(0);
  });

  it("follows the pack when the rail is wired straight to it, and is unknown otherwise", () => {
    expect(at(robot(), { ...nets, regulator: "", rail: "pack" }).railV).toBe(5.2);
    expect(at(robot()).railV).toBeNaN();
  });

  it("prefers a solved node voltage over the model", () => {
    const solved: RunFacts["node"] = (net) => (net === "rail" ? { v: 3.9, tier: "T1", provenance: "computed" } : undefined);
    expect(at(robot({ regulator: { kind: "linear", voutVolts: 5, dropoutVolts: 0 } }), nets, solved).railV).toBe(3.9);
  });
});
