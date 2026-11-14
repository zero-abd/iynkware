import type { PartStateCtx, PartStateProvider } from "./types.ts";

/**
 * One winding's drive, read from the pins a board drives: `plus` and `minus` are the inputs whose levels set the
 * current one way or the other (a driver with one input per coil end has no `minus`).
 */
interface Phase {
  plus: { ctx: PartStateCtx; pin: string; on: 0 | 1 };
  minus?: { ctx: PartStateCtx; pin: string; on: 0 | 1 };
}

/** Which board input sets each output of a bridge or a Darlington array, by the driver's catalogue name (`catalogueName`). */
const DRIVER_INPUTS: Record<string, Record<string, string>> = {
  uln2003: { OUT1: "IN1", OUT2: "IN2", OUT3: "IN3", OUT4: "IN4" },
  "l298n-module": { OUT1: "IN1", OUT2: "IN2", OUT3: "IN3", OUT4: "IN4" },
  "tb6612fng-module": { A01: "AIN1", A02: "AIN2", B01: "BIN1", B02: "BIN2" },
};

/** The input that drives a motor lead through a driver on its net, or the lead's own net when a board pin drives it. */
function source(ctx: PartStateCtx, lead: string, direct: 0 | 1): Phase["plus"] | null {
  for (const peer of ctx.peers(lead)) {
    const input = DRIVER_INPUTS[peer.name]?.[peer.pin];
    if (input) return { ctx: peer.ctx, pin: input, on: 1 };
  }
  return ctx.net(lead) === null ? null : { ctx, pin: lead, on: direct };
}

/** Pins a sketch writes one after another this close together are one change of state. */
const SAME_CHANGE_NS = 20_000;

const wrap = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

/**
 * Turns the inputs' level changes into the rotor's electrical angle. Each phase pulls the rotor towards its own
 * direction (phase k at k x `spacing` degrees) while it carries current, so the rotor sits on the sum of the pulls.
 * Every edge since the last frame is replayed in order, so a stepper stepping faster than the frames loses no steps.
 * A jump of more than `spacing` + 45 degrees cannot be told forward from back and is not counted. Edges closer than
 * `SAME_CHANGE_NS` are one change, so writing four pins in a row is one step.
 */
function track(ctx: PartStateCtx, phases: Phase[], spacing: number): number {
  const m = ctx.memory;
  const inputs = phases.flatMap((ph, k) => [{ k, end: ph.plus, sign: 1 }, ...(ph.minus ? [{ k, end: ph.minus, sign: -1 }] : [])]);
  const after = m.seq ?? 0;
  const edges = inputs
    .flatMap((input, i) => input.end.ctx.edges(input.end.pin, after).map((edge) => ({ ...edge, i })))
    .sort((a, b) => a.seq - b.seq);
  edges.forEach((edge, n) => {
    m[`in${edge.i}`] = edge.level;
    m.seq = edge.seq;
    const next = edges[n + 1];
    if (next && next.at - edge.at < SAME_CHANGE_NS) return;
    let x = 0;
    let y = 0;
    phases.forEach((_, k) => {
      const pull = inputs.reduce((sum, input, i) => (input.k === k && (m[`in${i}`] ?? 0) === input.end.on ? sum + input.sign : sum), 0);
      x += pull * Math.cos((k * spacing * Math.PI) / 180);
      y += pull * Math.sin((k * spacing * Math.PI) / 180);
    });
    if (Math.hypot(x, y) < 1e-9) return;
    const angle = (Math.atan2(y, x) * 180) / Math.PI;
    if (m.last !== undefined) {
      const d = wrap(angle - m.last);
      if (Math.abs(d) <= spacing + 45) m.elec = (m.elec ?? 0) + d;
    }
    m.last = angle;
  });
  return m.elec ?? 0;
}

const shaft = (elecDeg: number, elecPerRev: number): number => {
  const deg = (elecDeg / elecPerRev) * 360;
  return Math.round((((deg % 360) + 360) % 360) * 10) / 10;
};

/**
 * 28BYJ-48: four coils from the red common, fired blue, pink, yellow, orange. A full step is 90 electrical degrees and
 * the 1:64 gearbox makes 2048 full steps a turn of the output shaft. Through a ULN2003 a high input pulls its coil to
 * ground; a board pin wired to a coil lead pulls current when it is low.
 */
export const stepper28byj48: PartStateProvider = (ctx) => {
  const phases = ["B", "P", "Y", "O"].map((lead) => source(ctx, lead, 0)).filter((s): s is Phase["plus"] => s !== null).map((plus) => ({ plus }));
  if (phases.length < 4) return { kind: "stepper", angle: shaft(ctx.memory.elec ?? 0, 2048 * 90), steps: 0, powered: false };
  const elec = track(ctx, phases, 90);
  const common = ctx.volts("R");
  return { kind: "stepper", angle: shaft(elec, 2048 * 90), steps: Math.round(elec / 90), powered: common === null || common >= 4 };
};

/** Microsteps a full step for MS1, MS2 and MS3, from the A4988 datasheet. */
const MICROSTEPS: Record<string, number> = { "000": 1, "100": 2, "010": 4, "110": 8, "111": 16 };

/** A4988 inputs read high when unwired: SLP has a pull-up on the carrier, and RST is taken as tied to it. EN and MS have pull-downs. */
const levelOf = (ctx: PartStateCtx, pin: string, idle: 0 | 1): 0 | 1 => {
  if (ctx.net(pin) === null) return idle;
  const s = ctx.signal(pin);
  return s?.level === 1 ? 1 : s?.level === 0 ? 0 : idle;
};

/** Steps of a NEMA 17 on an A4988: each rising STEP edge moves one microstep, the way DIR says, while the chip is awake and enabled. */
function viaA4988(ctx: PartStateCtx, driver: PartStateCtx): { elec: number; powered: boolean } {
  const m = ctx.memory;
  const micro = MICROSTEPS[`${levelOf(driver, "MS1", 0)}${levelOf(driver, "MS2", 0)}${levelOf(driver, "MS3", 0)}`] ?? 1;
  const awake = levelOf(driver, "SLP", 1) === 1 && levelOf(driver, "RST", 1) === 1 && levelOf(driver, "EN", 0) === 0;
  const motor = driver.across("VMOT", "GND2") ?? driver.across("VMOT", "GND");
  const logic = driver.across("VDD", "GND");
  const powered = (motor === null || motor >= 8) && (logic === null || logic >= 3);
  const after = m.seq ?? 0;
  const edges = [...driver.edges("STEP", after).map((e) => ({ ...e, pin: "STEP" })), ...driver.edges("DIR", after).map((e) => ({ ...e, pin: "DIR" }))].sort((a, b) => a.seq - b.seq);
  if (m.dir === undefined) m.dir = levelOf(driver, "DIR", 0);
  for (const edge of edges) {
    m.seq = edge.seq;
    if (edge.pin === "DIR") m.dir = edge.level;
    else if (edge.level === 1 && awake && powered) m.elec = (m.elec ?? 0) + ((m.dir === 1 ? 1 : -1) * 90) / micro;
  }
  return { elec: m.elec ?? 0, powered };
}

/**
 * NEMA 17, 200 full steps a turn. On an A4988 the steps come from STEP and DIR; on an H-bridge (L298N, TB6612) or
 * straight from board pins, from the inputs that set the current in coil A (black and green) and coil B (red and blue).
 */
export const nema17: PartStateProvider = (ctx) => {
  const a4988 = ["BLK", "GRN", "RED", "BLU"].flatMap((lead) => ctx.peers(lead)).find((peer) => peer.name === "a4988-module");
  if (a4988) {
    const { elec, powered } = viaA4988(ctx, a4988.ctx);
    return { kind: "stepper", angle: shaft(elec, 200 * 90), steps: Math.round(elec / 90), powered };
  }
  const coil = (plus: string, minus: string): Phase | null => {
    const p = source(ctx, plus, 1);
    const n = source(ctx, minus, 1);
    return p && n ? { plus: p, minus: n } : null;
  };
  const phases = [coil("BLK", "GRN"), coil("RED", "BLU")];
  if (phases.some((ph) => ph === null)) return { kind: "stepper", angle: shaft(ctx.memory.elec ?? 0, 200 * 90), steps: 0, powered: false };
  const elec = track(ctx, phases as Phase[], 90);
  return { kind: "stepper", angle: shaft(elec, 200 * 90), steps: Math.round(elec / 90), powered: true };
};

/** A driver shows nothing of its own; it is listed so the motor on its outputs can find it and read its inputs. */
export const driverOnly: PartStateProvider = () => null;
