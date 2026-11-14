# Part state in a run

What a part shows on the canvas while a Studio run is going, and how to give a part something to show.

## The path

```
worker                                                     main thread
------                                                     -----------
digital layer  ──┐
(pins, PWM,      ├─> part state hub ─> frame.parts ─> derivePartStates ─> stateOverlays ─> canvas
 edge times)     │   (providers)       PartState[]    PartVisualState     tags and marks
live solver  ────┘
(volts, amps)
```

`sendFrame` in `src/sim-host/handler.ts` asks the hub for the state of every part that has a provider and adds it to
the frame. A part with no provider keeps what the digital layer says (LED, buzzer, button) or the `not-modelled` tag.
A provider's entry replaces the digital layer's entry for the same part.

## The kinds

Worker side, `PartState` in `src/sim/engine.ts`. Main side, `PartVisualState` in `src/studio/engine/part-state.ts` (same
fields, without the id and the provenance).

| kind | fields | drawn as |
| --- | --- | --- |
| `servo` | `angle` (0 to 180 degrees), `powered` | arm on a half dial, tag `135°` |
| `motor` | `rpm` (signed: negative turns the other way), `stalled`, `powered` | spin arrow, flipped for reverse; ring when stalled; tag `3200 rpm` |
| `stepper` | `angle` (degrees, 0 is up, clockwise), `steps`, `powered` | shaft mark on a ring, tag `90° · 512 steps` |
| `reading` | `value`, `unit`, `label` | tag `dist 23.4 cm` (three significant digits; the label may be empty) |

Not powered is its own tag (`no power`) for servo, motor and stepper, and a stalled motor says `stalled`. A reading has no
health of its own: if the sensor is off, do not return a state, or return the value the part would read.

A part that reports one of these kinds is never tagged "not modelled yet", whatever its descriptor status says
(`derivePartStates` checks the entry first). An entry with a missing or non-finite number is ignored.

Prefer a new part over a new kind. If a part's state is a number with a unit, it is a `reading`. A new kind needs a
`PartState` arm, a `PartVisualState` arm, a branch in `reported` (`part-state.ts`), a tag and a mark in
`src/studio/overlays/state.ts` and keys in all six `studioRun.json` files.

## Adding a provider

One new file in `src/sim/part-state/`, plus its import and its line in `src/sim/part-state/index.ts`. Nothing else in the
core changes. The key is the catalogue name: the descriptor id without `core.` and the version (`core.servo-sg90@1.0.0`
is `servo-sg90`). A provider is a function of one context and returns the state without the part id, or `null` to leave
the part to the digital layer:

```ts
// src/sim/part-state/servo-sg90.ts (shortened)
export const servoSg90: PartStateProvider = (ctx) => {
  const supply = ctx.across("VPLUS", "GND");              // solver volts; null with no solver
  const powered = supply !== null && supply >= 4;
  const signal = ctx.signal("SIG");                        // pin activity: servoUs, highNs, lastRiseAt, ...
  const us = signal?.servoUs ?? (signal?.highNs ? signal.highNs / 1000 : null);
  const held = ctx.memory.angle ?? 90;                     // memory lives as long as the run
  const angle = powered && us !== null ? degOf(us) : held;
  ctx.memory.angle = angle;
  return { kind: "servo", angle, powered };
};
```

```ts
// src/sim/part-state/index.ts
import { servoSg90 } from "./servo-sg90.ts";
export const PROVIDERS: ProviderTable = {
  "servo-sg90": servoSg90,
};
```

`PartStateCtx` (`src/sim/part-state/types.ts`). Pins are the descriptor's pin ids. Anything the run cannot give is `null`.

| member | gives |
| --- | --- |
| `part` | the `SimPart`: id, descriptor, `params` (with defaults), `pins` (pin id to net id) |
| `at` | simulated time in ns |
| `memory` | numbers that live as long as the run, one object per part |
| `net(pin)` | the net a pin is on |
| `signal(pin)` | `PinSignal` of the pins driving that net: `level`, `duty`, `hz`, `servoUs`, `highNs`, `periodNs`, `lastRiseAt`, `lastEdgeAt` |
| `volts(pin)`, `across(plus, minus)` | solver volts against ground, and between two pins |
| `amps(element?)`, `pinAmps(pin)` | solver amps through one of the part's elements (its own id by default), and into a pin |
| `health()` | the solver's verdict on the part: `ok`, `hot`, `reversed`, `burnt` |

`signal` has two sources. The interpreter reports `servoUs`, `duty` and `hz` as values. A firmware engine (avr8js,
rp2040js) only moves levels, so `highNs`, `periodNs` and the edge times are measured from the edge timestamps; a provider
that reads a pulse should handle both, as the servo does. Both arrive through `DigitalLayer.onPin` (`src/sim/digital/nets.ts`).

Rules:

- The solver already knows the circuit; read volts and amps from it and do not recompute them. If the part needs a load
  the solver does not stamp yet, say so in the descriptor's `known_gaps`.
- A provider runs on every frame (at most 30 a second of simulated time). Keep it cheap and keep time-dependent state in
  `ctx.memory`, using `ctx.at` for the step.
- Round what you return (angles to 0.1 degree, rpm to whole numbers): a frame is only sent when the parts changed.
- A provider that throws is skipped for that frame; the run goes on. Tests catch it, so write them.
- Test the provider alone with `ctxOf` from `src/sim/part-state/testing.ts`, and once end to end with a worker run
  (`src/sim-host/part-state-run.test.ts` builds an Uno, a servo and a motor with `actuatorCircuit`).

## The badge rule

`simulation.status` in a part's descriptor is `modelled` when the part does its main job in the circuit in a Studio run and a
test proves it. Its limits stay listed in `not_modelled` and `known_gaps`; a gap goes only when it is truly closed.
`partly-modelled` is a part whose main job does not work yet, and `not-modelled-yet` has no model. A part with a provider
and a test but a missing main behaviour is `partly-modelled`.

Done so far: `servo-sg90` and `dc-motor` (both `modelled`).
