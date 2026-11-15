/**
 * Every item model by kind. A new item is one `defineItem` in `items/` and one line here, plus its notes in
 * `catalogue.ts` (the test fails when a kind has no notes or a mistake no say-text).
 */
import { beaker, burner, flameTestKit, flask, phMeter } from './items/chemistry';
import { solderingStation, supply } from './items/electrical';
import { GENERIC_KIND, generic } from './items/generic';
import { elementSample } from './items/element';
import { pendulum } from './items/physics';
import { generator, scope } from './items/signals';
import type { ItemModel } from './types';

export const MODELS: Readonly<Record<string, ItemModel>> = Object.fromEntries(
  [beaker, flask, burner, flameTestKit, phMeter, supply, solderingStation, pendulum, generator, scope, elementSample, generic].map((m) => [m.kind, m]),
);

/** Kinds with a real model (not the stand-in). */
export const KINDS: readonly string[] = Object.keys(MODELS).filter((k) => k !== GENERIC_KIND && k !== elementSample.kind);

/** The model for a kind; the generic stand-in for one it does not know. */
export const modelOf = (kind: string): ItemModel => MODELS[kind] ?? MODELS[GENERIC_KIND]!;
