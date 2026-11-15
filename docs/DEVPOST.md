# iynkware — Devpost submission (Immerse the Bay 2026)

The submission text for the Devpost page, kept with the code so it matches what is actually built. Live demo, what it
does, how the AI works, and why it matters. [STATE.md](STATE.md) stays the engineering record; where they disagree on
what exists, STATE.md wins.

**Live demo:** https://iynkware-xr.asnu.workers.dev/
Open it in the browser of a Meta Quest 3S and press Enter (allow the immersive prompt and, for voice, the microphone).
The same page runs on a desktop browser in a flat mode: mouse to press, keyboard to fly.

## Elevator pitch

A hardware lab on your coffee table. iynkware turns a Meta Quest 3S into a free electronics workbench, science lab and
drone range: build real circuits with your hands, run real simulation, break things safely, fly the drone you built
around your own room — with an AI companion you talk to, who watches what you do and builds with you.

## Inspiration

Hands-on STEM is how people actually learn hardware, but the hands-on part is exactly what most learners never get.
A stocked electronics bench, chemistry glassware, an oscilloscope, a drone you are allowed to crash — each is too
expensive, too dangerous, or simply not there. We had iynk, a free 2D hardware lab in the browser with real simulation.
The question for this weekend: what happens when that lab becomes a place you stand in, with your hands, and a teacher
who is present?

## What it does

Everything runs in Quest Browser over WebXR — nothing to install — with controllers or bare hand tracking, in
passthrough mixed reality, in six languages (English, German, Spanish, French, Hindi, Chinese).

- **Build on a spatial workbench.** Take parts from a shelf, place them on a breadboard, wire pin to pin with your
  hands. Wires have grabbable end beads; dropping a part back on the shelf removes it. Panels float where you put
  them; every one has a grip bar, and Tidy up resets the layout.
- **Run it for real.** The circuit runs in iynk's simulation engines in a Web Worker on the headset: a DC solver and
  interpreters for a teaching subset of Arduino C++ and more. You see current as moving dots on the wires, node
  voltages, LED halos, and a code window that highlights the running line — editable on the bench.
- **Break it safely.** A fault lab burns out parts, miswires the build and lets you diagnose it. The simulation takes
  the hit, not a component budget.
- **Learn.** Guided lessons (start with Blink) with step-by-step highlights on the bench, checks that actually verify
  your build, and a first-run onboarding.
- **Science labs.** Chemistry (bunsen burner, flame tests, a stockroom and a periodic table you tap for samples),
  physics (pendulum experiments), electrical and signals — each with practice and exam modes, a tutor that catches
  mistakes, and a Data tab that records and plots your measurements. Labs are switched from the Home panel.
- **The drone range.** Design a quad on the drone workbench — real part choices, arming rules that refuse an unsafe
  build — then fly it in your own room: a gate course scaled to fit your space (Room, Compact, Tabletop), FPV and
  chase camera screens, motor sound, and "Simulate here", which takes off from the bench and flies around you. Crash,
  and a replay card appears at the crash point with a scrubbable timeline of what went wrong. Robot benches drive
  simulated robots in arenas drawn on your floor.

## How we use AI

**In the product — a voice companion that is present in the room.**

- You hold a Talk button and speak. Audio streams to **Gemini Live** through a Cloudflare Worker token broker: the API
  key never reaches the headset, and per-device daily session caps keep the demo within budget. Text chat works too.
- The companion is **grounded in tools**, not free-floating chat. A locked, versioned tool schema (shared verbatim by
  the app and the Worker) lets it: navigate you anywhere ("pull up the racer drone simulation", "back to the circuit
  bench"), propose circuit edits previewed as a ghost on the bench before you accept, walk lessons forward and back
  any number of steps, build a whole circuit or drone with you step by step ("Build it with me": each step proposed on
  a card with Accept / Accept all / Skip / Undo), and hand you substances in the chemistry lab.
- It is **spatially aware by design, without a camera**. A coach layer streams structured events — what is on the
  bench, which place you are in, what you just wired, lab mistakes, run state — into the model's context. That is
  precise, cheap, and private: no video frames ever leave the headset.
- A **scripted offline brain** answers the common commands locally, so navigation and build help keep working even
  with no network or no key.

**In building it.** Four of us each directed a fleet of Claude Code agents against this repo over the weekend — one
issue, one branch, one PR per agent, with typecheck, unit tests, an emulator walk and a secret scan run locally before
every merge. Several hundred issues and PRs landed between Friday night and Saturday judging.

## Social good: experiences that are too expensive, not safe, too big, or too small

iynkware exists to make hands-on technical education accessible — the lab brought to anyone with a headset:

- **Too expensive:** a stocked bench, meters, chemistry equipment, a fleet of drone parts you are free to destroy. Here
  the marginal cost of burning out an LED, snapping a propeller or ruining an experiment is zero, so learners are free
  to do the thing that teaches most: break it and find out why.
- **Not safe:** flame tests, shorted batteries, overdriven motors, crashing a quad at full throttle — done for real,
  consequence-free, with a tutor who names the hazard instead of an accident report.
- **Too big:** flying a race drone needs a field; here the course scales itself into a bedroom, and a whole robot arena
  is drawn on your floor.
- **Too small:** things no real lab lets you see — current as dots moving through the wires, the inside of a part,
  the circuit grown to room size so you can walk through it.

It is free, runs in the browser with nothing to install, speaks six languages, and the voice companion's
privacy-by-design grounding (structured events, no camera) makes it fit for classrooms. One headset replaces a
bench, a lab and an airfield — and shares them with the next student.

## How we built it

- **WebXR on Meta's Immersive Web SDK (three.js), built with Vite** — `xr/` in the repo, running in Quest Browser on a
  Quest 3S with passthrough, hand tracking and controllers.
- **Real simulation, reused:** the headset app imports iynk's browser-side simulation, project, parts, content and
  i18n code (the 2D iynk app predates the hackathon; everything in the headset app was built this weekend on top of
  it). Simulation runs in a Web Worker on the device.
- **Hand-inked 3D assets:** parts are procedural "figures" compiled to glTF with a sidecar of pins and bounds, so the
  same source draws the 2D app's illustrations and the headset's meshes.
- **Voice stack:** Quest microphone → Gemini Live (direct, with a Worker relay fallback) → streamed text to a speech
  bubble and tool calls into the app. Token broker and static hosting are two small Cloudflare Workers.
- **Interaction design:** one design spec (XR_DESIGN.md) every feature builds to — ray and pinch and poke all work on
  every control, panels are movable and closable, Home always answers, and the whole UI holds up with bare hands.

## Challenges

- **Spatial UI is unforgiving.** Panels that overlap steal each other's rays; windows must never strand you. We ended
  up with focus rules (one shell panel in front at a time), pointer-order priority for Home, grip bars and close
  buttons everywhere, and a Home button that always brings you back.
- **Voice that acts, not just talks.** Keeping tool schemas locked and versioned between app and Worker, making "drone
  workbench" vs "drone simulation" resolve correctly in six languages, and clearing conversation state when you switch
  benches so the model never acts on a stale room.
- **Working on the platform's terms.** Quest Browser gives no camera frames to web apps, so spatial awareness had to
  come from structured events — which turned out better: precise and private.
- **Four fleets, one repo.** Hundreds of agent-authored PRs in two days without hosted CI: hard process rules
  (one issue/branch/PR, local gates, contract files only in their own PRs) kept main green.

## What's next

Room-aware drone courses built from your real walls (WebXR plane detection), gaze- and pose-based observations for the
companion, saving projects on the headset, firmware-accurate AVR/RP2040 engines in the worker, and classroom features:
a teacher view of lab exams and shared multi-person benches.

## Built with

WebXR · Meta Immersive Web SDK · three.js · TypeScript · Vite · Web Workers · Gemini Live · Cloudflare Workers ·
Next.js (the 2D lab) · Vitest · Meta Quest 3S
