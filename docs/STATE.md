# State of the code

Dated 2026-11-14. What exists in this repo today, what does not, and what is open. The process is in
[COLLABORATION.md](COLLABORATION.md).

## Where the code came from

The code is a copy of iynk's `main` as of iynk commit `b1223018` (2026-11-13), copied on 2026-11-14 with no shared
history: the first commit on `main` holds that code. Commit hashes in [HANDOFF.md](../HANDOFF.md) and
`docs/MASTER_PLAN/` are iynk's and do not exist here. Fixes from iynk come over by hand as ordinary PRs; nothing is
pushed to iynk.

README.md and CONTRIBUTING.md still describe iynk (its name and its clone address). The package name in package.json
is still `iynk`.

## What was inherited

- **Labs:** 38 catalogue items modelled on real hardware: 12 boards with lessons, 13 robotics benches and 13 drones
  with a flight sim. Each has a hand inked figure you can turn, see through and take apart.
- **Studio:** your own projects on a canvas, with breadboard, schematic and board views of one circuit, a circuit
  solver that runs while you edit, Firmware mode (a `.hex` on the Uno's AVR, a `.uf2` on the Pico), Wokwi import,
  KiCad netlist and SPICE export, and sharing a project as a link.
- **Simulation:** interpreters for a teaching subset of Arduino C++, MicroPython, Python and Verilog; a DC circuit
  solver; a drone calculator and a flight model; and an engine host for avr8js, rp2040js, yosys and rapier physics.
  All of it runs in the browser.
- **Server:** the collaboration server in `server/` (identity, rooms, buddies, stored shares) and the AI, search and
  MCP routes (`/v1/ai`, `/v1/search`, `/v1/mcp`), which stay off unless the operator turns them on.
- **Languages:** six (en, de, es, fr, hi, zh), for the UI and the lesson prose.
- **Also:** the `iynk` command line, Docker files for running your own copy, Vitest unit tests next to the code,
  Playwright e2e tests with axe checks in `e2e/`, and the local gate `scripts/ci-local.sh`.

## Map of the folders

From HANDOFF.md section 7, which also names the doc to read for each.

| Folder | What lives there |
|---|---|
| `src/app` | Pages and API routes, one page per lab item, in six languages |
| `src/components` | Lab UIs, Studio, the shell, the landing page, shared `ui` |
| `src/content` | Boards, benches, drones: lessons, steps, faults, checks |
| `src/project` | The project document: schema, storage, files, lab items as projects |
| `src/core`, `src/protocol` | Shared cores imported as `#core/*` and `#protocol/*` |
| `src/studio` | The Studio canvas, overlays, link sharing, assignments |
| `src/export` | Wokwi import, KiCad netlist and SPICE export |
| `src/sim`, `src/sim-host` | Circuit solver, part models, the engine host |
| `src/parts` | The parts registry the palette and the solver read |
| `src/lib` | Interpreters, drone calculator, flight model, settings, progress, CSP |
| `src/collab`, `src/server-client`, `server/` | Rooms, buddies, server shares |
| `src/ai` | The optional AI partner |
| `src/i18n` | Messages and lesson prose in six languages |
| `src/cli` | The `iynk` command line |
| `figures` | Figure sources and engines, built into `public/figures` |
| `e2e` | Playwright tests |
| `deploy` | Dockerfiles, compose and Caddy |
| `docs` | Design notes per area, fact sheets in `docs/facts`, the October 2026 plan in `docs/MASTER_PLAN` (history) |

## What works today

- `npm run dev` gives the full 2D product. Checked on 2026-11-14: `/en` answered 200.
- The fast check set (`bash scripts/ci-local.sh --only content,typecheck,lint,ui,no-only,copy`) passed on
  2026-11-14. The full gate has not been run in this repo yet.

## What does not exist yet

- Any XR code: no three.js in package.json, no WebXR session, no spatial workbench, no controller or hand input, no
  headset UI. The architecture, folder layout and contract list land in `docs/XR_ARCHITECTURE.md` with the foundation
  PR.
- A headset test setup (Meta Horizon CLI, desktop emulator): documented in the same file when the foundation lands.
- Hosting or a deploy for iynkware: not set up, not decided.
- Hosted CI: none. The workflow files in `.github/workflows/` came from iynk and are not a gate.

## Open items that matter here

From HANDOFF.md section 9, plus what the headset work changes.

| Item | Why it is open |
|---|---|
| Permissions-Policy | `next.config.ts` sends `xr-spatial-tracking=()`, `microphone=()`, `accelerometer=()`, `gyroscope=()` and `magnetometer=()` on every page, so WebXR and voice input are refused. `e2e/headers.spec.ts` asserts the exact header; change both in one PR. |
| Content Security Policy | `src/lib/csp.ts` allows `connect-src 'self'` plus the configured origins, `worker-src 'self'` (no blob workers) and `img-src 'self' data: blob:`; wasm is allowed. Anything the XR code fetches from another origin, or runs as a blob worker, is refused until the policy changes. Script elements keep `'unsafe-inline'` (reasons in HANDOFF.md section 9). |
| Licence | Not chosen (`LICENSE-PENDING.md`); say "free". Provenance rows P-01 to P-06 must be settled first. |
| Translations | The de, es, fr, hi and zh copy has not been read by native speakers. |
| Server docs | `SELF_HOSTING.md`, `SERVER_AND_KEYS.md`, `DATA_HANDLING.md` and the README still describe the old Next `/api/*` routes; AI, search and MCP live in `server/`. |
| `minimatch` advisory | Moderate, lint tooling only; `npm audit --omit=dev` is clean. |

## How this file is kept current

Whoever merges a PR that changes what this file says updates it in the same PR, and changes the date at the top.
