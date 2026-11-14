/**
 * What the bench's sub-modules share inside the pillar, one per app: feedback (core/feedback.ts) and the carry hub,
 * the hand-over from the shelf (a part pulled off a bin) to the edit module (ghost, snap, seat). Sub-modules still talk
 * to other pillars only through `XrApp`; this is bench-internal.
 */
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe, Vec3 } from '../../contracts/common';
import type { InteractionEvent } from '../../contracts/input';
import { createBenchFeedback, type BenchFeedback } from './feedback';

/** A new part, pulled off the shelf and still held by the press that pulled it. */
export interface NewPartCarry {
  readonly ref: string;
  readonly version: string;
  /** The press that holds it, as the shelf's binding reported it (`grab-start` or `select-start`). */
  readonly start: InteractionEvent;
  /** World position of the bin item when it was pulled, for a smooth hand-over. */
  readonly from: Vec3;
  /** The carry ended without placing the part (released off the mat or cancelled): the shelf shows it again. */
  onReturn(): void;
}

/** A carry in progress. The shelf forwards its press's events until the press ends. */
export interface Carry {
  /** `grab-move` or `drag-move` of the press. */
  move(e: InteractionEvent): void;
  /** `grab-end` or `select-end` of the press: seat, lie on the mat, or go back. */
  end(e: InteractionEvent): void;
  /** Tracking lost or the module tears down: the part goes back. */
  cancel(): void;
}

export interface CarryHub {
  /** The edit module provides carrying; the last provider wins. */
  provide(handler: (req: NewPartCarry) => Carry): Unsubscribe;
  /** Starts carrying a new part, or null when nothing provides carrying (the shelf then places it itself). */
  begin(req: NewPartCarry): Carry | null;
}

export interface BenchKit {
  readonly feedback: BenchFeedback;
  readonly carry: CarryHub;
}

function createCarryHub(): CarryHub {
  const handlers: Array<(req: NewPartCarry) => Carry> = [];
  return {
    provide(handler) {
      handlers.push(handler);
      return () => {
        const i = handlers.lastIndexOf(handler);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
    begin(req) {
      const h = handlers[handlers.length - 1];
      return h ? h(req) : null;
    },
  };
}

const kits = new WeakMap<object, BenchKit>();

/** The bench kit for `app`, made on first use. */
export function benchKit(app: XrApp): BenchKit {
  let kit = kits.get(app);
  if (!kit) {
    kit = { feedback: createBenchFeedback(app), carry: createCarryHub() };
    kits.set(app, kit);
  }
  return kit;
}
