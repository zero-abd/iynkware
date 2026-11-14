# State of the code

Dated 2026-11-14. What exists in this repo today, what does not, and what is open. The process is in
[COLLABORATION.md](COLLABORATION.md).

## Where the code came from

The code is a copy of iynk's `main` as of iynk commit `b1223018` (2026-11-13), copied on 2026-11-14 with no shared
history: the first commit on `main` holds that code. Commit hashes in [HANDOFF.md](../HANDOFF.md) and
`docs/MASTER_PLAN/` are iynk's and do not exist here. Fixes from iynk come over by hand as ordinary PRs; nothing is
pushed to iynk.

README.md, CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md and LICENSE-PENDING.md describe iynkware and give this
repo's clone address (PR #5). What still says iynk: the package names (`iynk` in package.json, `iynk-server` in
`server/package.json`), the 2D app's own UI and copy (its name, and `iynk.tech` in the `shell` and `together` messages),
the `iynk` command line and the "iynk check" Action in `action.yml`. HANDOFF.md and `docs/MASTER_PLAN/` are iynk's
history and stay as they are.

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
| `xr` | The headset app: its own Vite package on the Immersive Web SDK, importing `src/` and `content/` ([XR_ARCHITECTURE.md](XR_ARCHITECTURE.md)) |
| `tools/xr-assets` | The asset pipeline's contract: the glTF sidecar schema ([XR_ASSETS.md](XR_ASSETS.md)) |
| `deploy/cloudflare-xr` | The static deploy of `xr/dist` to Cloudflare ([XR_DEPLOY.md](XR_DEPLOY.md)) |

## What works today

- `npm run dev` gives the full 2D product. Checked on 2026-11-14: `/en` answered 200.
- The fast check set (`bash scripts/ci-local.sh --only content,typecheck,lint,ui,no-only,copy`) passed on
  2026-11-14. The full gate has not been run in this repo yet.
- The headset app's walking skeleton (`xr/`, PRs #12 and #13): the Uno Blink template laid out on a bench in
  passthrough MR from the real project document, Run and Stop buttons that answer a controller ray and trigger, a hand
  pinch, a fingertip poke and the desktop mouse, Blink running in a Web Worker through iynk's sim handler, and the LED
  mesh following the `led` part state. Checked on 2026-11-14 in the IWER emulator (Quest 3 profile) with
  `node scripts/emulator-check.mjs`, and `xr/dist` under the deploy's headers in desktop Chromium. The shared contracts
  are in `xr/src/contracts/`; [XR_ARCHITECTURE.md](XR_ARCHITECTURE.md) has the layout and the run commands.
- On the Quest 3S, the XR spike (a separate throwaway page) entered `immersive-ar` with passthrough at 90 fps over
  USB, with no person needed to press Enter.
- On the Quest 3S, the skeleton itself (2026-11-14, over USB on `http://localhost:8081`): the page loaded in Quest
  Browser 154, and Blink ran in the worker on the headset with the LED mesh toggling every 500 ms (started over
  DevTools on the 2D page). Entering MR did not start: Quest Browser showed "Allow http://localhost:8081 to open
  immersive experiences that use hand and body tracking?", which waits for a person (once per origin). So the session,
  the frame rate and the Run press by controller or hand are not yet tried on the headset with this app.

## What does not exist yet

- Most of the headset app. Beyond the skeleton every pillar folder is a stub: no parts shelf, no wiring by hand, no
  lessons in the headset, no zoom or see-through, no drones or robots, no home menu. The work is on the issue board,
  one label per pillar (`ws:bench`, `ws:run`, `ws:learn`, `ws:scale`, `ws:range`, `ws:shell`, `ws:assets`); the
  interaction and experience spec it builds to is [XR_DESIGN.md](XR_DESIGN.md).
- Converted assets: only the Blink parts (Uno R3, half breadboard, 5 mm LED, resistor) are drawn from `tools/xr-assets`
  glTF in the ink look; every other part is still a placeholder built from its descriptor.
- Firmware engines in the headset: the worker runs iynk's interpreter, and rapier physics for robot projects (PR #110,
  loaded lazily in the worker); no avr8js or rp2040js yet (#38).
- Saving projects in the headset: it opens a template each time.
- Hosting for the 2D app: not set up, not decided. The headset build has a static deploy on Cloudflare with one
  command ([XR_DEPLOY.md](XR_DEPLOY.md)); since 2026-11-14 its production URL serves the headset app built from
  `main`, deployed by hand.
- Hosted CI: none, and no workflow files. The two inherited from iynk failed at startup on every run here and were
  removed (PR #5; why is in COLLABORATION.md section 6). `action.yml` stays: it is the "iynk check" Action for other
  repos, not CI.

## Open items that matter here

From HANDOFF.md section 9, plus what the headset work changes.

| Item | Why it is open |
|---|---|
| Permissions-Policy | `next.config.ts` sends `xr-spatial-tracking=()`, `microphone=()`, `accelerometer=()`, `gyroscope=()` and `magnetometer=()` on every page, so WebXR and voice input are refused on the 2D app's origin. The headset app is served on its own (Vite or Cloudflare) and is not affected until it moves under `/xr/` on that origin. `e2e/headers.spec.ts` asserts the exact header; change both in one PR. |
| Content Security Policy | `src/lib/csp.ts` allows `connect-src 'self'` plus the configured origins, `worker-src 'self'` (no blob workers) and `img-src 'self' data: blob:`; wasm is allowed. Anything the XR code fetches from another origin, or runs as a blob worker, is refused until the policy changes. Script elements keep `'unsafe-inline'` (reasons in HANDOFF.md section 9). |
| Licence | Not chosen for iynk or iynkware (`LICENSE-PENDING.md`); say "free". iynk's is Amar's to choose; what iynkware gets, and whether it follows iynk's, needs zero-abd. Provenance rows P-01 to P-06 must be settled first. |
| Names and contacts | Need zero-abd: whether the package names, the 2D app's UI name and its `iynk.tech` copy change; the private channel SECURITY.md sends reports to (it says only "zero-abd, privately"). |
| Translations | The de, es, fr, hi and zh copy has not been read by native speakers. |
| Server docs | `SELF_HOSTING.md`, `SERVER_AND_KEYS.md` and `DATA_HANDLING.md` still describe the old Next `/api/*` routes; AI, search and MCP live in `server/`. The README says so. |
| `minimatch` advisory | Moderate, lint tooling only; `npm audit --omit=dev` is clean. |

## How this file is kept current

Whoever merges a PR that changes what this file says updates it in the same PR, and changes the date at the top.
