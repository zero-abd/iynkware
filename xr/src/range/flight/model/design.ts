/**
 * The design on the bench: the pick (battery, motor, prop) read from the project's parameters, the op that changes it,
 * the calculator's numbers and warnings for the panel, and what the flight gets (its `CalcOutputs`, `CraftFaults` and
 * arming rules) from the bench build.
 */
import type { DesignPick, DroneContent } from '@/content/schema';
import { evaluateDesign, isDesignPick } from '@/lib/drone/design';
import { checkLevel, verdicts, type CheckLevel, type DesignCheck, type Verdict } from '@/lib/drone/calc';
import type { ArmRule } from '@/lib/dronelab/bench';
import { flightCalc, flightFaults, flyRules, initialFly, type FlyState } from '@/lib/dronelab/fly';
import type { BreakId } from '@/lib/flight/crash';
import type { CalcOutputs, CraftFaults } from '@/lib/flight/types';
import type { Op, Parameter, Project } from '@/project/generated/types';
import type { BenchReport } from './types';

export type PickSlot = 'batt' | 'motor' | 'prop';
const PARAM: Record<PickSlot, string> = { batt: 'par_batt', motor: 'par_motor', prop: 'par_prop' };

/** The design pick in the document's `par_batt`, `par_motor`, `par_prop`, or the content's default. */
export function pickOf(doc: Project, content: DroneContent): DesignPick {
  const value = (slot: PickSlot) => {
    const p = doc.parameters?.find((x) => x.id === PARAM[slot]);
    return p && typeof p.value === 'string' ? p.value : undefined;
  };
  const pick = { batt: value('batt'), motor: value('motor'), prop: value('prop') };
  return isDesignPick(content.design, pick) ? pick : content.design.default;
}

/** The `param.set` op that picks `value` for `slot` (the whole parameter with the new value), or null if not offered. */
export function pickOp(doc: Project, slot: PickSlot, value: string): Op | null {
  const p = doc.parameters?.find((x) => x.id === PARAM[slot]);
  if (!p || p.value === value) return null;
  if (p.kind === 'choice' && !(p.options ?? []).some((o) => o.value === value)) return null;
  return { k: 'param.set', parameter: { ...p, value } as Parameter };
}

/** A design check with its level (`checkLevel`): `danger` or `warn`; the panel says it with `drone` namespace keys. */
export type LevelledCheck = DesignCheck & { readonly level: CheckLevel };

/** The numbers the design panel shows, from the drone calculator. */
export interface DesignView {
  /** All-up weight, g. */
  readonly weight: number;
  /** Full-throttle thrust per motor, g. */
  readonly thrustPerMotor: number;
  readonly motors: number;
  readonly thrustToWeight: number;
  /** Share of throttle at hover (above 1: cannot hover). */
  readonly hoverThrottle: number;
  /** Full-throttle current, A. */
  readonly maxAmps: number;
  /** Minutes of hover and of aggressive flying. */
  readonly hoverMinutes: number;
  readonly flyMinutes: number;
  /** Price of the picked parts (content prices), where the content has them. */
  readonly price: number | null;
  readonly checks: readonly LevelledCheck[];
  readonly verdicts: readonly Verdict[];
}

export function designView(content: DroneContent, pick: DesignPick): DesignView {
  const { result: r, checks } = evaluateDesign(content.design, pick);
  const d = content.design;
  const prices = [d.batts[pick.batt]?.price, d.motors[pick.motor]?.price, d.props[pick.prop]?.price] as Array<number | undefined>;
  const price = prices.every((p) => typeof p === 'number') ? (prices[0] as number) + r.n * ((prices[1] as number) + (prices[2] as number)) : null;
  return {
    weight: r.auw,
    thrustPerMotor: r.thrust,
    motors: r.n,
    thrustToWeight: r.tw,
    hoverThrottle: r.hoverThr,
    maxAmps: r.maxA,
    hoverMinutes: r.hoverMin,
    flyMinutes: r.flyMin,
    price,
    checks: checks.map((c) => ({ ...c, level: checkLevel[c.code] })),
    verdicts: verdicts(r),
  };
}

/** Break it: faults forced on (true) or taken out (false) over what the bench build has, as the 2D range offers. */
export type Breaks = Partial<Record<BreakId, boolean>>;

function flyState(content: DroneContent, report: BenchReport, pick: DesignPick, breaks: Breaks): FlyState {
  return { ...initialFly(content), source: 'bench', bench: { pick, built: report.built, flight: report.flight, cli: {} }, breaks };
}

/** The arming rules for the bench build (`flyRules`: the 2D range's, in this craft's words); `canArm` reads them. */
export function benchArmRules(content: DroneContent, report: BenchReport, pick: DesignPick, breaks: Breaks = {}): ArmRule[] {
  return flyRules(content, flyState(content, report, pick, breaks));
}

/** The faults the flight session gets from the bench build and Break it. */
export function benchFaults(content: DroneContent, report: BenchReport, pick: DesignPick, breaks: Breaks = {}): CraftFaults {
  return flightFaults(content, flyState(content, report, pick, breaks)) ?? {};
}

/** The flight model's numbers for the design (`fromCalc` of the calculator); `overKv` from Break it. */
export function benchCalc(content: DroneContent, pick: DesignPick, breaks: Breaks = {}): CalcOutputs {
  return flightCalc(content, pick, breaks.overKv);
}
