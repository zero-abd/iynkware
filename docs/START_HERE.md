# Start here (for agents and new contributors)

A short map so a new session can work without reading the whole repo. The rules are in [AGENTS.md](../AGENTS.md). The
process is in [COLLABORATION.md](COLLABORATION.md). What exists is in [STATE.md](STATE.md). Open work lives as GitHub issues:
`gh issue list --state open`.

## The product

iynkware is iynk for the Meta Quest (WebXR, IWSDK on three.js, in `xr/`). People build hardware on a spatial bench,
run and break it in simulation, fly drones in their own room, and do training labs (chemistry, physics, electrical,
signals). An AI companion talks with them by voice and can point, explain and propose changes. The 2D Next.js app
(`src/`) is the original iynk. `xr/` imports its simulation, project, parts and content code.

## Where things are

| Need | Look in |
|---|---|
| App wiring, service list | `xr/src/app.ts`, `xr/src/features.ts`, `xr/src/contracts/*` (shared contracts: change only in a `contract-change` PR) |
| Build on the bench (grab, carry, wire) | `xr/src/bench/` |
| Run, findings, faults, meters | `xr/src/run/` |
| Lessons | `xr/src/learn/` (content in `content/projects`) |
| Drones and robots in the room | `xr/src/range/` (`flight/room/course.ts` draws courses in the room) |
| Training labs | `xr/src/lab/` (model, items, experiments, tutor); [XR_LAB.md](XR_LAB.md) |
| AI companion: tools, bubbles, observations, voice | `xr/src/agent/`; [XR_AGENT.md](XR_AGENT.md) |
| Voice token broker and Worker | `deploy/cloudflare-xr/` (`voice-policy.mjs` holds the system instruction and the locked tools) |
| 3D figures (hand-inked, procedural JS) | `figures/<kind>/<id>.js`; [FIGURES.md](FIGURES.md), [FIGURES-LAB.md](FIGURES-LAB.md) for lab items |
| Figures to glTF plus sidecar | `tools/xr-assets/`; [XR_ASSETS.md](XR_ASSETS.md) |
| Parts the simulator knows | `src/parts/data/*.component.json` |

## How the pieces connect

- **New object:** prompt in `figures/prompts/<id>.md`, then figure `figures/<kind>/<id>.js`, then
  `python3 -I figures/tools/cfbuild.py <kind>/<id>`, then `cfshoot.py` (screenshots and checks), then `npm run xr:assets`
  (glb plus sidecar), then the headset's asset registry. Lab items also regenerate `figures/lab/catalogue.json`
  (`node figures/engine/lab-catalogue.mjs`).
- **AI companion:** `window.iynkware.agent` is the bridge. Voice (`xr/src/agent/voice/`) mints a token at
  `/api/voice/token`, opens one Gemini Live session (direct, with the Worker relay as fallback), sends `agent.context()`
  with each question, runs `toolCall`s through `agent.call`, and streams text to the speech bubble. The tools are in
  `xr/src/agent/tools/declarations.json`, shared by the app and the Worker.
- **Watching the person:** structured events (actions, lab mistakes, project ops, run state) go through
  `xr/src/agent/coach`. That is the chosen approach over camera vision: it is precise, private and cheap, and Quest
  Browser gives no camera frames.

## Commands

```bash
cd xr && npm ci && npm run typecheck && npx vitest run < /dev/null && npm run build
cd xr && npx vite --mode http --port $((23000+N))     # N = your issue number
node scripts/emulator-check.mjs http://localhost:<port>/   # also lab-check.mjs and agent-check.mjs (from xr/)
NODE_OPTIONS=--max-old-space-size=4096 bash scripts/ci-local.sh --only content,typecheck,lint,ui,no-only,copy
npm run xr:assets:test
node scripts/secret-scan.mjs --diff origin/main..HEAD
```

## Traps

- Close stdin for Vitest (`< /dev/null`), or it can hang.
- The emulator walks can fail right after `vite` starts. Wait about 10 s and rerun before blaming the code.
- Repo paths with spaces once broke the asset CLI (fixed with `pathToFileURL`); quote paths in scripts.
- `npm run xr:assets` rewrites `tools/xr-assets/package-lock.json` with local npm metadata; revert it.
- A local Gemini key goes in `xr/.env.local` (`VITE_GEMINI_API_KEY`, git-ignored, dev builds only). The deployed key is
  the Worker secret `GEMINI_API_KEY`, an AI Studio key, never Vertex. Never print or commit a key.
- Stacked PRs: after the base squash-merges, rebase with `git rebase --onto origin/main <old-base-tip>`.

## Backlog worth knowing (see the issues for details)

- #210: verify voice on a Quest with a real key (mic, direct or relay, tools, latency).
- #207: build drone courses from the real room (WebXR plane and mesh detection).
- #208: companion observations from pose and gaze (what you look at or hold, dwell).
- #209: a free-text `ask` on `AssistantService` (contract), so the agent can propose any build.
- #198: convert lab items to glTF (6 converter tests fail on the newer items).
- #211: lab hands-on gaps and the teacher exam setup.
