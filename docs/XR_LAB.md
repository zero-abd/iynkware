# XR lab (pillar 8)

Updated 2026-11-14. Training labs beyond circuits: a person picks a lab (chemistry, physics, electrical, signals and
systems) from Home or the menu, the bench is set with that lab's equipment, they move and work it by hand, a tutor
instructs and corrects them live, and an exam mode scores a run without hints. Code: `xr/src/lab/`. Tests:
`xr/test/lab/`. Emulator walk: `xr/scripts/lab-check.mjs`.

## 1. Pieces

```
xr/src/lab/
  text.ts            L6 (text in six languages), fill, say, l6Problems (the strings test)
  context.ts         LabContext per app: store, runner, tutor, feed, inventory; open(lab), leave(), start(), request()
  model/             pure TypeScript, no three.js
    types.ts         ItemModel, defineItem, LabAction, Refusal, LabEnv
    items/*.ts       the item models (ported from figures/lab/*.js, plus the new ones)
    store.ts         LabStore: placed items, apply, step, answers, undo, subscribe
    catalogue.ts     tutor notes per kind (name, summary, safe use, hazards, mistakes with severity), refusals
    inventory.ts     LabInventory: kinds, request(kindOrName) -> found | the generic stand-in
  experiments/       Experiment data, the runner (steps, checks, exam log, score), the lab panel and shell rows
  tutor/             the deterministic tutor and its feed (subscribe, snapshot); nothing drawn over items
  items/             drawing and working the items: controls, channels, primitives, the glTF source
  kit/               the lab panel (canvas, look kit) and its words
```

Lab items are **not project components**: no part descriptor exists for them and `XrApp` has no hook to add one, so
their state lives in the lab's own `LabStore`. Opening a lab hides the circuit bench (`bench.root`, also from
pointers) and leaving restores it; the project document is never touched.

`XrApp` has no lab service yet. Sub-modules find the context with `labOf(app.world)`; `window.iynkware.lab` points at
it too (emulator scripts, DevTools). A contract change could add `XrApp.lab`.

## 2. Item model

```ts
interface ItemModel {
  kind; lab; foot: [w, d, h] /* mm */; params; defaults; actions; mistakes;
  init(params?, seed?): ItemState;                  // { p: params, s: own clock state }
  apply(state, action, env): ItemState | Refusal;   // pure; `{ type: 'set', key, value }` always accepted
  step(state, dtMs, env): boolean;                  // mutates s in place, no allocation; true when the report changed
  live(state): boolean; mistake(state, env): string | null; report(state, env): Report;
}
```

`env.stateOf(kind)` lets an item read the bench (the loop needs the burner's flame, the pH probe the beaker, the scope
the generator). A new item is one `defineItem` in `model/items/`, one line in `registry.ts`, its notes in
`catalogue.ts`, its controls in `items/controls.ts` and a primitive builder; the tests fail when notes are missing.

| Kind | Source | Mistakes |
|---|---|---|
| `beaker-250`, `erlenmeyer-250`, `bunsen-burner`, `bench-power-supply`, `pendulum-stand`, `soldering-station` | ported from `figures/lab/*.js` (same params, actions, clock, mistake order) | the figures' |
| `flame-test-kit` | new: nichrome loop, acid, Li Na K Ca Cu Sr Ba dishes and a seeded unknown | `loop-no-flame`, `luminous-flame`, `dirty-loop` |
| `ph-meter` | new: reads the beaker's liquid; carry-over when not rinsed, offset until calibrated | `ph-not-rinsed`, `ph-not-calibrated` |
| `function-generator`, `oscilloscope` | new: 10 x 8 division screen, readable window, Measure | `scope-clipped`, `timebase-too-fast`, `timebase-too-slow` |
| `generic` | the stand-in box for anything else | none |

Added to ported items for the experiments: the supply's `unknown` load and `record`, the pendulum's `record`.

## 3. Experiments and exam

An `Experiment` is `{ id, lab, title, goal, kit, steps[{ id, text, hint, focus, ask?, done(ctx) }], checks[{ id, label,
pass(ctx), detail?(ctx) }], hazards }`. The runner lays out the kit (seeded), advances when a step's predicate holds,
logs every mistake (with its severity), refused action, answer and hint with the lab clock time and the step, and
builds a `ResultSheet` (checks, counts, score, log). Score: checks passed out of 100, less 5 per safety mistake
(severity `hazard` or `escalate`), 2 per refused action, 3 per hint in practice. In an exam, hints are refused and the
tutor is silent except for hazards.

| Lab | Experiment | Checks |
|---|---|---|
| chemistry | `chemistry/flame-test`: light safely, blue flame, clean the loop, dip the unknown, read the colour, name the metal, gas off | metal, safe light, clean loop, blue flame, gas off |
| chemistry | `chemistry/ph`: on, buffer, calibrate, rinse, sample, acidic/neutral/alkaline, store | answer, calibrated, rinsed, stored |
| electrical | `electrical/ohms-law`: limit 0.5 A, 5 V, on, two readings, R = V / I, CC lesson, off | R, readings agree, saw CC, nothing overloaded, off |
| physics | `physics/pendulum`: small angle, 10 swings, record, second length, record, g | two lengths, T = 2π√(L/g), small angle, g |
| signals | `signals/measure-wave`: generator on, probe, scope on, timebase, volts/div, Measure, Vpp, f | Vpp, f, readable |

## 4. Tutor and the feed for a model-backed tutor

The tutor (`tutor/tutor.ts`) emits `TutorEvent { seq, kind: 'instruct'|'praise'|'warn'|'hazard'|'hint', equipmentId,
itemKind, mistakeId?, experimentId?, stepId?, text: LocalizedText (all six), at }`. Pacing: a mistake is said once
when it starts, again every 12 s while it lasts; `escalate` mistakes (gas on and unlit, an overloaded resistor, the
iron left out) become hazards after 5 s more; a hint after 25 s stuck on a step (practice). Mistakes are checked every
200 ms. The headset draws no pop-ups for them: the lab panel shows the latest step, praise or hint line, and warnings,
hazards and refusals go to the companion's coach as observations, for the AI to comment on when asked.

A voice or model-backed tutor (issue #2) uses `labOf(world).feed` (or `window.iynkware.lab.feed`), and calls no
network itself:

```ts
feed.subscribe((e: TutorEvent) => ...);   // every event, as the headset tutor says it
feed.snapshot(lang?) : LabSnapshot;       // compact JSON, text in `lang`
```

```jsonc
{
  "schema": "iynkware.lab-snapshot/1",
  "at": 12850,                         // lab clock, ms
  "lang": "en",
  "lab": { "id": "chemistry", "name": "Chemistry lab" },          // or null
  "experiment": {                                                   // or null
    "id": "chemistry/flame-test", "title": "Flame test", "goal": "...", "mode": "practice",
    "step": { "id": "light", "index": 0, "of": 7, "text": "...", "hint": "..." },   // hint null in an exam
    "done": false, "answers": { "salt": "Sr" }, "score": null
  },
  "items": [
    { "id": "lab_bunsen-burner_1", "kind": "bunsen-burner", "name": "Bunsen burner",
      "pose": { "x": 70, "z": -90, "yaw": 0 },                     // mm on the bench table, degrees
      "report": { "collar": "closed", "gasOn": true, "lit": false, "flame": "none", "gasUnlitS": 2 },
      "mistake": "gas-unlit" }                                      // "placeholder": true on a stand-in
  ],
  "mistakes": [ { "itemId": "...", "kind": "bunsen-burner", "mistakeId": "gas-unlit", "severity": "escalate",
                  "sinceMs": 1148, "say": "Gas is on but not lit. ..." } ],
  "notes": { "bunsen-burner": { "name": "...", "summary": "...", "safeUse": ["..."], "hazards": ["..."],
             "mistakes": { "gas-unlit": { "when": "...", "say": "...", "severity": "escalate" } } } },
  "recent": [ { "kind": "warn", "text": "...", "at": 12010, "itemKind": "bunsen-burner", "mistakeId": "gas-unlit" } ]
}
```

`when` is English (a condition for a model, not shown). Asking for equipment the lab lacks:
`labOf(world).request('fume hood')` places the generic stand-in and returns `{ found: false, kind: 'generic', name,
generated: false, placeholder: true, id }`, so an assistant can say it is a stand-in.

## 5. Drawing and input

`ItemVisualSource` draws an item: the converted `lab/<kind>.glb` with its sidecar when `./xr-assets/index.json` lists
it (loaded with the assets registry's `pageFolder`, `parseIndex` and the pipeline's `createXrAsset`), else primitives
in the look kit's ink style. Both are driven by the same channel ids from `items/channels.ts` (the figures' `turn:*`,
`led:*`, `flame:*`, `swing:*`, `press:*`, plus lab-only `text:*`, `level:*`, `tint:*`). Each item is grabbed through
an invisible box over its foot (`app.input.bind`, grab `both`); the drawn item follows with damping, turns only about
up, and settles upright on the bench top on release (`store.move`). Controls are hit boxes (ray and poke; a knob has a
down and an up half) that send one store action each. Loose parts are held apart from their item (`items/hands.ts`): the pendulum's bob
has its own grab box (the stand stays put) and, let go, swings from that angle through the stand's `release`; the
chemistry lab's spatula, carried, scoops from a solid dish or element jar (`scoop`) and tips into a beaker or flask
(the vessel's `add`, recorded, no reaction yet). Callouts are the look kit's `createCallout`, because
`app.overlay` targets are `BoardTarget`s and cannot name lab items.
