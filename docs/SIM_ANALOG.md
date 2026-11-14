# SIM_ANALOG: the analog contract

Status: living. Written by the contract commit of the analog wave; each builder updates the section it owns in the
same commit that changes the shape. Design source: `docs/MASTER_PLAN/04_ARCHITECTURE/SIMULATION_ARCHITECTURE.md`
sections 7.2 to 7.4 and `ADR/ADR-0304-circuit-solver-keep-and-extract.md`.

Goal of the wave: a student builds an RC circuit, a 555 blinker, an op-amp amplifier and a smoothed rectifier in
Studio, runs it, and sees real voltages, currents and waveforms, with parts that burn out when abused.

The contract commit was types, protocol shapes and stubs. All seven builders have landed and the merge joined them (section 12
says how the pieces fit): the live solver steps circuits with capacitors, inductors, sources, op-amps and 555 timers through
time, frames carry `analog`, the instruments drive and read the solver, the flow lens draws the frames, and the five starters
run. A change to a shape still edits this file in the same commit and says so in the commit message.

## 1. Builders and what each owns

| Builder | Owns | Sections |
|---|---|---|
| `transient` | Capacitor, inductor and waveform source stamps; trapezoidal and backward Euler stepping; `analog.mode: 'transient'` in the orchestrator and `live.ts`; `SimSettings.analog` read from the project; `AnalogBackend.capabilities.transient` | 2, 3 |
| `livewire` | Running the live analog solver inside the worker; building `AnalogFrame` (watch, deltas, waves, caps) and the page store that holds the last frame | 5 |
| `analogparts` | Op-amp and 555 stamps, Zener behaviour, failure and health rules for the new parts, the part descriptors (capacitor, inductor, LM358, NE555, Zener) and their `LAYER_SPECS` entries | 2, 4, 5 (`parts`) |
| `instruments` | Function generator and bench supply: the instruments' UI and project kinds, the page side of `instrument.set`, the solver side of `Change { kind: 'instrument' }`, the PSU reading | 6 |
| `flowlens` | The canvas overlay that draws voltage, current direction and magnitude and part health from `AnalogFrame` | 5 (reader) |
| `canvasplus` | Run-time part inputs from the canvas: the page side of `setInput`, resolving a part param to element changes; the slide switch part; the `net.set` op | 8 |
| `fpgaports` | Verilog port mapping: carrying `ports` from the lesson or board into the run and back to board pins | 9 |

Files with more than one writer, and the rule for each:

| File | Rule |
|---|---|
| `src/sim/analog/newton.ts`, `solve.ts` | `transient` only. Others add a device file and one registry line instead. |
| `src/sim/analog/devices/index.ts` | One registry line per builder (`transient`: C, L, VW; `analogparts`: OA, TMR). A rebase conflict here is two added lines: keep both. |
| `src/sim/analog/live.ts` | `transient` for the stepping; `livewire` for reads; `instruments` for the `instrument` case in `applyOne`; `analogparts` and `canvasplus` for `LAYER_SPECS`, `SPECS`. Keep edits inside your own switch case or table row. |
| `src/sim/models/kinds.ts` `SOLVER_ELEMENTS` | Add the descriptor names of the elements you made modelled: `transient` capacitor, inductor, waveform_source; `analogparts` opamp, timer_555, zener. |
| `src/sim/analog/elements.ts` `UNMODELLED_KINDS` | Remove a kind from it in the commit that gives it a stamp, with its test. |
| `src/sim-host/analog-protocol.ts` | Shape changes only with this file; `livewire` is the arbiter. |
| `src/project/*` schema | Only `instruments` (new `Instrument` kinds). Regenerate with `npm run schema:gen`. `canvasplus` added one op, `net.set { id, class }` (a class, or `null` to clear it), so a wire to a supply or ground pin can set the net class and undo it exactly; a rebase conflict in `generated/` is solved by running `npm run schema:gen` again. |

Merge order for the wave: `transient`, `analogparts`, `livewire`, then `instruments`, `flowlens`, `canvasplus`,
`fpgaports`. `instruments` needs `VW` for the function generator and `livewire` for readings; it builds against the
types and tests the supply (a `V` with a limit) before they land.

## 2. Elements (`src/sim/analog/types.ts`)

Node numbers, `ElementBase { id, rating? }` and unit-suffixed field names as for the existing elements. Node 0 is the
ground the solve was given. Current through a two-terminal element is positive from `a` to `b`.

| Kind | Fields | Notes |
|---|---|---|
| `C` | `a, b, farads, esrOhms, v0?, polarized, ratedVolts?` | `a` is the positive lead when polarized. A polarized part with `v` below zero is `reversed`; `v` above `ratedVolts` burns it. `v0` absent: start from the operating point. |
| `L` | `a, b, henries, dcrOhms, i0?, ratedAmps?` | Current above `ratedAmps` burns it. |
| `VW` | `a, b, shape, amplitudeV, offsetV, hz, duty, phaseDeg, rSeriesOhms, limit?` | `shape` is `sine`, `square`, `triangle` or `pulse`. Sine, triangle and square swing `offsetV` plus and minus `amplitudeV` (a peak) and start at the offset rising; square is half high. Pulse sits at `offsetV` and rises to `offsetV + amplitudeV` for the fraction `duty`. `limit` droops the source like `V`. With no time base (`dc-event`) it holds its value at phase 0. The one evaluation is `waveValue(wave, tSeconds)` in `waveform.ts`; use it, do not write another. |
| `OA` | `inP, inN, out, vcc, vee, openLoopGain, gbwHz, slewVPerUs, rOutOhms, headroomVolts, headroomLowVolts?` | A macro model: gain `openLoopGain` at DC with one pole at `gbwHz / openLoopGain`, then a smooth clamp that holds the output `headroomVolts` inside the positive rail and `headroomLowVolts` (the same when absent; 20 mV for the LM358) inside the negative one, and the output rate limited to `slewVPerUs`. The pole comes before the clamp and its state is held within three clamp widths, so a closed loop leaves saturation as fast as the loop allows. Reports `sat` when clipped, `active` otherwise. `vee` is the ground node for a single supply. |
| `TMR` | `gnd, trig, out, reset, ctrl, thr, dis, vcc, rOutOhms, highDropVolts, disOnOhms, quiescentAmps` | The bipolar 555. Thresholds are two thirds and one third of `ctrl`, which is `vcc` when `ctrl` floats. Trigger below one third sets the latch (out high, discharge off); threshold above two thirds resets it (out low, discharge on); `reset` low forces out low. Out high sits `highDropVolts` below `vcc`. State is `on` (out high) or `off`. |
| `D` (Zener) | no new kind | `junction: { kind: 'shockley', isAmps, n, rsOhms, rzOhms?, vbrVolts }` already has the breakdown voltage, as a positive number. It is the junction's parameter, not the quoted Zener voltage: the curve is exponential, so `vbrVolts` is set about 1 V under the quoted voltage, which a sheet measures at its test current (4.06 V for a 1N4733A that holds 5.1 V at 49 mA). The `zener` descriptor layer maps `vz_volts` onto it. `rating.pmaxWatts` is its power limit. Only `mode: 'newton'` models the breakdown; the `pwl` diode never conducts in reverse. |

`Element` is the union of all of them and the exhaustive switches (`nodesOf` in `solve.ts` and `live.ts`,
`measureElement`) cover the new kinds. `DeviceState` is unchanged.

`isModelled` stays false for `C`, `L`, `VW`, `OA` and `TMR`: the piecewise linear solver (`mode: 'pwl'`) drops them with a
`not-modelled-yet` diagnostic, exactly as it drops an unmodelled PNP. The Newton solver models all five, and the live solver sends
every circuit that holds one to it (section 12).

## 3. Solver options, transient step and backend

`AnalogOptions { mode: 'dc-event' | 'transient'; stepNs? }` (in `types.ts`) is `SimSettings.analog`. The default is
`{ mode: 'dc-event' }`, which is today's behaviour; `stepNs` is there only when the project names one. The project document carries it in
`simulation.solver.options` (`mode`, `stepNs`); that object is open (32 properties), so the schema needs no change and
no migration. `buildSimNetlist` reads it into `SimNetlist.settings.analog`; a project with a `function-generator` instrument is
transient whatever it says, on a step of 10 microseconds when it names none (`GENERATOR_STEP_NS`). A transient run with no `stepNs` takes
the step `autoStepNs` (`sim/analog/step.ts`) sizes from the circuit: a fiftieth of the smallest time constant a capacitor or
inductor has (`RC`, `L/R`, with R the least resistance from the part along resistors and diodes to a supply, a generator or an
output pin, that source's own resistance included; with no source in the circuit, as when a bench supply is put on at run time, the smallest resistor on the part), a hundredth of the period of a waveform source, on the 1, 2, 5 ladder,
between 10 microseconds and 1 millisecond (100 000 steps per simulated second is what a page follows at real time); with nothing to
size it by, 100 microseconds. A `stepNs` the project names is cut to a hundredth of the period of the fastest waveform source
(`clockStepNs`), so a generator added to a starter that steps every millisecond is not caught at the same point of its period
every step. `LoadReport.stepNs` is the step the solver took, and the orchestrator ticks on it.

```ts
type IntegrationMethod = 'trapezoidal' | 'backward-euler';
type ElementMemory =
  | { kind: 'C'; v: number; i: number }   // volts and amps a to b
  | { kind: 'L'; v: number; i: number }
  | { kind: 'OA'; vOut: number }          // output after slew limiting
  | { kind: 'TMR'; q: 0 | 1 };            // the latch
type TransientMemory = Record<ElementId, ElementMemory>;
interface TransientStep { tSeconds: number; hSeconds: number; method: IntegrationMethod; prev: TransientMemory }
```

- `SolveInput.transient?: TransientStep`. Absent, the solve is an operating point. `SolveResult.memory?` is what the
  next step passes back as `prev`.
- Trapezoidal everywhere except the first step, the step after a discontinuity (an input edge, a switch, a source
  change) and a ringing detection, which use backward Euler (SIMULATION 7.4). An event between grid steps takes a short
  backward Euler step to the event time, applies the change, and returns to the grid.
- `NewtonDevice.stamp` takes `step?` and `NewtonDevice.memory?` returns what the element carries on. `C`, `L` and the
  transient part of `VW` are devices registered in `devices/index.ts`.
- `inhouseBackend(live)` in `backend.ts` wraps the live solver as the `AnalogBackend` of SIMULATION 7.4:
  `kind`, `capabilities { transient, coSimulate, interactive }`, `prepare(net, o, layers?)`, `advanceTo(t, changes)`.
  It reports `transient: true`: the live solver steps a circuit when its netlist settings ask for `transient`.
- Accuracy gate for this builder: RC, RLC and a rectifier-with-capacitor against the analytic answer or the checked-in
  ngspice fixtures to 1 percent at the default step, and the existing equivalence and oracle tests unchanged.

## 4. Descriptor element layers (`src/sim/analog/layers.ts`)

A part reaches the solver through an `element` layer of its descriptor. The component schema's `elementKind` now also
holds `waveform_source` and `timer_555` (`capacitor`, `inductor`, `zener` and `opamp` were already there). `ANALOG_LAYERS`
is the table: descriptor terminal name to the element's node field, descriptor param key to the element field. Param
keys are the snake case of the field (`esrOhms` is `esr_ohms`); the Zener maps its flat params into `junction`.

| Layer kind | Element | Terminals (descriptor name: element field) | Params |
|---|---|---|---|
| `capacitor` | `C` | `a: a`, `b: b` | `farads`, `esr_ohms`, `v0_volts`, `polarized`, `rated_volts` |
| `inductor` | `L` | `a: a`, `b: b` | `henries`, `dcr_ohms`, `i0_amps`, `rated_amps` |
| `waveform_source` | `VW` | `pos: a`, `neg: b` | `shape`, `amplitude_v`, `offset_v`, `hz`, `duty`, `phase_deg`, `r_series_ohms`, `limit_amps` |
| `zener` | `D` | `anode: a`, `cathode: b` | `vz_volts`, `is_amps`, `n`, `rs_ohms` (the slope in breakdown, `junction.rzOhms`), `imax_amps`, `pmax_watts` |
| `opamp` | `OA` | `inp: inP`, `inn: inN`, `out`, `vcc`, `vee` | `open_loop_gain`, `gbw_hz`, `slew_v_per_us`, `r_out_ohms`, `headroom_volts`, `headroom_low_volts`, `supply_max_volts`, `output_max_amps` |
| `timer_555` | `TMR` | `gnd`, `trig`, `out`, `reset`, `ctrl`, `thr`, `dis`, `vcc` | `r_out_ohms`, `high_drop_volts`, `dis_on_ohms`, `quiescent_amps`, `supply_max_volts`, `output_max_amps` |

The five parts of the wave map onto these: capacitor (`capacitor`, electrolytic sets `polarized`), inductor
(`inductor`), LM358 (`opamp`, two layers for the two amplifiers sharing `vcc` and `vee`), NE555 (`timer_555`), Zener
(`zener`). A layer whose kind is not in `SOLVER_ELEMENTS` of `models/kinds.ts` resolves to `none` with
`solver-lacks-element` and the part shows "not modelled yet"; `analogparts` and `transient` add the names there as the
stamps land. Part descriptors cite their datasheet figures in `source` like every other descriptor.

### Parts and starters that use these layers (`analogparts`)

Descriptors in `src/parts/data/`, each with a figure page (`figures/parts/<id>.js`), flat Studio art (`scripts/extract-part-art.mjs`)
and its datasheet figures in `docs/facts/analog-parts.md`. All sit at tier `T0`, `partly-modelled`, until the solver
has a stamp for their element and a test shows its numbers; then the tier and the entry in `SOLVER_ELEMENTS` move together.

| Part | Layer | Pins | Instance parameters read by name |
|---|---|---|---|
| `core.capacitor-ceramic` | `capacitor` | P1, P2 | `farads` |
| `core.capacitor-electrolytic` | `capacitor`, polarised | PLUS, MINUS | `farads`, `rated_volts` |
| `core.inductor` | `inductor` | P1, P2 | `henries` |
| `core.zener-1n4733a` | `zener` | A, K | none; `vz_volts` is the breakdown parameter of the junction (4.06 V), not the quoted 5.1 V |
| `core.lm358` | `opamp` twice (`amp1`, `amp2`), sharing `VCC` and `VEE` | OUT1, IN1N, IN1P, VEE, IN2P, IN2N, OUT2, VCC | none |
| `core.ne555` | `timer_555` | GND, TRIG, OUT, RESET, CONT, THRES, DISCH, VCC | none |
| `core.signal-source` | `waveform_source` | POS, NEG | `shape`, `amplitude_v`, `offset_v`, `hz`, `duty`, `phase_deg` |

The instance parameter ids equal the layer param keys, and `analogLayer` in `live.ts` builds the element from the table in
`layers.ts` taking `part.params[key] ?? layer.params[key]`. A part with several element layers (the LM358) gets one element
per layer, `<part>:<layer id>`. A capacitor starts empty (`v0` 0) and an inductor at no current (`i0` 0) unless the placed part or
the descriptor says otherwise: a part from the drawer has no charge, and the operating point with the capacitor open would charge it
through the leakage of whatever sits across it. The layers' model id for the registry is `engine:mna-newton@1.0.0`.

Starters (`scripts/gen-analog-starters.mjs` from `scripts/analog-starters.data.mjs`, files in `src/studio/starters/`):
`rc-led`, `blinker-555`, `opamp-amplifier`, `rectifier`, `zener-regulator`. Each is an Uno that only supplies 5 V and
ground, a half breadboard and the parts above, with `simulation.solver.options` `{ mode: 'transient', stepNs }` and a guide
in six languages. The numbers each guide promises are in `src/studio/starters/analog.test.ts`, and
`src/studio/starters/analog-live.test.ts` runs each starter on the live solver (netlist builder, orchestrator, `createRunAnalog`)
and reads the nets: the RC charge reaches 63 percent in a time constant, the 555 blinks about once a second, the op-amp stage
gives 2 V for 1 V, the rectifier holds its peaks near 3.4 V and the Zener holds its output under its breakdown. The signal source
supplies the rectifier and the Zener starters (an instrument-free stand-in for the function generator).

## 5. Analog data in a sim frame (`src/sim-host/analog-protocol.ts`, `protocol.ts`)

`SimEv` `frame` gets one optional field, `analog?: AnalogFrame`. It is present only when the page asked and something
it watches changed.

```ts
{ t: 'analog.watch'; run; watch: AnalogWatch }          // SimReq; replaces any earlier watch
interface AnalogWatch {
  volts: 'all' | string[];        // net ids
  amps: 'all' | ElementId[];      // element ids
  pinAmps: boolean;
  parts: boolean;                 // watts and health of every part that has them
  waves: string[];                // probe ids from probe.add, at most MAX_WAVE_WATCH (8)
}
interface AnalogFrame {
  full: boolean;                  // true on the first frame after load, reset or a new watch: every watched value
  volts?: Record<string, number>;                          // V by net id, relative to ground
  amps?: Record<ElementId, number>;                        // A by element id, positive a to b
  pinAmps?: Record<string, Record<string, number>>;        // A by part id, then pin name, positive into the part
  parts?: Record<string, { watts: number; state: 'ok' | 'hot' | 'burnt' | 'reversed' }>;
  waves?: Record<string, { fromNs: number; stepNs: number; v: number[] }>;   // V or A by probe id
  instruments?: Record<string, { volts: number; amps: number; limiting: boolean }>;   // section 6
}
```

Units are volts, amps, watts, nanoseconds (`SimTime`). Rules that keep a frame small:

- Everything except `full` is a delta against the last frame sent for the run. A missing key means unchanged, not zero.
  A value is sent again only when it moved by more than `ANALOG_DELTA.rel` of its size plus the absolute floor of its
  kind (`voltsAbs`, `ampsAbs`, `wattsAbs`).
- Only what the watch names is sent; with no watch there is no `analog` field. `analog.watch`, probes and instruments
  belong to the run: a load, a reset and a restart clear them and the page sends them again.
- A frame is emitted when the analog part changed even if no pin or serial line did, at most 30 a second.
- `waves`: samples on a uniform grid, sample `k` at `fromNs + k * stepNs`, at most `MAX_WAVE_SAMPLES` (512) per probe per
  frame, the samples since the last frame. When more are due, the frame carries the newest 512 on a coarser `stepNs`, so
  the grid of one frame is always uniform.
- `parts.state`: `ok`; `hot` while a rating is exceeded but the part has not failed; `burnt` once the failure rule
  latched (it stays until repair); `reversed` for a polarized part (capacitor, TMP36) fed the wrong way round. These words come from
  `HonestState` in `states.ts`. The rules there: a capacitor burns above its rated voltage, or after half a second reversed when
  polarised (`failure:capacitor-overvoltage@1`); an inductor burns above twice its rated current (`failure:inductor-overcurrent@1`);
  a diode, a Zener included, burns when the magnitude of its current passes its maximum. A burnt capacitor or inductor is open in later solves.
  An op-amp burns above the absolute maximum between its supply pins (32 V for the LM358), and when its output carries more than the
  short-circuit rating (60 mA) for 100 ms (`failure:opamp-overstress@1`); a 555 above 18 V, and when its output carries more than
  225 mA for 100 ms (`failure:timer555-overstress@1`). The ratings reach the element as `rating.vabsVolts` and `rating.icmaxAmps`
  through the layer params `supply_max_volts` and `output_max_amps` (optional, so a descriptor without them never burns). The dwell is an
  assumption, there so the inrush into a capacitor behind the output is not a burn. A burnt op-amp or 555 lets go of its output in later solves.
  A part with no supply, an op-amp with less between its pins than its output swing needs or a 555 under 1 V, releases its output pins, so
  an ohmmeter does not read a source in it.
- Part current: `amps` has the current through each element; `pinAmps` has the current each pin of a part carries, so a
  chip with several pins (op-amp, 555) is readable without knowing its elements.

Every Studio run has the live solver in the worker (`createRunAnalog` in `sim/analog/run.ts`, wired by `analog` in the
handler deps and `sim.worker.ts`). The orchestrator reaches it through `AnalogBackend`: `prepare` at load, then
`advanceTo(t, changes)` with the changes made at that instant. Board pins and PWM drive the circuit, `analogRead` and the
ADC read the node voltage back (an unconnected pin still reads noise), and a net crossing a board's thresholds reaches
the engine as a pin event. The mode is chosen per circuit by `pickAnalogOptions` (`sim/analog/mode.ts`): `transient`
when a part is a capacitor, inductor or waveform source and `capabilities.transient` is true, else `dc-event`. The
backend reads the chosen mode from `net.settings.analog` in `prepare`; in transient mode the orchestrator also solves
every `stepNs` (a `tick`), and the backend steps its own grid between ticks.

`LiveAnalog.readout()` (`sim/analog/readout.ts`) is what a frame is built from. `createAnalogFrames`
(`sim-host/analog-frame.ts`) applies the watch and the deltas. The page reads the frame from `SimHost.onEvent`;
`SimHost.watchAnalog(watch)` sends the watch (an empty watch stops it) and the last state, deltas applied, is
`RunView.analog` in the run store (`studio/run/analog.ts`). Elements that are not parts (`inst:<id>`) are left out of
`parts`; a board's pins and a logic output belong to the board or the part.

- `pinAmps` covers two-terminal elements, board pins, the collector and emitter of a transistor and a sensor's supply
  pins; a control terminal (base, wiper, gate) has no entry.
- A wave probe is held on `sampleNs` of its spec, or on `DEFAULT_WAVE_STEP_NS` (1 ms) when it was not sampled.
- `meter.read` (`SimHost.meter`) makes one meter reading now with `meterReading`: resistance, continuity, an ammeter
  and a loaded voltmeter. The page asks twice a second while the run exists. A plain voltmeter and the scope use probes.
  These readings, and the tolerance bands, are `LiveAnalog.whatIf` solves, and `whatIf` solves the way the circuit is run: a circuit with a
  capacitor, inductor, generator, op-amp, 555 or Zener goes to the Newton solver, anything else to the piecewise linear one, with the
  droop of a limited source in either. A live reading in a transient run is a step of no length from what the run holds (`heldStep`),
  so a loaded voltmeter reads the charge on a capacitor and a PWM pin reads as its average. A reading with the sources off (the
  ohmmeter) is direct current: capacitors open, inductors their winding resistance, op-amps and 555s without supply.
- `Orchestrator.setInstrument` answers `not-modelled-yet` only while the run has no analog solver (section 6);
  an accepted source is injected as a `param` input on `inst:<id>` with value `{ source: InstrumentSource | null }`, which is
  logged and replays.
- A frame is also sent, with no watch at all, while a bench source is set or the circuit has parts with a power figure: the
  bench readings are in `instruments` (section 6) and part health in `parts`, so a part that burns is reported whether or not
  the flow lens is on (the lens is off by default on a 4-core device).
- The flow lens (`studio/overlays/flow/`) is the reader of these frames. It sends the watch `{ volts: 'all', pinAmps: true }`
  while it is on and a run is going (`lens.ts`, switched with `UiState.flowLens`, on by default only on a device with more than 4 cores and more than 4 GB, and the choice is kept per project) and reads `RunView.analog`.
  Each wire of a breadboard or schematic view takes the colour of its net's voltage on a symmetric scale (`rangeOf`, a 1, 2 or
  5 times a power of ten) and carries dots whose speed grows with the logarithm of the current. A circuit view is a graph, so
  wire currents are not unique in a loop of ideal conductors: one spanning tree is chosen once per document and view
  (`plan.ts`) and each wire carries what the pins beyond it inject. A part that is `hot`, `reversed` or `burnt` is outlined and named.
  The Flow button, the volts the colours stand for and the readout of what the pointer is over (`FlowBar`) sit in the canvas corner.

## 6. Instrument sources: function generator and bench supply

The page puts a source between two nets while the run is going:

```ts
{ t: 'instrument.set'; run; instrument: string; source: InstrumentSource }   // acked with InstrumentReply
{ t: 'instrument.clear'; run; instrument: string }
type InstrumentSource =
  | { kind: 'fgen'; pos: string; neg: string; wave: WaveSpec; rSeriesOhms: number; limitAmps?: number }
  | { kind: 'psu';  pos: string; neg: string; volts: number; limitAmps: number };
interface WaveSpec { shape: WaveShape; amplitudeV; offsetV; hz; duty; phaseDeg }   // the VW parameters
type InstrumentReply = { ok: true } | { ok: false; reason: 'not-modelled-yet' | 'unknown-net' | 'too-many' };
```

- `pos` and `neg` are net ids of the run's netlist. The page resolves a probe point to a net the way probes do
  (`listProbePoints` and `nodeIdOf` in `studio/instruments/placement.ts`).
- `instrument` is the instrument's id (the name of the `Instrument` in the project). Setting an id again replaces the
  source; at most 8 at once.
- `fgen` is a `VW` between the nets, `rSeriesOhms` its output resistance (50 on a bench generator). `psu` is a `V` with
  `rSeriesOhms` of 0.01 and `limit: { amps: limitAmps, mode: 'droop' }`.
- In the solver the same thing is `Change { kind: 'instrument'; element: <instrument id>; source: InstrumentSource | null }`;
  `null` takes it out. The source and its element id (`inst:<id>`) exist only while set; they are not part of the
  project netlist and are not saved with the document. The reading is in the frame's `instruments[id]`:
  `volts` across the two nets, `amps` out of `pos`, and `limiting`, true while the supply holds its current limit instead
  of its set voltage (constant current mode).
- The worker answers through `Orchestrator.setInstrument(id, source | null)`. With no analog solver in the run it answers
  `not-modelled-yet`. A function generator put on a run that is not stepping starts the stepping: the solver takes the step the
  project names or `autoStepNs` sizes (`Live.gridFor`), says so in `AnalogStepResult.stepNs` (present only when the step changed,
  null when it stopped) and the orchestrator starts its ticks; taking the last generator off a circuit that needs no time base stops
  them. Probes already on the run follow: the worker resamples them on the new grid (`ProbeTap.resample`). A net the run lacks, or
  both ends on one net, answers `unknown-net`; a ninth source answers `too-many` (`MAX_INSTRUMENT_SOURCES`). `clear` always answers
  `ok`. Host calls: `setInstrument(id, source)`, `clearInstrument(id)`.
- `LiveAnalog.instrumentReading(id)` returns `{ volts, amps, limiting }` or null (not set, or its circuit did not solve).
  A frame carries it in `analog.instruments[id]` for every set source whenever the value changed, without the page naming the
  instrument in an `analog.watch`: a page that has set a source has asked for its reading. A limited source (`V` or `VW` with `limit`) in the Newton solver is the Thevenin source for a light load and a fixed current
  for a heavy one with a smooth knee (`devices/source.ts`; it carries the limit to a millionth once its terminal is seven times
  `limit * rSeriesOhms` below its voltage), so the bench supply goes constant current and the Uno 5 V pin sags beside a capacitor,
  an op-amp or a 555 as it does without one; `limiting` is true while a source carries its limit.
  `InstrumentReading` and `InstrumentAck` now live in `src/sim/analog/types.ts`; `analog-protocol.ts` re-exports them.
- Setting or taking off a source partitions the circuit again (it can join circuits that were solved apart) and every component is solved
  again at that instant; the capacitors, inductors, amplifiers and timers keep what they held (`TransientRun`'s `carry`), so turning
  the supply's volts mid run does not discharge a capacitor. A snapshot carries the set sources and each run's time and
  memory, and a restore puts them back.
- Project: two `Instrument` kinds, `function-generator` and `power-supply` (`schema:gen` regenerated). The instrument's
  `target.net` is the positive point; `settings` holds the rest (`shape`, `hz`, `amplitudeV`, `offsetV`, `dutyPercent`,
  `volts`, `limitAmps`, `on`, and `neg`, a net id, absent for ground). `groundOf(doc, registry)` in `sim/netlist.ts` is the one
  definition of the ground node, shared by `buildSimNetlist` and the instrument panels.
- A source that is set or changed is an input: it is logged and replays like a pin edge (`kind: 'param'` entry
  targeting `inst:<id>`), so a recorded run reproduces.

A probe can sit on a pin that no net reaches (a chip leg alone in its breadboard strip). `netlist(doc, probedPins(doc))`
gives such a pin a node of its own, `n:<part>/<pin>`, while an instrument has it as its red or black lead; `buildSimNetlist` and
the dock's `nodeIdOf` both pass the same pins, so the dock and the run agree. The dock finds an instrument's node by its pin, not
by the net id it was added with, since a net id does not outlive a rewiring. A run that was built without that node starts again
(see the link in `simLink.ts`); an instrument on a pin the run knows changes nothing in the run.

## 7. Probes and instruments the page already has

Unchanged: `probe.add`, `probe.read`, `probe.sub` and `TraceChunk` stay the path for a probe's history and for the
multimeter and plotter. The frame's `waves` is the cheap path for a scope that wants the latest samples with the frame;
a probe is in one or the other, not both.

In a transient run the worker samples a voltage, current or power probe at every step (`sampledOnTheGrid` in the handler: its
spec gets `sampleNs` equal to the step), and a chunk of a sampled probe has `staircase: false`. In a dc-event run a probe chunk is a staircase,
until a generator starts the stepping: the probes then become waveforms.

The scope and the logic analyser read probes. A probe chunk with `staircase: false` is a waveform: the capture frame marks
its channel `zoh: false` and the scope joins the samples instead of stepping. The scope measures frequency, Vpp, Vrms and
duty from the window on screen (`sim/probe/measure.ts`), triggers on the newest edge whose window is complete
(`sim/probe/capture.ts`, modes auto, normal and single in the view), and the logic analyser exports VCD
(`sim/probe/vcd.ts`) and annotates UART, I2C and SPI with the pure decoders of `src/sim/decode`. `instruments` owns those files.

## 8. Run-time canvas inputs

```ts
interface PartInput { part: string; param: string; value: number }   // src/sim/engine.ts
host.setInput({ part: 'btn1', param: 'pressed', value: 1 })           // SimHost
```

- `param` is a parameter the part declares: `pressed` (button, 0 or 1), `closed` (switch, 0 or 1), `pos` (pot or knob,
  0 to 1). `value` must be a finite number, or the call rejects.
- It sends the existing `input` request with `{ kind: 'param', target: <part id>, value: { path: param, value } }`, so it is
  stamped, logged in `inputs` and replays. Nothing new crosses the worker.
- `Orchestrator.deliver` resolves a part input with `partInputChanges` (`src/sim/analog/part-input.ts`), which knows the
  parts below and returns `null` for anything else; that falls back to a `param` change of the element that carries the
  part's id, and a part id the solver does not know still answers the `unknown-pin` warning.

| Part | `param` | What it does |
|---|---|---|
| `core.push-button-6mm` | `pressed` | 1 joins the two pairs of legs (the `switch` change on the part's element), 0 opens them |
| `core.slide-switch` | `closed` | 0 joins `COM` to `A`, 1 joins `COM` to `B`; two elements, `<part>:A` and `<part>:B` |
| `core.potentiometer-10k` | `pos` | 0 to 1, clamped; the wiper's position from `P1` |

- The page side is `createPartOperator` (`src/studio/tools/operate.ts`), which the editor engine asks before the tools see
  a press: while the run is going a press on a button holds it until release, a click on a slide switch flips it, and
  dragging round a pot turns its knob (the angle the pointer sweeps, 270 degrees for the whole range). It keeps the values for the
  length of one run and sends them through `SimLink.partInput`, so the document is never changed.

## 9. Verilog ports and FPGA boards

`ProgramImage` of kind `source` carries an optional `ports: Record<string, string[]>`:

```ts
{ kind: 'source', language: 'verilog', files, entry, ports: { sw: ['SW0', 'SW1', /* ... */], led: ['LD0', /* ... */], seg: ['CA', 'CB', /* ... */] } }
```

- The key is a top-level port of the top module; the value is the board pin names the bits land on, bit 0 first. This is
  `code.ports` of a Verilog lesson (`CodeTemplate.ports` in `src/content/schema.ts`: the XDC or QSF mapping) in the same
  shape the interpreter's `netResolver` and `fpgaNets` already take.
- A pin name is a key of the board part's `SimPart.pins`, which maps it to a net of the netlist. So `sw[0]` is
  `ports.sw[0]` = `SW0` = the net on the board's `SW0` pin; an `led[3]` write drives the net on `LD3`; a seven segment
  `seg` is seven names. A port of width 1 has one name; a bit with no name is unconnected.
- An input bit takes its level from the net (a slide switch placed on `SW0` drives it); an output bit drives its net as
  a `PIN` element with the board's electrical model, and shows in the frame's `pins` under the net name.
- Absent `ports`, behaviour is as today. `programOf` (`simLink.ts`) fills the load request's `ports` for a Verilog
  project on an FPGA board: the project's `firmware.ports` win per port, and every other port of the board profile is
  matched by name to the pins in the project's pinned board interface (`defaultPorts` in
  `src/lib/interp/verilog/ports.ts`, which knows the Basys 3 and DE10-Lite catalogue names such as `LD3`, `CA` and
  `HEX0` digits). The engine reads `ports` from the load request only.
- The engine emits a `pin` event per output pin whose level changed (with `duty` for a multiplexed or PWM bit) and never
  echoes input bits. A world input that lists a pin of the board itself drives that pin, wired or not
  (`deriveInputPins`). The Board view reads a pin that sits on no net under its own name in `frame.pins`.
- Not done: toggling the board's own switches from the Board view, and on-canvas switch parts reaching the design
  without the live analog solver (they need the net events of `livewire`).

## 10. Honesty

Every number a frame carries is computed by a model; the part's tier (`T1` piecewise linear, `T2` Newton and
transient) shows with it as in the probe readings. A part with no model sends no `parts` entry and the canvas says
"not modelled yet"; no value is shown for it. A solve that did not converge sends no volts for the failed component.

## 11. Checks a builder runs before it hands back

`npm run typecheck`, `npm run server:typecheck`, `npm run lint`, `npm run ui:check`, `npm run content:check`,
`npx vitest run` on the folders touched, `npx vitest run src/architecture.test.ts`, and the e2e specs of the area with
`--project=chromium`. Every user-visible string goes in all six languages (en, de, es, fr, hi, zh).

## 12. How the live solver runs a circuit with time in it

`live.ts` splits the circuit into components that share no node but ground and solves each alone. A component is a Newton component
when it holds a `C`, `L`, `VW`, `OA` or `TMR`, or a diode with a breakdown voltage (`needsNewton` in `newton-bridge.ts`); every other
component stays on the piecewise linear solver, so every circuit that ran before runs the same.

- In a Newton component a diode or transistor that has only the piecewise linear figures is given a Shockley or Gummel-Poon
  curve through them (`forNewton`): a diode passes its forward voltage at 20 mA (or its rated current when that is less), with
  an ideality of 2 for an LED and 1.8 for a diode; a transistor its base-emitter voltage at 1 mA with its gain. The options are
  `NEWTON_OPTIONS`, SPICE's defaults.
- `dc-event`: a Newton component is solved at its operating point when something changes: capacitors open, inductors short.
- `transient`: each Newton component gets a `TransientRun` (`transient.ts`) when first solved, from its operating point and the
  `v0` and `i0` the elements carry, at the load time. `LiveAnalog.apply` holds the changes until `advanceTo(t)`; that first steps
  every run to `t` on its grid (a shorter backward Euler step when `t` falls between grid points, trapezoidal otherwise, backward
  Euler again after a change or a source edge), then applies the changes made at `t`, then solves the components they touched. A
  Newton component touched this way takes one backward Euler step of a nanosecond from the state it holds (`TransientRun.settle`): the
  capacitors keep their charge and the rest of the circuit jumps. Diagnostics of a Newton component are said once, then again only
  when the set changes.
- A snapshot carries each run's time and memory, so a restore carries on from them.
- Op-amp convergence: the drive of the output clamp is limited per Newton iteration (`Limiter.within`), as a junction voltage is, because a
  gain of 100 000 in front of a `tanh` stalls a plain Newton step.
- A PWM pin in a Newton component is a device (`devices/pwm.ts`). With a time base (`mode: 'edge'`, set by `forNewton(el, timed)`) it is a
  square wave on the clock of the run: a step holds the level of its middle and `TransientRun.step` never crosses an edge, it stops there
  and the step after it is backward Euler. `analogWrite(9, 128)` into 10 kohm and 10 uF settles to 5 V * 128/255 with the ripple of the
  two exponentials of one period (`live-pwm.test.ts` checks both against the closed form). Without a time base, or in `averaged` mode,
  it is its average, duty times the high level, which is what a resistive load needs and what a meter reads. The piecewise linear solver
  keeps `averaged` only. The buzzer (`devices/buzzer.ts`: an active one conducts from `vf` through its resistance with a rounded knee, a
  passive one not at all) and the TMP36 (`devices/tmp36.ts`: 20 ohm output at its set voltage while its supply is between 2.7 V and 7 V)
  are Newton devices too.
- A Zener's `rs_ohms` is `junction.rzOhms`, its slope in breakdown; forward it has no series resistance but the junction's own curve (`rsOhms` 0).
- A run that has had three steps in a row that moved no node voltage and no reactive state by more than a nanovolt (or its
  relative size above 1 V) has settled: it stops solving, advancing its clock and handing out the last result, until
  something is changed (`disturb()` or `settle()`) or a source is on a clock (a `VW` with `hz > 0` and an amplitude, or a PWM pin with edges). The count is
  part of the saved run state, so a restored run steps as the original did. A charged RC at 5 V is held at its settled value,
  to the nanovolt a step moved when it stopped, and answers a supply change at the next tick.
- Per solve the matrix and the right-hand side are kept between assemblies (one pair per size, one more for the residual
  check), the residual at a point is computed once, the first residual of a step is only taken when a step has to be damped,
  and the floating nodes of a circuit are found once per set of elements.

## 13. The speed gate (RS-08(b)) and `capabilities.transient`

`e2e/analog-perf.spec.ts` (`npx playwright test --project=perf --no-deps e2e/analog-perf.spec.ts`, built with
`NEXT_PUBLIC_STUDIO_TEST=1` like the other perf specs) runs each analog starter and a ladder of 42 analog parts in the real
simulation worker at "as fast as possible" and reads the speed the worker reports. A 16 ms frame costs `16 ms / speed`. The
gate is that this, times 4, stays under 16 ms; the figure at 6x is recorded. Chromium's CPU throttle does not reach a
worker (the same page measured 126x at 1x, 124x at 4x and 119x at 6x), so the throttled figures are the worker's 1x cost times the
rate, a straight scaling of a CPU-bound loop. RS-03 found the same: no throttled worker number exists.

The ladder is `e2e/support/ladder.ts`: 14 stages off the Uno's 5 V, each a 1 kohm resistor, a 100 nF capacitor and a 1N4007 to
ground (42 parts, 15 nodes, 14 Newton diodes). Its 100 microsecond time constant puts the step at the 10 microsecond
floor, 1,600 steps in a frame, so it is close to the worst a page is asked to follow.

Measured on an Apple laptop, Chromium headless, real worker, the build of this branch (ms of worker time per 16 ms frame):

| Circuit | Step | 1x | 4x | 6x | Before this work, 1x (Node) |
|---|---|---|---|---|---|
| RC charge with an LED | 1 ms | 0.07 | 0.27 | 0.40 | 0.25 |
| 555 blinker | 1 ms | 0.11 | 0.43 | 0.64 | 0.31 |
| Amplifier with an op amp | 1 ms | 0.01 | 0.04 | 0.07 | 0.21 |
| Rectifier with smoothing | 100 us | 0.71 | 2.85 | 4.27 | 1.25 |
| Zener regulator | 1 ms | 0.08 | 0.30 | 0.45 | 0.17 |
| Ladder of 42 parts, settled | 10 us | 2.62 | 10.5 | 15.7 | 80 |
| Ladder, first 20 ms after start (Node, warm) | 10 us | 47 to 55 | 190 to 220 | 280 to 330 | 80 on average |

What moved the ladder from 80 ms to 2.6 ms: no matrix allocation per step and one residual assembly saved per solve (80 to 48
ms), then a settled circuit stops being solved (48 to about 2 ms). Circuits that never settle (the 555 and the rectifier) gained 40 to 65 percent from the first change only (Node: rectifier 1.25 to 0.7 ms, 555 0.31 to 0.11 ms).

Decision: `capabilities.transient` stays `true`. Every starter costs under 5 ms of a 16 ms frame at 6x, and a settled circuit of
42 parts at a 10 microsecond step stays under 16 ms at 6x. What is not met: the first 20 to 100 ms of simulated time after a
42-part nonlinear circuit starts (14 diodes all switching on at once) costs 3 to 4 frames of work per frame at 1x, so the run is slower than
real time for a moment and the run bar says so (`speed.report` `behind`). A circuit that keeps a clock on (a waveform
source, a 555, a rectifier) is never settled, so it pays its per-step cost for as long as it runs; the 20 ms row is the
measured figure for a nonlinear circuit of that size at the 10 microsecond floor, and none was measured with a clock on it. The step floor (10 microseconds) and the
sizing rule are unchanged. The next lever is a cached factorisation for the linear part of the circuit; it was not needed for the starters.


## 14. Builds: the circuit built 100 times from its tolerances

Real parts differ from their printed value. The Builds tab of the right rail builds the open project 100 times, reads one
measure from each build and shows the spread. It lives in `src/components/studio/builds/`; the runner is
`src/sim-host/montecarlo/` and runs in a worker of its own (`worker.ts`), so the page keeps painting and the batch can be
cancelled.

Where the spread comes from (`src/sim/analog/part-tolerance.ts`, on the `Tol` and `toleranceStreams` of `tolerance.ts`): a
descriptor states it, and a part that states none is built at its placed value.

| Value | Rating that states it | Drawn |
|---|---|---|
| `ohms`, `farads`, `henries` of a resistor, capacitor, inductor, potentiometer | `tolerance`, in percent (5 resistor, 10 ceramic, 20 electrolytic, 10 inductor, 20 potentiometer) | uniform within plus and minus the tolerance; the panel can ask for 1 percent resistors |
| `vf` of an LED | the `forward_voltage_<colour>` minimum and maximum the colour picks | normal about the middle, the limits at 3 sigma |
| `hfe` of the 2N2222 | `current_gain_range`, 100 to 300 at 150 mA | normal about the middle, the limits at 3 sigma |

The tolerance figures are the codes the series carry (J is 5 percent, K 10, M 20); their sources in the descriptors are
marked `unverified` because the sheets were recalled, not re-read, when they were added.

Determinism: build `i` has the seed `buildSeed(projectSeed, i)` (`build.ts`), each value is drawn from its own stream
`tol:<part>:<param>` of that seed, so the same project gives the same 100 builds and adding a part never moves another part's
draw. A build runs on the same orchestrator, solver and interpreter a normal run uses, for the simulated time the person
types (2 s by default), and reads the measure at its end: the volts of a node, the amps of a part, or the frequency of a node
from the spacing of its edges through the middle level (`frequencyHz` in `spread.ts`). A build reads no frequency when fewer
than two edges of one kind fit in the time; the panel counts those builds and says to run longer.

Opening a build in the normal run view is an ordinary edit: `sim.set seed` to the build's seed and the solver option
`toleranceMode: "seeded"`. `buildSimNetlist` then draws the same parts from the project seed, so the run is that build.
"Use nominal parts" puts the mode and the seed back. The Dock's Part tolerance select shares the option.

Not covered: a project that runs a compiled hex file (the avr8js engine) is refused; distance sensors (`rangers`) and robot
physics are not part of a build; the LED and transistor spreads are the only semiconductor ones.

Measured on the build machine (14 cores, Node 24, Chromium): 100 builds of the 555 blinker for 2 s simulated, 1 ms step,
took 1.5 s in Node and 1.7 to 1.9 s in the worker of the page, against a budget of 30 s.
