# Experimental Quest voice service

`quest-voice-backend/` is an isolated Node 24 experiment for a bounded, turn-based Gemini Live voice loop:

`16 kHz PCM16 WAV upload → Gemini Live WebSocket → 24 kHz PCM16 WAV response`

It is not the canonical collaboration server in `server/`, a shared API contract, or a headset client. iynkware's
headset app is WebXR in the Quest browser. `xr/src/contracts/assistant.ts` now defines the co-builder's grounded
`BenchSnapshot`, plans and reviewable `CoBuildSession`; it explicitly places voice in front of that session.
`createApp` now mounts that service as `XrApp.assistant`, and the assistant feature supplies its in-world companion,
proposal card and "Build it with me" entry. A later contract PR still has to define its voice front end and expose the
existing `BuildGoal` `ask` path through `AssistantService`; this PR deliberately changes neither `xr/` nor its shared
contracts.

## Run locally

```bash
cd quest-voice-backend
cp .env.example .env
npm test
npm run dev
```

The default port is 8790 (`IYNK_VOICE_PORT`, with host-provided `PORT` as a fallback), so it does not collide with
the collaboration server on 8787. `GET /healthz` and `GET /readyz` are public; `GET /health` is an alias.

`POST /v1/voice/turn` requires `Authorization: Bearer <IYNK_VOICE_CLIENT_TOKEN>` and multipart fields `audio`,
`sessionId`, `scenario`, `objective`, `learnerLevel`, `currentStep`, `lastAction`, and `locale`. Here
`scenario` is an iynkware lab item such as a board, robotics bench, or drone.

These multipart context fields are experimental and must not become a second source of truth. The future adapter
should start from `AssistantService.snapshot()`: `BenchSnapshot` already carries the structured project, simulation,
findings and current lesson. Speech commands map to `CoBuildSession.accept`, `acceptAll`, `reject`, `undo` and `stop`;
free requests map to `BuildGoal` `ask`. The eventual voice contract decides how recent `input.onAny` interaction and
equipment mistake state are added without encoding identifiers in free-form learner text.

```bash
curl -X POST http://127.0.0.1:8790/v1/voice/turn \
  -H "Authorization: Bearer $IYNK_VOICE_CLIENT_TOKEN" \
  -H "Iynk-Client: iynkware-smoke/0.1.0" \
  -F audio=@speech.wav \
  -F sessionId=demo-session \
  -F scenario=pico-w \
  -F objective='Complete the current board lesson safely' \
  -F learnerLevel=beginner \
  -F currentStep=1 \
  -F lastAction='Selected the LED part' \
  -F locale=en-US
```

A successful turn returns the session ID, input transcript, response transcript, base64 PCM16 WAV, and `audio/wav`
media type. Errors use `{ "error": { "code", "message", "requestId" } }` and echo the request ID in
`X-Request-Id`. Invalid WAV format, sample rate, lesson context, duration, and session IDs have distinct 400 codes;
502 is reserved for Gemini failure. Delete `/v1/voice/sessions/{sessionId}` with the same token to clear memory.

## Bounds and access

Input is limited to 30 seconds of 16 kHz PCM16 and output to 4 MB. The service accepts at most 30 turns a minute,
300 turns in a rolling day, and two simultaneous Gemini turns by default. It reads and validates the whole request
before taking a Gemini concurrency slot. Client disconnects cancel upstream work.

The daily count and conversation history are process-local, so a restart clears them. The shared client token is
not user identity and is readable in any shipped browser client. These guards make local experiments bounded; they
are not sufficient for a public deployment. Before deployment, use the canonical server's device identity and a
durable per-device daily ledger, or another owner-approved access and cost model.

## Latency measurement

The service records structured timings for Gemini setup, first audio, full Gemini completion, and the whole HTTP
request. Successful responses also expose those three Gemini measurements in the `Server-Timing` header. Logs never
contain audio, transcripts, lesson context, tokens, or upstream exception text.

Independent requests may run concurrently up to the configured limit. A single response is already one streaming
Gemini Live generation, so splitting it into parallel text-to-speech segments would add calls and can make a short
tutor answer less coherent. The next material latency improvement is first-audio streaming in the future voice
transport contract; that belongs with its browser client rather than being invented in this service PR.

`GEMINI_LIVE_MODEL` and `GEMINI_LIVE_VOICE` default to `gemini-3.8-live` and `Puck`. Native audio infers the
spoken language; the requested locale remains a tutor-prompt constraint. Earlier transcripts are sent as prior
user/model turns, not inserted into the system instruction.

## Deployment decision is open

This repository contains no deploy definition for the voice service, and no cloud resource has been created. Issue
#180 records zero-abd's decisions about where it runs, who pays for Gemini use, and how public clients authenticate.
If a separate service is approved, its exact origin must be added to `connect-src` in
`deploy/cloudflare-xr/_headers` in its own PR, as [XR_DEPLOY.md](XR_DEPLOY.md) requires.

Never commit `GEMINI_API_KEY` or `IYNK_VOICE_CLIENT_TOKEN`.
