import type { SimTime } from "../core/clock.ts";
import type { PartHealth } from "../analog/health.ts";
import type { NetEdge, PartState, PinSignal, SimPart } from "../engine.ts";

/** What a provider returns: the `PartState` it means, without the part id (the hub adds it). */
export type PartStateBody = PartState extends infer S ? (S extends unknown ? Omit<S, "part"> : never) : never;

/** Another part with a provider that has a pin on the same net, and what the run knows about it. */
export interface PartPeer {
  /** The peer's catalogue name. */
  name: string;
  /** The peer's pin that sits on the net. */
  pin: string;
  ctx: PartStateCtx;
}

/** What the run knows about one part, read when a frame is built. A value the run cannot give is `null`. */
export interface PartStateCtx {
  readonly part: SimPart;
  readonly at: SimTime;
  /** Numbers that live as long as the run, for a provider that integrates over time. */
  readonly memory: Record<string, number | undefined>;
  /** The net a pin of the part is on. */
  net(pin: string): string | null;
  /** What the pins driving the net of `pin` have been doing: level, PWM duty and rate, servo pulse, edge times. */
  signal(pin: string): PinSignal | null;
  /** Every level change of the pins driving the net of `pin` after edge number `after` (0 for all), with edge times; keep the last `seq` to read on from there. Empty with no board pin on the net. */
  edges(pin: string, after: number): NetEdge[];
  /** The other parts with a provider on the net of `pin`, to read a driver's inputs or a motor's driver. */
  peers(pin: string): PartPeer[];
  /** Volts on a pin's net against ground, from the live solver. */
  volts(pin: string): number | null;
  across(plus: string, minus: string): number | null;
  /** Amps the solver measures through one of the part's elements (its own id unless the part builds several), positive from the first node to the second. */
  amps(element?: string): number | null;
  /** Shaft speed in rpm of one of the part's motor elements (its own id by default), signed; null with no solver. */
  rpm(element?: string): number | null;
  /** Amps into the part through a pin. */
  pinAmps(pin: string): number | null;
  health(): PartHealth | null;
  /** The display the program drives, if it drives one. */
  display(): DisplayView | null;
}

export type PartStateProvider = (ctx: PartStateCtx) => PartStateBody | null;

/** What a program has put on a pixel display it drives over a bus. */
export type DisplayView = Omit<Extract<PartState, { kind: "display" }>, "part" | "kind">;

/** A PWM chip the program drives over a bus, such as a PCA9685: its rate and the duty of each channel. */
export interface PwmDriver {
  readonly hz: number;
  duty(channel: number): number;
}

/** Provider by catalogue name: the descriptor id without `core.` and the version, as `catalogueName` gives it. */
export type ProviderTable = Readonly<Partial<Record<string, PartStateProvider>>>;
