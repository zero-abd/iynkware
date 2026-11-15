# XR architecture

Updated 2026-11-14. The headset app lives in `xr/`. It is a separate Vite package built on Meta's Immersive Web SDK
(IWSDK) that imports iynk's pure TypeScript (simulation, project document, parts, content) straight from `src/` and
`content/`. This file is the map every pillar works from: what goes where, which files are shared contracts, how data
flows, the frames and the performance rules, and how to run it on a desktop and on the Quest 3S. How things look and
behave (the bench, the interaction grammar, feedback, the spatial UI kit) is [XR_DESIGN.md](XR_DESIGN.md).

## 1. Decisions this rests on

- **IWSDK** (`@iwsdk/core` 1.1.0, three.js `super-three` 0.185.0 re-exported by it) in `xr/` with its own
  `package.json` and lockfile. The Next app's package.json, lockfile and headers are not touched by `xr/`.
- **One project document.** Everything the person changes goes through `ProjectStore.apply(ops)`, which is iynk's
  `createSession` (ops, undo and redo). The bench never edits meshes as truth: it lays meshes out from the document.
- **The simulation runs in a Web Worker** that wraps iynk's `createSimHandler`. The render thread only sends requests
  and reads frames.
- **Controllers and hands are equal.** Every interaction is bound through `InputService.bind`, which reports a ray
  press, a poke and a grab the same way for a controller, a tracked hand and the desktop mouse.
- **Passthrough MR by default** (`immersive-ar`, `local-floor`), the VR studio (`immersive-vr`) as the fallback and as a
  setting. Seated and standing benches (`XrSettings.posture`, `benchHeight`).
- **Assets are built ahead of time** from iynk's figures as glTF plus a sidecar (docs/XR_ASSETS.md). The app never
  fetches from a CDN at runtime; decoders and controller and hand models are served from `xr/` itself.
- **Hosting:** a static build in `xr/dist`, deployed to Cloudflare (docs/XR_DEPLOY.md). Later, the same build under
  `/xr/` on the 2D app's origin so both share `localStorage["iynk:v1"]`, then a Horizon Store web app.
- **The co-builder is `XrApp.assistant`** ("Build it with me", scripted today, no model): built in `app.ts` from `xr/src/assistant`. Voice and a model-backed partner are not built.

## 2. Directory layout

```
xr/
  index.html            the 2D shell: canvas container, Enter button, status line
  package.json          its own dependencies and lockfile; scripts below
  vite.config.ts        IWSDK dev plugin (IWER emulator), aliases, port 8081, build to dist/
  vite.aliases.ts       @/ -> ../src/, @content/ -> ../content/
  tsconfig.json         strict; paths for @/ and @content/
  vitest.config.ts      node environment, test/**/*.test.ts
  scripts/              emulator check (Playwright + IWER), Quest Browser DevTools helper
  test/                 unit tests that need no browser (sim bridge, assets, input)
  src/
    main.ts             boot: World.create, createApp, mount FEATURES, Enter button
    app.ts              builds the services in XrApp around one world and one project
    features.ts         the list of pillar modules, in mount order
    compose.ts          composeModules: one pillar module out of its sub-modules
    contracts/          the shared types every pillar codes against (section 4)
    sim/                worker, handler wiring, SimBridge (shared service)
    assets/             asset registry: converted glTF items, else placeholders from descriptors (shared service)
    input/              InputService over IWSDK pointers and grabs (shared service)
    project/            ProjectStore over iynk's session, TemplateSource
    ui/                 canvas text labels, the overlay layer, a tiny observable value
    bench/              pillar 1, build: space.ts (BenchSpace), shelf/ wire/ edit/ pose/
    run/                pillar 2, run and stress: controls/ (run cluster, clock) views/ (part views) inputs/ (parts
                        worked by hand) tools/ (meter, scope, serial) findings/ (problems at the part) faults/ (fault lab)
    learn/              pillar 3, learn: lessons/ callouts/ catalogue/ onboarding/, launcher.ts (app.lessons), guide.ts, progress.ts
    scale/              pillar 4, scale and insight: service.ts (app.scale), kit/, space/ zoom/ room/ insight/ flow/
                        probe/ controls/
    range/              pillar 5, range: flight/ robots/
    lab/                pillar 8, lab: model/ items/ experiments/ tutor/ (training labs beyond circuits)
    agent/              pillar 9, agent: tools/ bubbles/ coach/ bridge/ (what a voice assistant can do and show)
    parts-import/       pillar 10, parts import: bring a part pack (.iynkpack) in and place the part on the bench
    shell/              pillar 6, shell and shipping: menu/, settings.ts, service.ts (app.shell), copy.ts
```

Pillar 7, the asset pipeline, lives outside `xr/`: `tools/xr-assets/` and docs/XR_ASSETS.md.

Each pillar's `index.ts` composes its sub-modules (`composeModules`), and each sub-module folder exports one
`FeatureModule` (`mount(app)` returns a teardown). An issue owns one or more of those folders; most are stubs today.
Code never edits a folder another open issue owns; it uses the other pillar's services through `XrApp`.

## 3. Data flow

```
 controller ray / hand pinch / poke / mouse
        |  InputService.bind(object, {ray, poke, grab}) -> InteractionEvent
        v
 feature module (bench, run, learn ...)
        |  ProjectStore.apply(ops, {label})            (iynk createSession: undo, redo, DocChange)
        v
 project document (iynk.project 1.1) ---- subscribe(DocChange) ----> BenchSpace.layout()
        |  SimBridge.load(doc)                                        meshes from AssetRegistry,
        v                                                             placed by x_mm, y_mm, legs, wires
 buildSimNetlist + programOf (render thread)
        |  postMessage SimReq (load, run, pause, step, stop, speed, input, analog.watch)
        v
 sim worker: createSimHandler (interp engine, digital nets, analog solver, fault rules; rapier for a robot)
        |  SimEv frames: change driven, at most 30 per sim second, heartbeat every 250 ms; mech_frame 30 per sim second
        v
 SimBridge.onFrame(SimFrame {atNs, pins, parts, serial}), onMech(PhysicsFrame {atNs, bodies}), onMechState
        |  run module: PartViewRegistry.create(ctx) per placed part
        v
 PartView.update(PartState) -> channel nodes (LED emissive, servo horn ...) on the placed meshes
```

Frames are plain data and cross the worker boundary as structured clones. Views must not allocate per frame and must
not read the document or the sim directly; they only get `PartState`.

## 4. Contracts

The files in `xr/src/contracts/` are types (and one helper, `pickText`). Code against these, never against another
pillar's implementation.

| File | What it fixes | Implementation today |
|---|---|---|
| [common.ts](../xr/src/contracts/common.ts) | `Vec3`, `Unsubscribe`, `ReadonlyValue`, the six languages, `pickText` | |
| [sim.ts](../xr/src/contracts/sim.ts) | `SimBridge`: load, run, pause, step, stop, speed, world inputs, analog watch (merged per owner), meter, robot physics (`lastMech`, `onMech`, `onMechState`); `SimFrame`, `RunState`, `PhysicsFrame`, `MechStatus` | `xr/src/sim/bridge.ts` |
| [project.ts](../xr/src/contracts/project.ts) | `ProjectStore` (ops, undo, redo, `as(author)` for the co-builder, subscribe), `Selection`, `TemplateSource`, `ProjectRepository` | `xr/src/project/store.ts` |
| [assets.ts](../xr/src/contracts/assets.ts) | `AssetRegistry`, `PartAsset` with the pipeline's sidecar (imported from `tools/xr-assets/schema/xr-asset.ts`) and `footprint` | `xr/src/assets/registry.ts` |
| [space.ts](../xr/src/contracts/space.ts) | `BenchSpace`: bench pose and scale, document mm to board frame to world, `worldOf(target)`, `wirePath(wire)`, `objectOf`, `onLayout` | `xr/src/bench/space.ts` |
| [input.ts](../xr/src/contracts/input.ts) | `InputService`: `bind`, sources, `pose` (each hand or controller every frame: pinch point or grip, palm normal, pinching, open hand, target ray), stick, pulse, `onAny`, `button` (A/X, B/Y, thumbstick click: pressed, down, up), `freeHold` (a pinch or grip that began on no bound target); `InteractionEvent` | `xr/src/input/service.ts` |
| [feedback.ts](../xr/src/contracts/feedback.ts) | `FeedbackService` on `XrApp.feedback`: `play(event, at, hand)` for the section 4 table of docs/XR_DESIGN.md (controller haptics, the pop ring for hands or with sound off, synthesized positional sounds per bus, following the sound settings) | `xr/src/ui/feedback/` |
| [part-view.ts](../xr/src/contracts/part-view.ts) | `PartView`, `PartViewFactory`, `PartViewRegistry` | `xr/src/run/views/` |
| [overlay.ts](../xr/src/contracts/overlay.ts) | `OverlayLayer`: glows, pins and labels on board targets, per owner | `xr/src/ui/overlay.ts` |
| [lesson.ts](../xr/src/contracts/lesson.ts) | `LessonGuide`, `GuideStep`, `GuideCheck`, `ProgressStore`, `LessonLauncher` (catalogue and opening lessons, `app.lessons`) | `xr/src/learn/` (fake guide; `launcher.ts` slot) |
| [scale.ts](../xr/src/contracts/scale.ts) | `ScaleService`: work-scale steps, Room size and the stage, see-through and explode, current flow, the part inspector, passthrough or the paper room | `xr/src/scale/service.ts` |
| [settings.ts](../xr/src/contracts/settings.ts) | `XrSettings` (space, posture, bench height and scale, hand, refresh; the headset's own sound, volumes and mono, reduced motion, room light, text size, high contrast, toggle grab, flight mode, teleport), `SettingsStore` | `xr/src/shell/settings.ts` |
| [shell.ts](../xr/src/contracts/shell.ts) | `ShellService`: where the person is (`Place`: bench, room size, range) and `go`, the home panel and its entries, the one menu's items, app-level notices | `xr/src/shell/service.ts` |
| [app.ts](../xr/src/contracts/app.ts) | `XrApp` (every service above), `XrMode`, `FeatureModule`, `assistant` (`AssistantService`, the co-builder) | `xr/src/app.ts` |

### Shared contract files

These change only in their own small PR, labelled `contract-change` (and `lockfile` for a lockfile), merged before
the code that needs the change (AGENTS.md hard rule 3):

- `xr/src/contracts/**`
- `xr/src/app.ts`, `xr/src/features.ts`, `xr/src/compose.ts`, `xr/src/main.ts`, `xr/index.html`
- each pillar's `xr/src/<pillar>/index.ts` (the list of its sub-modules)
- `xr/package.json`, `xr/package-lock.json`
- `xr/vite.config.ts`, `xr/vite.aliases.ts`, `xr/tsconfig.json`, `xr/vitest.config.ts`
- `tools/xr-assets/schema/**` (owned by the asset pipeline, pillar 7)

A pillar that needs a new service adds it to `XrApp` in a contract PR first, with a minimal implementation or a fake,
then builds the real one in its own folder.

## 5. Frames and units

- **Asset frame** (docs/XR_ASSETS.md section 3): metres, +Y up, the item's front faces +Z, right-handed, origin at the
  centre of the geometry's bounds in x and z with y = 0 on the surface it stands on.
- **Document**: the breadboard view places a part's layout rectangle by its top-left corner `x_mm`, `y_mm` (y down the
  page, which is towards the person). `PartAsset.footprint` says where that rectangle lies in the asset frame.
- **Board frame**: one group (`BenchSpace.root`) holds every placed part in metres at real size: x = x_mm / 1000,
  z = y_mm / 1000, y up. `docToBoard` and `boardToDoc` convert.
- **World**: the board group is scaled by `BenchSpace.scale` (default 3, so a 68 mm Uno is 20 cm wide) and centred on
  the bench top, which defaults to (0, 0.74, -0.6) in `local-floor`. Grabs and rays work in world space; convert
  through `BenchSpace` and never by hand.
- **Leaded parts** (LEDs, resistors) are seated by their leg anchors (`A`, `K`) on the hole anchors (`c14`) their
  placement's `legs` names. Wires are drawn between pin or hole anchors.
- **Anchor ids** are the sidecar's: pins and holes by their simulation id (`D13`, `a1`, `RAIL_TP2`), everything else
  `<kind>:<name>` (`led:LED`, `control:button`). Channels (`led:<part>`) name the nodes a part view drives.

## 6. Assets

The asset format is docs/XR_ASSETS.md: one binary glTF plus a JSON sidecar per item, written by `tools/xr-assets`,
with the ink look (three-band shading, inverted-hull outlines, flat shadow, no post-processing). The registry returns
the converted item when there is one, else a placeholder built from the part descriptor with a sidecar of the same
shape (`source: 'placeholder'`, one warning saying so).

Converted items (`xr/src/assets/converted.ts`) come from `./xr-assets/` next to the page: `xr/vite.config.ts` serves
that folder in dev and copies it into `dist/xr-assets/` at build, from `tools/xr-assets/out/` when it has been built,
else from the committed `tools/xr-assets/samples/`. The registry reads its `index.json` once when it is made; an
explicit table maps descriptor refs to items (today the Blink ones: `core.uno-r3`, `core.breadboard-half`,
`core.led-5mm`, `core.resistor`). Each item's glb loads once; a placement is a clone (geometry shared) in the
pipeline's ink look (`tools/xr-assets/material/xr-asset.js`, picked up through `import.meta.glob`, its own lazy
chunk), else in the glb's vertex colours. The footprint is the descriptor's layout rectangle through
`frame.fromSource`, moved onto the descriptor's pins when the figure is drawn elsewhere on its page (the LED, the
resistor). Any failure (missing file, bad sidecar, a descriptor pin without an anchor) draws the placeholder with a
console warning naming the item.

Placeholders today: boards, breadboards, leaded parts and generic boxes, at real size, with every positioned pin as an
anchor and holes and pins as one instanced mesh each. Ten boards have no pin positions in their descriptors and get no
pin anchors, and modules are plain boxes.

## 7. Performance rules (Quest 3S)

> **Draw-call budget suspended (owner's decision, 2026-11-14).** The "under 100 draw calls" rule below does not apply
> for now: build beyond it, and do not fail or hold a PR over draw calls. Performance gets its own pass later, measured
> on the headset. The other rules here still hold.

- **72 fps is the floor, 90 the target.** The app asks for 90 (`XrSettings.refresh`) through `updateTargetFrameRate`
  when the browser offers it. The frame budget at 90 is 11.1 ms for CPU and GPU together.
- **Under 100 draw calls** with a full bench in view. The skeleton bench draws 17 in the flat view and 48 for both
  eyes in the emulator. Check with `world.renderer.info.render.calls`.
- **Instancing for repeats.** Breadboard holes, header pins and anything else that repeats is one `InstancedMesh`, with
  the instance index mapping back to an anchor id (`PartAsset.instanced`).
- **Share geometry and materials** between placements; only channel materials (an LED's lens) are per placement.
- **No allocation in per-frame code** (systems, `PartView.update`, `tick`): reuse vectors.
- **Text is canvas textures** (`xr/src/ui/text.ts`), drawn with the system font stack (`system-ui`, then Noto), so
  Hindi and Chinese use whatever Devanagari and Chinese fonts the browser has. The UI toolkit's bundled MSDF fonts are
  Latin only and are not used for translated strings. Whether Quest Browser's fonts cover both scripts has not been
  tried on the headset yet.
- **No CDN fetches at runtime.** IWSDK's default controller profiles come from jsDelivr and its glTF decoders from
  unpkg; both are refused by the deploy's Content Security Policy and must be served from `xr/` (open issue).
- **Bundle.** The production build is about 28 MB with a 9 MB main chunk (2 MB gzipped), mostly IWSDK's physics,
  UI fonts and every bundled project. Splitting it is open work; until then the first load on a headset is slow.

## 8. What is imported from iynk and what is ported

Imported unchanged, through the `@/` and `@content/` aliases (the code stays in `src/` and `content/`):

| iynk module | Used for |
|---|---|
| `src/sim-host/handler`, `engines/interp-engine`, `engines/bind`, `mech`, `protocol`, `analog-protocol` | the worker's simulation host and its messages |
| `src/sim/**` (netlist, digital nets, analog solver, fault rules, probe tap and meter, board profiles, registry) | the circuit simulation |
| `src/lib/interp` | running the firmware source of a template (the interpreter engine) |
| `src/protocol` | `createRpcPort`, `createInlinePort`, `serveWorker` |
| `src/project/session`, `validate`, `touched`, `generated/types` | the project document, ops, undo and validation |
| `src/parts/builtin`, `registry`, `descriptor`, `fallback` | part descriptors for the sim and the placeholders |
| `content/projects` | the templates (`prj_uno-r3-blink` is the start project) |
| `src/lib/progress/storage` (types only) | the shape of the shared `iynk:v1` record |

Ported (rewritten in `xr/`, because the iynk file pulls in the browser app or the Next build):

| xr file | Ported from | Why |
|---|---|---|
| `xr/src/sim/sim.worker.ts`, `handler-deps.ts` | iynk's sim worker | iynk's worker also loads the AVR and RP2040 engines; the headset runs the interpreter, and for a robot project (`needsPhysics`) rapier from its own lazy chunk (the npm compat build, wasm inline) instead of iynk's manifest download |
| `xr/src/sim/bridge.ts` (`programOf`) | `src/studio/simLink.ts`, `src/sim-host/host.ts` | `host.ts` creates its worker with `new URL(...)`, which would bundle the Next worker; `simLink.ts` pulls IndexedDB |
| `xr/src/learn/progress.ts` | `src/lib/progress/storage.ts` | same `localStorage["iynk:v1"]` record, read-modify-write; no IndexedDB mirror yet |
| `xr/src/shell/settings.ts` | iynk's settings and language pick | language from `?lang=`, the `iynk-lang` cookie, then the browser; XR settings in `localStorage["iynk:xr:v1"]` |

## 9. Storage

- `localStorage["iynk:v1"]`: the 2D app's saved record (`done`, `quiz`, `best`, `settings`). The headset app reads it
  and writes back only the fields it changes, so the two stay in step once they share an origin.
- `localStorage["iynk:xr:v1"]`: headset-only settings (`XrSettings`).
- Projects are not saved yet; the skeleton opens a template each time (open issue).

## 10. Running it

Everything below runs from `xr/` with Node 24, and needs only `xr`'s own install: the repository root's `npm ci` is
not needed (iynk code that names `react` for types resolves to `xr`'s `@types/react` through `tsconfig.json` `paths`).
The firmware engines and rapier are `xr` dependencies, so the production build bundles them; Playwright 1.65.1 is pinned
for the emulator scripts.

```bash
cd xr && npm ci
npm run dev:http            # http://localhost:8081/ with the IWER emulator injected; strictPort
npm run typecheck           # tsc --noEmit
npx vitest run < /dev/null  # sim bridge (Uno Blink toggles every 500 ms, drive-base drives), assets, input
npm run build               # static site in xr/dist (base './', so it works at any path)
```

`npm run dev` serves HTTPS with a self-signed certificate made by the IWSDK plugin (`@vitejs/plugin-basic-ssl`); it
installs nothing into the system's trust store. Plain HTTP on localhost is a secure context, so `dev:http` is the
normal loop. Port 8081 is the default; in an issue's worktree use `npx vite --mode http --port $((23000 + N))` for
issue `N` (docs/COLLABORATION.md section 4). `strictPort` makes a clash fail instead of moving to another port.

### Desktop emulator

The dev plugin injects IWER, Meta's WebXR emulator, as a Quest 3 into the page. In a desktop browser:

- The flat page shows the bench. Click Run (point first, then click) to run Blink; Stop resets it.
- Enter MR starts an emulated `immersive-ar` session. IWER's overlay moves the headset, the controllers and the hands.
- From code, `window.IWER_DEVICE.remote.dispatch(method, params)` drives it, for example
  `set_transform {device: 'controller-right', position, orientation}`, `set_select_value {device, value}`,
  `set_input_mode {mode: 'hand'}`. `window.iynkware` exposes the world and the app services.
- `node scripts/emulator-check.mjs [url] [shot.png]` (with `dev:http` running) does the whole walk headless: enter MR, controller
  ray and trigger on Run, the LED toggling every 500 ms, a hand pinch on Stop, a hand pinch on Run again. It needs a
  Playwright Chromium (`npx playwright install chromium`; that command can delete other cached Playwright builds).

### Quest 3S over USB

With the Meta Horizon CLI (`metavr`, on the PATH via `export PATH="$HOME/.metavr/bin:$PATH"`) and the headset on USB:

```bash
metavr device list                              # the Quest 3S shows as a device
metavr adb reverse tcp:8081 tcp:8081            # headset localhost:8081 -> this Mac's port (yours if not 8081)
metavr device wake
metavr device proximity disable                 # stays awake off-head; undo with: metavr device proximity enable
metavr device browser http://localhost:8081     # Quest Browser opens the page
metavr ui dump                                  # find the DOM "Enter MR" button's coordinates
metavr ui tap --coords <x>,<y>                  # enters the session without a person
metavr capture screenshot -o shot.png           # wait about 3 s after entering
```

- Page console: `metavr adb forward tcp:9223 localabstract:chrome_devtools_remote`, then
  `node scripts/cdp.mjs logs 3` or `node scripts/cdp.mjs eval '<expression>'` (an eval does not end the session; a
  reload does).
- Browser and OpenXR logs: `metavr log -n 3000 | grep -E "chromium|cr_|OpenXR_(Session|Passthrough)|XR_SESSION_STATE"`.
- Quest Browser starts at 72 Hz; the app asks for 90. `local-floor` is anchored where the headset was when the session
  began.
- Quest Browser asks once per origin, in an infobar over the page, to "open immersive experiences that use hand and
  body tracking". Until a person allows it for `http://localhost:8081`, Enter MR does nothing. Keep the headset on
  that one origin (map it to any Mac port with `adb reverse`) so the answer is given once.
- A Meta system consent dialog can appear on the first immersive entry on a device. A person handles both; an agent
  never accepts either.
- Any page reload, including a Vite full reload after editing `main.ts`, ends the session.
- Reverse and forward mappings go away when USB or adb reconnects; run them again.

### Hosted

`cd deploy/cloudflare-xr && npm run deploy` publishes `xr/dist` to a public URL (docs/XR_DEPLOY.md). Deploying is the
owner's call: the built JavaScript, including iynk's simulation, is readable by anyone with the link.

## 11. Rules for pillar work

- Bind every interaction through `app.input.bind`; never add IWSDK interactable components or raycast by hand.
- Change the project only through `app.project.apply(ops)`; the bench lays itself out again from the `DocChange`.
- Draw state on parts through part views and channels; draw hints through `app.overlay` with your pillar as `owner`.
- Every user-facing string is in six languages (en de es fr hi zh) in the same PR, drawn as canvas text.
- Show the result in the emulator in the PR (a screenshot or the emulator check's output) and say whether it was tried
  on a headset.
