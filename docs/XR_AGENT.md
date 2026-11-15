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
`clear_callouts`. Act: `propose_build { request, template? }`, `accept_step { all? }`, `reject_step`, `undo_step`,
`open_lab { lab }`, `leave_lab`, `start_experiment { id, mode? }`, `set_lab_control { item, action, value? }`,
`request_item { name }`, `next_step_hint`. Schemas are in `tools/declarations.json`.

- The project changes only through the co-builder: `propose_build` starts "Build it with me" (a ghosted step), and
  only `accept_step` performs it, authored and undoable. `AssistantService` has no public free-text `ask` yet, so
  `propose_build` builds templates only (Blink and the other board templates) and returns `ok: false` for a free
  request.
- Lab tools go through the lab context and `LabStore.apply`, so the tutor and the run log see them.
- In an exam `set_lab_control`, `request_item` and `next_step_hint` refuse.
- `point_at` targets: a lab item id, kind or name when a lab is open; else a bench refdes (`RES1`), a pin
  (`LED1.A`) or a part word (`resistor`, `board`). An unknown target returns close matches.

## Wiring a Gemini Live client

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

No real Gemini session has driven it and it has not been tried on a headset. The scripted brain understands English
and German only (the Ask panel's chips in the other four languages get the "only a few questions" reply). No
controller button opens the Ask panel.
