# State of the code

Dated 2026-11-15. What exists in this repo today, what does not, and what is open. The process is in
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
| `xr` | The IWSDK/three.js headset app, its shared contracts, services, feature pillars and tests |
| `figures` | Figure sources and engines, built into `public/figures` |
| `e2e` | Playwright tests |
| `deploy` | Dockerfiles, compose and Caddy |
| `docs` | Design notes per area, fact sheets in `docs/facts`, the October 2026 plan in `docs/MASTER_PLAN` (history) |
| `xr` | The headset app: its own Vite package on the Immersive Web SDK, importing `src/` and `content/` ([XR_ARCHITECTURE.md](XR_ARCHITECTURE.md)) |
| `tools/xr-assets` | The asset pipeline's contract: the glTF sidecar schema ([XR_ASSETS.md](XR_ASSETS.md)) |
| `deploy/cloudflare-xr` | The static deploy of `xr/dist` to Cloudflare ([XR_DEPLOY.md](XR_DEPLOY.md)) |

## The headset demo today

> **Draw-call budget suspended (owner's decision, 2026-11-14).** Build beyond the 100-call budget; no PR fails or waits
> over draw calls. Performance gets its own pass later, measured on the headset (docs/XR_ARCHITECTURE.md section 7).

What a person can actually do in the current build of `main`, kept current by whoever merges changes to it. The live
demo for judging is **https://iynkware-xr.asnu.workers.dev/** (deployed from `main` with the paired voice Worker from
Aaren's Cloudflare account, `GEMINI_API_KEY` set as a Worker secret); zero-abd's
https://iynkware-xr.almahmud-zero.workers.dev serves the same app when he deploys. Over USB:
`http://localhost:8091` (docs/XR_ARCHITECTURE.md section 10). Last checked on the Quest 3S and in the emulator:
2026-11-15, `main` at `e953987` (typecheck, the unit tests and the build pass on a dev machine).

- **Home** opens on entry and from the Home button in the session controls: Continue, New project, Blink, All
  lessons, a Science labs row (chemistry, physics, electrical, signals — the lab switcher lives here, there is no
  separate picker), Drones, the robot bench, templates, Projects, Settings, the menu and the language. Home takes its
  own rays even where it overlaps another panel.
- **Bench:** parts from the shelf placed by hand, wiring pin to pin with grabbable wire end beads, drop on a shelf
  bin to remove, a half-round table with a grip bar that moves the whole bench, movable panels with grip bars and
  close buttons, Tidy up, Recentre, scale (Smaller / 3x / Larger, room size), see-through, the paper room.
- **Run:** the sim in a Web Worker on the device — current dots and node voltages, LED halos, meters, faults from the
  fault lab, and an editable code window that marks the running line and follows Step.
- **Learn:** the Blink lesson walked by hand or controller end to end, with highlights, checks and onboarding.
- **Labs:** the four labs with practice and exam, the tutor, the chemistry stockroom and periodic table, pendulum
  and flame-test items picked up by hand, and the Data tab (record, plot).
- **Range:** the drone workbench (design panel, arming rules), flight in the room with controller sticks, course
  sizes fit to the space, FPV and chase screens, motor sound, the crash replay card at the crash point (closable, and
  it leaves with the Range), "Simulate here" around the person, and robot arenas drawn on the floor.
- **Voice companion:** hold Talk and speak (Gemini Live through the token broker, text turns too, six languages, a
  scripted offline fallback). It navigates between every bench, lab and the Range, proposes edits as ghost previews,
  walks lesson steps forward and back in bulk, builds circuits and the drone step by step, and hands out chemistry
  substances. Spatial awareness comes from structured coach events, never a camera.
- **Not yet:** finishing a lesson's `edit` and `quiz` gates in the headset (#169, #53); hand-gesture sticks for
  flying; saving projects on the headset (templates each time).

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

- Whatever "The headset demo today" above does not list. The work is on the issue board, one label per pillar
  (`ws:bench`, `ws:run`, `ws:learn`, `ws:scale`, `ws:range`, `ws:shell`, `ws:assets`, `ws:agent`, `ws:lab`); the
  interaction and experience spec it builds to is [XR_DESIGN.md](XR_DESIGN.md).
- Converted assets: only the Blink parts (Uno R3, half breadboard, 5 mm LED, resistor) are drawn from `tools/xr-assets`
  glTF in the ink look; every other part is still a placeholder built from its descriptor.
- The `BuildGoal` free-text `ask` path through `AssistantService` (#209). The voice front end itself exists
  (`xr/src/agent/voice/`, Gemini Live through the Worker in `deploy/cloudflare-xr/`); `quest-voice-backend/` remains
  an isolated experiment, superseded by that Worker.
- Firmware engines in the headset: the worker runs iynk's interpreter, and rapier physics for robot projects (PR #110,
  loaded lazily in the worker); no avr8js or rp2040js yet (#38).
- Saving projects in the headset: it opens a template each time.
- Hosting for the 2D app: not set up, not decided. The headset build has a static deploy on Cloudflare with one
  command ([XR_DEPLOY.md](XR_DEPLOY.md)); the live copy for judging is https://iynkware-xr.asnu.workers.dev/ (Aaren's
  account, with the voice Worker and its `GEMINI_API_KEY` secret), deployed by hand from `main`.
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
