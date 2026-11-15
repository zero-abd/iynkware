# XR agent (pillar 9)

Updated 2026-11-14. The model-agnostic layer a voice client plugs into (#201): tools, speech and callout bubbles,
coach observations and one bridge object. Voice transport is not here (#180, #197). Code: `xr/src/agent/`. Tests:
`xr/test/agent/`. Emulator walk: `xr/scripts/agent-check.mjs`.

```
xr/src/agent/
  text.ts                 fixed strings, six languages (the lab's L6)
  hub.ts                  shared state per world: conversation, callouts, coach, tools, bridge
  tools/declarations.json the function declarations (Gemini Live shape); a Worker can import the same file
  tools/catalog.ts        argument checks, target resolution and the executors
  bubbles/                model.ts (conversation, callout list), speech.ts, callouts.ts
  coach/                  coach.ts (coalescing ring), index.ts (sources, local hazard callouts)
  bridge/                 bridge.ts, scripted.ts (the default brain), index.ts (window, menu row, Ask panel)
```

## Bridge: `window.iynkware.agent`

| Call | What it does |
|---|---|
| `context()` | `{ system, mode, lang, bench or lab, selection, step, cobuild, callouts, observations }`: the rules for a model and the `look` JSON with the last 5 observations. The client stringifies it (about 4 kB with the chemistry lab open). |
| `state(s)` | `connecting`, `listening`, `thinking`, `speaking` or `idle`: the bubble's indicator. |
| `user(text, { final })` | Input transcription deltas, appended to the person's turn. |
| `say(text, { final, suggestions })` | Output transcription deltas, appended to the agent's turn; `final` closes it. |
| `functionDeclarations()` | The tools for a model's setup. |
| `call(name, args)` | Runs a tool: `Promise<{ ok: true, ... } \| { ok: false, error }>`. Never throws. |
| `observe(fn)` | Coach observations (at most one per 1.5 s; hazards at once). |
| `ask(text)` | A text turn for the plugged-in brain (the scripted one by default). |
| `use(brain)` | Plugs in `{ name, turn({ text, context }, io), observe?(o, io) }`; returns the restore. |

## Tools

Read: `look`, `list_targets`. Show: `point_at { target, text, tone? }`, `show_text { text, suggestions? }`,
`clear_callouts`. Act: `propose_build { request, template? }`, `propose_edit { summary, steps }`, `accept_step { all? }`,
`reject_step`, `undo_step`,
`open_lab { lab }`, `leave_lab`, `start_experiment { id, mode? }`, `set_lab_control { item, action, value? }`,
`request_item { name }`, `next_step_hint`. Schemas are in `tools/declarations.json`.

- The project changes only through the co-builder: `propose_build` starts "Build it with me" (a ghosted step), and
  only `accept_step` performs it, authored and undoable. `AssistantService` has no public free-text `ask` yet, so
  `propose_build` builds templates only (Blink and the other board templates) and returns `ok: false` for a free
  request.
- `propose_edit` runs the agent's own bench edits through the same co-builder (`tools/edit.ts`). Each step is one of
  these: `move` or `place` (first leg into a hole), `turn`, `pull`, `remove`, `wire`, `unwire`. Parts are named by refdes, pins as `REF.PIN`
  (spoken names work: `U1.5V` is `P5V`), holes like `e12`. A custom `CoBuilder` goes to
  `buildWithMe(doc, { from: 'bench', builder })`, so the ghost, the card, accept, skip and undo and the companion's
  carry all apply unchanged. The steps are dry-run in order, so a later step sees the earlier ones. A step the
  person does by hand counts as done when the session plans again. An edit that cannot be done returns in
  `unreachable` with the reason (a bad pin lists the part's pins).
- Lab tools go through the lab context and `LabStore.apply`, so the tutor and the run log see them.
- In an exam `set_lab_control`, `request_item` and `next_step_hint` refuse.
- `point_at` targets: a lab item id, kind or name when a lab is open; else a bench refdes (`RES1`), a pin
  (`LED1.A`) or a part word (`resistor`, `board`). An unknown target returns close matches.

## Voice in the app (`xr/src/agent/voice/`)

The headset app is its own Gemini Live client; the Worker's old page script (`deploy/cloudflare-xr/voice/demo.js`) is no
longer injected.

- **On, once:** the Tools menu row "Voice" (an XR select) or the 2D button opens the adult consent and disclosure;
  "Enable voice" creates one AudioContext and asks for the microphone once (echo cancellation, noise suppression,
  auto gain), and both stay up until voice is turned off. The bubble says when the track is muted or ended or the
  context is suspended, and shows a level meter while the person talks.
- **One session:** `POST /api/voice/token` (consent, versions and device id as before), then the socket straight to
  Gemini (`BidiGenerateContentConstrained?access_token=`; the page's CSP already allows it). If it has not set up
  in 4 s, the same-origin relay `/api/voice/live` is used (and preferred from then on). The session is kept across
  turns and renewed in the background 8 minutes after it started, or at the next press after it closed.
- **Push-to-talk:** right thumbstick held, or the 2D "Hold to talk". A press sends `agent.context()` as untrusted
  grounding (a non-completing turn), `activityStart`, then every microphone chunk (no level gate); release sends
  `activityEnd`. Pressing while the model speaks stops its playback.
- **Replies:** 24 kHz audio is played gaplessly on the same context; transcripts go to the bubble; tool calls run
  through `agent.call` and are answered with the same ids.
- **Coach:** with "Voice tips" on (default), a mistake or hazard while idle becomes one short text turn, at most one
  every 20 s.
- **Local dev without the Worker:** when the token route answers 404 in a dev build, `VITE_GEMINI_API_KEY` from
  `xr/.env.local` (git-ignored) opens the plain v1beta endpoint with the same setup. A production build contains
  neither that endpoint nor the variable.
- The Worker locks `tools: [{ functionDeclarations }]` from `xr/src/agent/tools/declarations.json` into the token,
  and `TOOLS_VERSION` is `agent-v2` (v2 added `propose_edit`).

## Wiring another Gemini Live client

1. In the setup message send `tools: [{ functionDeclarations: agent.functionDeclarations() }]` (the Worker that mints
   the token can import `xr/src/agent/tools/declarations.json` to constrain it to the same list).
2. With each turn send `JSON.stringify(agent.context())` as untrusted grounding.
3. On `toolCall.functionCalls[]`, run `await agent.call(fc.name, fc.args)` for each and answer with
   `toolResponse: { functionResponses: [{ id: fc.id, name: fc.name, response: result }] }`.
4. Stream `serverContent.outputTranscription.text` to `agent.say(text)`, and on `turnComplete` call
   `agent.say('', { final: true })`. Stream `inputTranscription.text` to `agent.user(text)`.
5. Set `agent.state(...)` as the session moves (listening while the button is held, thinking, speaking).
6. Coach mode: `agent.observe(o => ...)` and send `o.text` as a text turn, rate limited by the client (for example
   at most one every 10 s, hazards excepted). Hazards are already shown in the headset without the model.

## Not done

No real Gemini session has driven it and it has not been tried on a headset; the voice checks use a fake socket and the browser's fake microphone. The scripted brain understands English
and German only (the Ask panel's chips in the other four languages get the "only a few questions" reply). No
controller button opens the Ask panel.
