/**
 * Part views: how a placed part's mesh reacts to the simulation. One view per placed part; the run pillar feeds it
 * `PartState` from each frame and the analog latch when the fault lab watches it. Contract file: changes only in its
 * own PR (label `contract-change`).
 *
 * Implementation: `xr/src/run/views/registry.ts` (`createPartViewRegistry`), with `led.ts` as the first view.
 * Views must not allocate per frame and must not read the document or the sim directly.
 */
import type { Object3D } from '@iwsdk/core';
import type { PartState } from '@/sim/engine';
import type { Anchor, PartAsset } from './assets';

export type { PartState };

/** The solver's latch for one part: `ok`, running `hot`, `burnt` (stays until reset), or `reversed` (wrong way round). */
export type PartHealth = 'ok' | 'hot' | 'burnt' | 'reversed';

export interface PartViewContext {
  /** Entity id (`cmp_led1`) and its designator (`LED1`). */
  readonly partId: string;
  readonly refdes: string;
  /** Descriptor ref and version (`core.led-5mm`, `1.0.0`). */
  readonly ref: string;
  readonly version: string;
  /** Resolved component params (`color`, `ohms`), parameter references already looked up. */
  readonly params: Readonly<Record<string, unknown>>;
  readonly asset: PartAsset;
  /** The placed instance (`asset.instantiate()`), already in the bench. The view animates inside it. */
  readonly object: Object3D;
  /** An anchor by id or alias (`A`, `led:LED`). */
  anchor(id: string): Anchor | undefined;
}

export interface PartView {
  readonly partId: string;
  /** A frame carried this part's state. */
  update(state: PartState): void;
  /** The analog latch changed (only while the fault lab or an overlay watches analog). */
  health?(health: PartHealth, watts: number): void;
  /** Called every render frame while running, for smooth motion between sim frames (servo sweep, prop spin). */
  tick?(dtSeconds: number): void;
  /** The run stopped: back to the unpowered look. */
  reset(): void;
  dispose(): void;
}

export type PartViewFactory = (ctx: PartViewContext) => PartView;

export interface PartViewRegistry {
  /** Registers a factory for a descriptor ref (`core.led-5mm`) or, as a fallback, a readout kind (`led`). */
  register(key: { ref: string } | { kind: PartState['kind'] }, factory: PartViewFactory): void;
  /** The view for a placed part: by ref, then by the kind its first state reports, then a no-op view. */
  create(ctx: PartViewContext, firstState?: PartState): PartView;
}
