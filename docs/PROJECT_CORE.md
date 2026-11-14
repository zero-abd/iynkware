# Project core

The shared project code: the document type, the rules that keep it valid, the one function that changes it, the part
library, and the converter that turned the old catalogue into projects. It runs in the browser, in Node and in the
room server from the same files (ADR-0014). B3 is its first reader: the studio page stores projects through it and runs
them in a worker (see Runtime).

## Module map

| Folder | What it holds |
| --- | --- |
| `src/core` | Ids, units, `Result` and `Diagnostic`, the document limits, canonical JSON (RFC 8785), strict JSON parsing, SHA-256, the seeded random stream |
| `src/project` | The generated types and validators, the validation passes V0 to V5 (`validate.ts`, `semantic*.ts`, `limits.ts`), `normalize.ts`, `hash.ts`, `migrate.ts`, the netlist, breadboard holes, legacy pin names, `session.ts`, `authority.ts`, `touched.ts` |
| `src/project/apply` | `apply` and `applyBatch`: one handler per op kind (65), each returning the new state and its inverse |
| `src/project/convert` | The catalogue converter: boards, robotics benches and drones to projects, plus its report |
| `src/project/testing` | The headless harness and seeded op generators; test support, not shipped |
| `src/parts` | Part descriptors (`data/*.component.json`), the registry, pinned interfaces, the generic fallback art layout, the library pass V6, the built-in index |
| `src/parts/browser` | The one browser-only loader. It is not portable code |
| `src/protocol` | The worker wire: request and acknowledgement envelope, `createWorkerPort`, `serveWorker`, an inline port for tests, the closed error type and the protocol version |
| `src/sim` | The simulation core: the clock, event queue, orchestrator and engine interface (`engine.ts`), the `SimNetlist` built from a project, digital net resolution and PWM, the analog solver (`analog/`), replay records and hashes (`replay/`) and the closed list of diagnosis cause ids (`faults/`) |
| `src/sim-host` | The browser side of the simulator: the sim worker, `SimHost`, the watchdog, the handler and its protocol, and the engine adapters that wrap `src/lib/interp` (`engines/`). Not portable: it imports `src/lib` |
| `src/export` | The `.iynk` and `.iynkz` readers and writers and the zip store and reader. Portable |
| `src/local` | Browser storage: the IndexedDB and memory repositories, the project worker, its host, autosave, the crash journal, tab sync, the library, files, export all, wipe, storage health and the service worker registration. Not portable |

`src/sim-host` and `src/local` have no row in the import matrix; they may import anything they need. `src/components/studio`
holds the studio list page and the Diagnostics panel, and `public/sw.js` is the service worker.

## Import matrix

`src/architecture.test.ts` holds this as code. An importer may use only the modules in its row. Tests, `*.testing.ts`
files and `src/project/testing/` are exempt: they cross modules and read files on purpose.

| Importer | May import |
| --- | --- |
| `core` | nothing |
| `protocol` | `core` |
| `project` | `core` |
| `parts` | `core`, and types only from `project` |
| `sim`, `export` | `core`, `project`, `parts` |
| `server` | `core`, `protocol`, `project`, `parts`, `sim`, `export` |

`content`, `ui` and `labs` (`src/content` and `src/i18n`, `src/app` and `src/components`, `src/lib`) are not enforced
yet, because the existing tree breaks the matrix for them. Three ratchets stop it getting worse. Lower the numbers
when a lab moves, never raise them.

| Ratchet | Now | Most allowed |
| --- | --- | --- |
| `src/lib` imports from `@/components` | 35 | 35 |
| `src/content` imports from `@/lib`, `@/components`, `@/app` | 112 | 112 |
| `src/lib` imports from `@/app` | 4 | 4 |

`src/project/apply` has one more rule (FA-01): only `src/project/session.ts` imports it, and a file that imports the
session may not assign to its `state` or `revision`.

## Portable rules

Files under `src/core`, `src/protocol`, `src/project`, `src/parts` (not `src/parts/browser`), `src/sim` and `src/export` must run under plain Node type
stripping and in a worker:

- relative imports end in `.ts`, `.mjs` or `.json`; `import type` for types
- no `enum`, parameter properties or `namespace` (`erasableSyntaxOnly`)
- no DOM, no `node:` import, no `react` or `next`, no `@/` alias
- no `Date.now`, no `Math.random`; time and randomness are injected. `src/sim` also bans `performance.now`,
  `new Date`, `crypto.getRandomValues`, `eval`, `new Function` and dynamic `import`, so a run's time is the virtual
  clock and nothing else (SA-11; test files are exempt)
- a test in a portable folder starts with `// @vitest-environment node`

`npx tsc -p tsconfig.portable.json` checks the folders without DOM types and runs as part of `npm run typecheck`. ESLint
enforces the same import and global rules.

The converter cannot import `src/content`, so `src/project/convert/types.ts` copies the fields it reads. The drift test
`input-types.drift.test.ts` assigns the content types to the copies, so a renamed or retyped field fails the type check.

## Runtime

The studio page runs two workers, each behind a typed request and answer port from `src/protocol`. Neither worker has
`fetch`, and nothing leaves the browser.

| Worker | Entry | Owns | Page side |
| --- | --- | --- | --- |
| `project` | `src/local/project.worker.ts` | IndexedDB (through the repository), the shadow copy of the open document, saves, the library, files, export all and wipe | `ProjectHost` in `src/local/project-host.ts` |
| `sim` | `src/sim-host/sim.worker.ts` | One run at a time: the orchestrator, the engine adapters and the check jobs | `SimHost` in `src/sim-host/host.ts` |

```
page (React, ProjectSession, autosave)
  |  commit / save / lib / file / data     frames / state / events
  |-----------------> project worker -----------> IndexedDB (19 stores)
  |                     shadow copy, hash, write
  |  load / control / step / input / check
  |-----------------> sim worker (watchdog on the page)
                        orchestrator -> engines (interpreters), analog solver
```

The page keeps the live `ProjectSession`, because undo, redo and the editor need it on the main thread. Each batch of ops
also goes to the project worker, which folds it into its own copy so a save hashes and writes off the main thread. The
stores and the file formats are described in `docs/PROJECT_FILES.md`.

A run starts with `load`: the page builds a `SimNetlist` from the project (`src/sim/netlist.ts`), the engine adapter
loads the program, and the orchestrator advances every engine in slices of exactly 1,000,000 ns, cut short at the next
input or queued event. Wall time never changes a slice, so the same project, inputs and seed give the same pin trace.
Digital nets resolve by drive strength, and the digital-only slice follows rule DP-1: a resistor passes logic level, an
LED lights when its anode is high and its cathode reaches ground through resistors, and anything the slice cannot model
is shown as not modelled. Every state it makes is marked as an approximation.

A frame goes to the page with pin levels, part states and serial text. The page repaints from frames; the worker never
touches the DOM.

The sim worker can fail in two ways, and the page survives each:

- **A limit.** The interpreters cap list and string growth, array sizes, serial output and the heap. A program that hits
  one ends with state `limit` and a message, and the worker keeps answering (SA-10).
- **A stall.** A stop or cancel arms a 2 s watchdog on the page. If the worker does not answer in time, the page
  terminates it, starts a new one and reports it. The project is unchanged, because the sim worker never writes it.

A killed `project` worker is restarted the same way and the Diagnostics panel compares the project hash before and
after the kill (FA-07).

Replay (`src/sim/replay`) records a run's inputs, serial output and pin edges. `replay` runs them again and reports the
first difference; `pinTraceHash` and the serial hash make two runs comparable across browsers (R-048).

The analog solver (`src/sim/analog`) builds a modified nodal system from the netlist: a union-find graph for the nodes,
element stamps, a piecewise-linear iteration with a convergence flag, and Gaussian elimination with partial pivoting. It reproduces the older bench
solver's node voltages and branch currents on the golden file of 99 circuits (SA-02). The legacy adapter keeps the old
input shape. A circuit that does not converge returns its flag and a diagnostic; the solve ends and says so.

The service worker (`public/sw.js`, registered by `src/local/sw-register.ts` with the build id) precaches the studio shell
found by scanning the page HTML at install, and caches same-origin GETs at run time, so one online visit makes the studio
list and the editor open offline. The worker script itself is served uncached with its own policy, and the Diagnostics
panel is a developer page that B4 either moves or removes.

Measured numbers for this phase are in `docs/MASTER_PLAN/05_ENGINEERING/results/B3.md`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run schema:gen` | Writes the types and standalone validators in `src/project/generated` and `src/parts/generated` from the JSON schemas under `docs/MASTER_PLAN/04_ARCHITECTURE/schemas/` |
| `npm run schema:check` | Fails if the generated files differ from a fresh run |
| `npm run corpus` | Converts all 38 catalogue items to 140 projects in `.corpus/` (git-ignored) with `report.md` and `manifest.json` |
| `npm run corpus -- --check` | Compares a fresh run with `src/project/convert/corpus.manifest.json`; fails when the converter output changes |
| `npm run measure:apply` | Prints the cost of `apply` per op family on a 500 part, 1,000 wire document, plus the whole-document `stateHash`, `validateValue`, `checkBatch` and `netlist` |
| `npm run test:perf` | Runs the timing budgets in the `*.perf.test.ts` files, one file at a time |

After an intended converter change, run `npm run corpus` and copy `.corpus/manifest.json` over the committed manifest in
the same commit.

## Catalogue conversion

38 items, 140 projects, all whole, none kept as legacy data, none failed. 71 projects carry nets. The report lists the
parts that still have no descriptor; those render through the generic fallback until their descriptors exist.
The converter marks every project's third-party content `unchecked` and its licence `LicenseRef-iynk-pending`. Both
are for a person to settle.

## Numbers

Measured on a 14-CPU arm64 Mac (Apple M4 Pro), Node 24.8.0, while other builds were running (load about 27 on 14 CPUs),
so read them as upper bounds. Where a row has two sources, "unit test" is `npm run test:perf` (the `*.perf.test.ts`
files) and `measure:apply` is `npm run measure:apply`.

| What | Result | Target |
| --- | --- | --- |
| `stateHash`, 500 parts and 1,000 nets (171 KB canonical) | 5.1 ms median in the unit test, 6.7 ms in `measure:apply` | under 20 ms |
| `canonicalize`, 244 KB | 6.0 ms (unit test) | |
| SHA-256, 340 KB | 5.8 ms (unit test) | |
| `parseStrict`, 1.2 MB | 15.5 ms (unit test) | |
| `writeIynk`, 500 parts | 9.1 ms (unit test) | under 15 ms |
| `netlist`, 500 parts and 1,000 nets | 0.89 ms best of 5 in the unit test, 0.70 ms median in `measure:apply` | under 5 ms |
| `validateValue`, whole document | 10.5 ms median (`measure:apply`) | |
| `checkBatch`, one place | 0.34 ms median (`measure:apply`) | |
| Parts with legs in `figures/parts` | 28 of 29 | |

`apply` is incremental: each op updates the derived state it touches instead of rebuilding it. `apply` per op, p95 in
microseconds, from `npm run measure:apply` at 500 parts and 1,000 wires. Each figure is the lowest of three runs, taken
back to back on the loaded machine above:

| Family | p95 | Family | p95 |
| --- | --- | --- | --- |
| `component.add` | 1021 | `net.rename` | 663 |
| `wire.add` | 626 | `source.edit` | 505 |
| `net.split` | 700 | `fault.set` | 485 |
| `net.merge` | 694 | `component.set` | 716 |
| `net.connect` | 671 | `view.place` | 432 |
| `net.disconnect` | 548 | `wire.remove` | 435 |
| `component.remove` | 606 | `test.set` | 388 |

The budget is 1 ms at p95 for the hot families. The measurement script names `net.connect`, `view.place`, `wire.add`
and `component.set` as hot, and all four are under it, at 0.43 to 0.72 ms. A single run on this machine can still push
one over: `component.set` read 1.26 ms in one run and 0.72 ms in the next. `component.add` also creates the instance and
sits at the budget, so it is not one of the hot four. `apply` stays on the main thread; the script prints "apply can
stay on the main thread" when the hot four are at or under 1 ms, and says to move them into the `ProjectWorker` when one is over. Take the numbers again on an
idle machine before quoting them.

The unit test for this, `src/project/apply-cost.perf.test.ts`, keeps the best of three rounds of 300 ops under a
ceiling of 10 ms (scaled, see below). It is a guard against a gross slowdown, not the 1 ms decision figure. It printed
p95 0.73 ms on this machine.

### How the unit-test budgets are set

Wall-clock budgets in the `*.perf.test.ts` files go through `budgetMs()` in `src/core/perf.testing.ts`. The number a test
names is the budget on the reference machine: the 14-CPU arm64 Mac, quiet. On any machine `budgetMs()` scales it by how
much slower a fixed calibration workload runs there than on the reference (never below 1x, so a faster machine does not
tighten it). A machine that is not 14-CPU arm64 gets a further 2x margin, because a different CPU speeds code up
unevenly. Off the reference machine a budget catches a gross regression, not a small one. The test logs the scale when it
is above 1x. The runs above were scaled 1.08x to 1.23x by the load.

## Module note for B7

The async `Authority` (pending batches, `onRemote`, `onResync`) is not built. `createLocalAuthority` in `authority.ts`
stamps ops synchronously and `ProjectSession` calls it directly. B7 adds the networked authority and decides how the
session meets it.

## How to add an op

See `src/project/apply/README.md`.

## Corrections to the design documents

The design documents are input, so they are not edited. These are the places the code and the schema disagree with
them. The schema decides.

| Document | Says | Actual |
| --- | --- | --- |
| Project data model, parts with legs | 27 parts declare legs | 28 of 29 (`breadboard.js` has `legs: []`) |
| Roadmap B2, op kinds | 14 / 22 / 28 across the three op groups | 13 / 22 / 29 |
| Project data model, monitor example checkpoint | `097630ef...` | The rebuilt revision-140 state hashes to `0986fe91...`. The example file is unchanged; the owner of the example decides which side moves (OQ-3) |
| Project data model 11.3 | Robotics and drone conversion fills `domains.robotics.data.*` and `domains.drone.data.*` | The domain schemas have no such fields, so the converter keeps it in the project's top-level `ext` (`x-iynk-legacy-bench`, `x-iynk-legacy-craft`) (OQ-12) |
| ADR-0102 | 20 id prefixes | 22 (`ast bdy brd cmp flt frm grp ins jct jnt lbl mnt net op par prj prp rtm src usr vw wir`) |
| ADR-0110 decision 2 | No `allErrors` in production | Dropped; the generated validators collect all errors |
| Roadmap T-B2-15 | Update the two stale examples | They were already at schema 1.1 |
