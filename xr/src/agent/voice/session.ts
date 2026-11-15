/**
 * The Gemini Live session, transport only (no audio devices, no DOM), so it runs headless in tests with a fake socket.
 *
 *   connect   POST /api/voice/token (adult consent, versions, device id) -> a single-use token; open the socket
 *             straight to Gemini (`?access_token=`); if it is not open and set up within DIRECT_MS, fall back to the
 *             Worker's relay (/api/voice/live: `{authToken}`, then `proxyReady`). One session stays open across turns;
 *             it is renewed in the background REFRESH_MS after it started (when idle), or lazily at the next press.
 *   press     grounding (`agent.context()` as untrusted text, a non-completing turn), `activityStart`, then every audio
 *             chunk, with no level gate. Pressing while the model answers clears its playback (barge-in).
 *   release   `activityEnd`.
 *   replies   transcripts to `agent.user` / `agent.say` (deltas, final on `turnComplete`), audio to the player,
 *             `toolCall.functionCalls` to `agent.call` and back as `toolResponse.functionResponses` with the same ids.
 *   coach     a mistake or hazard observation while idle: one short text turn per COACH_MS at most.
 *   ask       a typed turn (a chip, the flat chat, the Ask panel, the code window): grounding and the words as one
 *             completed text turn; resolves once the answer is complete (voice/index.ts plugs it into the bridge).
 *
 * In a dev build with no Worker (the token route answers 404) `dev` opens the plain v1beta endpoint with the full setup;
 * voice/index.ts passes it only under `import.meta.env.DEV`, so a production build carries neither the URL nor a key.
 */
import { untrustedContext } from '../../../../deploy/cloudflare-xr/voice/client-core.mjs';
import type { AgentBridge } from '../bridge/bridge';
import type { Observation } from '../coach/coach';
import type { AgentState } from '../bubbles/model';

export const GEMINI_DIRECT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
export const DIRECT_MS = 4000;
export const SETUP_MS = 10_000;
export const REFRESH_MS = 8 * 60_000;
export const COACH_MS = 20_000;
/** The longest a typed turn waits for the model's answer before handing the bubble back. */
export const TEXT_MS = 30_000;
/** Audio kept while the session is still connecting at a press: about 6 s of 40 ms chunks. */
const BUFFER_CHUNKS = 150;

export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', fn: (e: { data?: unknown; code?: number }) => void): void;
}

export type VoiceStatus = 'off' | 'connecting' | 'ready' | 'talking' | 'answering' | 'failed' | 'quota' | 'unavailable';
export type VoicePath = 'direct' | 'relay' | 'dev';

export interface VoiceDeps {
  readonly fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  readonly socket: (url: string) => SocketLike;
  readonly agent: Pick<AgentBridge, 'context' | 'call' | 'user' | 'say' | 'state' | 'observe'>;
  readonly player: { play(base64Pcm24k: string): void; clear(): void; /** ms of audio still to play */ pending(): number };
  readonly now: () => number;
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (t: unknown) => void;
  /** The admission body's fixed fields. */
  readonly admission: { readonly deviceId: string; readonly consentVersion: string; readonly toolsVersion: string };
  readonly model: string;
  /** Same-origin relay URL (`ws(s)://host/api/voice/live`). */
  readonly relayUrl: string;
  /** Dev only: the unconstrained endpoint (with its key) and the full setup, used when the token route answers 404. */
  readonly dev?: { readonly url: string; readonly setup: Record<string, unknown> } | null;
  readonly onStatus?: (s: VoiceStatus) => void;
  readonly log?: (msg: string) => void;
}

export interface VoiceSession {
  readonly status: VoiceStatus;
  readonly path: VoicePath | null;
  connect(): Promise<boolean>;
  press(): void;
  release(): void;
  /** One chunk of 16 kHz mono PCM16 from the microphone. Sent only while talking. */
  audio(chunk: ArrayBuffer): void;
  setCoach(on: boolean): void;
  readonly coach: boolean;
  /** One typed turn. False when no session could be had (the caller answers some other way), else true once answered. */
  ask(text: string): Promise<boolean>;
  close(): void;
}

const b64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x4000) s += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  return btoa(s);
};

interface Live {
  socket: SocketLike;
  ready: boolean;
  startedAt: number;
}

export function createVoiceSession(d: VoiceDeps): VoiceSession {
  let status: VoiceStatus = 'off';
  let path: VoicePath | null = null;
  let preferRelay = false;
  let live: Live | null = null;
  let connecting: Promise<boolean> | null = null;
  let talking = false;
  let answering = false;
  let releasedEarly = false;
  let buffered: ArrayBuffer[] = [];
  let coachOn = true;
  let lastCoach = -Infinity;
  let refreshTimer: unknown = null;
  let idleTimer: unknown = null;
  let closed = false;
  let textDone: ((ok: boolean) => void) | null = null;
  let textTimer: unknown = null;
  /** Ends a waiting typed turn (its answer is complete, or the session went away). */
  const endText = () => {
    const done = textDone;
    textDone = null;
    d.clearTimeout(textTimer);
    done?.(true);
  };
  const log = (m: string) => d.log?.(`[voice] ${m}`);
  const set = (s: VoiceStatus) => {
    status = s;
    d.onStatus?.(s);
  };
  const agentState = (s: AgentState) => d.agent.state(s);
  const send = (msg: unknown) => {
    if (live && live.socket.readyState === 1) live.socket.send(JSON.stringify(msg));
  };

  const mint = async (): Promise<{ token: string } | { dev: true } | { error: VoiceStatus }> => {
    let res;
    try {
      res = await d.fetch('/api/voice/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...d.admission, adultConsent: true }),
      });
    } catch {
      return { error: 'failed' };
    }
    if (res.status === 404 && d.dev) return { dev: true };
    if (res.status === 404 || res.status === 503) return { error: 'unavailable' };
    if (res.status === 429) return { error: 'quota' };
    if (!res.ok) return { error: 'failed' };
    const grant = (await res.json().catch(() => null)) as { token?: unknown; model?: unknown } | null;
    if (!grant || typeof grant.token !== 'string') return { error: 'failed' };
    if (grant.model !== d.model) log(`model mismatch: ${String(grant.model)}`);
    return { token: grant.token };
  };

  /** Opens one socket; resolves with it once Gemini says setupComplete, or null after `ms`. */
  const open = (url: string, first: (s: SocketLike) => void, ms: number, onProxyReady?: (s: SocketLike) => void): Promise<Live | null> =>
    new Promise((resolve) => {
      const socket = d.socket(url);
      const l: Live = { socket, ready: false, startedAt: d.now() };
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        d.clearTimeout(timer);
        if (!ok) {
          try {
            socket.close(1000, 'fallback');
          } catch {
            /* closing a socket that never opened */
          }
        }
        resolve(ok ? l : null);
      };
      const timer = d.setTimeout(() => finish(false), ms);
      socket.addEventListener('open', () => first(socket));
      socket.addEventListener('message', (e) => {
        const msg = parse(e.data);
        if (!msg) return;
        if (msg.proxyReady && onProxyReady) return onProxyReady(socket);
        if (msg.setupComplete && !l.ready) {
          l.ready = true;
          finish(true);
          return;
        }
        if (l.ready && live === l) onMessage(msg);
      });
      socket.addEventListener('close', () => {
        finish(false);
        if (live === l) dropLive('closed');
      });
      socket.addEventListener('error', () => finish(false));
    });

  const setupMsg = () => JSON.stringify({ setup: { model: d.model } });

  const connectOnce = async (): Promise<boolean> => {
    set('connecting');
    agentState('connecting');
    const grant = await mint();
    if ('error' in grant) {
      set(grant.error);
      agentState('idle');
      return false;
    }
    let got: Live | null = null;
    if ('dev' in grant) {
      const dev = d.dev!;
      got = await open(dev.url, (s) => s.send(JSON.stringify({ setup: dev.setup })), SETUP_MS);
      if (got) path = 'dev';
    } else {
      if (!preferRelay) {
        let opened = false;
        got = await open(`${GEMINI_DIRECT}?access_token=${encodeURIComponent(grant.token)}`, (s) => {
          opened = true;
          s.send(setupMsg());
        }, DIRECT_MS);
        if (got) path = 'direct';
        else {
          preferRelay = true;
          log('direct socket did not set up in time: using the relay');
          // The token is single use: a socket that opened may have spent it.
          if (opened) {
            const again = await mint();
            if ('error' in again || 'dev' in again) {
              set('error' in again ? again.error : 'failed');
              agentState('idle');
              return false;
            }
            grant.token = again.token;
          }
        }
      }
      if (!got) {
        const token = grant.token;
        got = await open(d.relayUrl, (s) => s.send(JSON.stringify({ authToken: token })), SETUP_MS, (s) => s.send(setupMsg()));
        if (got) path = 'relay';
      }
    }
    if (!got || closed) {
      if (got) got.socket.close(1000, 'closed');
      set(closed ? 'off' : 'failed');
      agentState('idle');
      return false;
    }
    live = got;
    log(`session open via ${path}`);
    d.clearTimeout(refreshTimer);
    refreshTimer = d.setTimeout(refresh, REFRESH_MS);
    set(talking ? 'talking' : 'ready');
    agentState(talking ? 'listening' : 'idle');
    return true;
  };

  const connect = (): Promise<boolean> => {
    if (live?.ready && live.socket.readyState === 1) return Promise.resolve(true);
    if (!connecting) connecting = connectOnce().finally(() => (connecting = null));
    return connecting;
  };

  const dropLive = (why: string) => {
    const l = live;
    live = null;
    d.clearTimeout(refreshTimer);
    log(`session ${why}`);
    endText();
    if (l && l.socket.readyState <= 1) l.socket.close(1000, why);
    if (answering || talking) {
      answering = false;
      talking = false;
      agentState('idle');
    }
    if (!closed && status !== 'off') set('ready');
  };

  /** Renews the session before the token's ten minutes are up, when nobody is talking. */
  const refresh = () => {
    if (closed) return;
    if (talking || answering) {
      refreshTimer = d.setTimeout(refresh, 5000);
      return;
    }
    dropLive('renewing');
    void connect();
  };

  const toIdle = () => {
    d.clearTimeout(idleTimer);
    idleTimer = d.setTimeout(() => {
      if (talking) return;
      answering = false;
      agentState('idle');
      set(live ? 'ready' : status);
    }, Math.max(0, d.player.pending()) + 100);
  };

  let userOpen = false;
  /** The person's transcript ends where the answer begins. */
  const closeUser = () => {
    if (!userOpen) return;
    userOpen = false;
    d.agent.user('', { final: true });
  };
  const onMessage = (msg: Msg) => {
    const c = msg.serverContent;
    if (c) {
      if (c.interrupted) d.player.clear();
      if (c.inputTranscription?.text) {
        userOpen = true;
        d.agent.user(c.inputTranscription.text);
      }
      if (c.outputTranscription?.text) {
        closeUser();
        d.agent.say(c.outputTranscription.text);
      }
      for (const p of c.modelTurn?.parts ?? []) {
        if (p.inlineData?.data) {
          d.player.play(p.inlineData.data);
          if (!talking) agentState('speaking');
        }
      }
      if (c.turnComplete) {
        closeUser();
        d.agent.say('', { final: true });
        endText();
        toIdle();
      }
    }
    const calls = msg.toolCall?.functionCalls;
    if (calls?.length) void answerTools(calls);
  };

  const answerTools = async (calls: ReadonlyArray<{ id?: string; name: string; args?: Record<string, unknown> }>) => {
    const functionResponses = [];
    for (const fc of calls) {
      const response = await d.agent.call(fc.name, fc.args ?? {});
      functionResponses.push({ id: fc.id, name: fc.name, response });
    }
    send({ toolResponse: { functionResponses } });
  };

  const startTurn = () => {
    send({ clientContent: { turns: [{ role: 'user', parts: [{ text: untrustedContext(d.agent.context()) }] }], turnComplete: false } });
    send({ realtimeInput: { activityStart: {} } });
    for (const chunk of buffered) sendChunk(chunk);
    buffered = [];
    if (releasedEarly) endTurn();
  };
  const sendChunk = (chunk: ArrayBuffer) => send({ realtimeInput: { audio: { data: b64(chunk), mimeType: 'audio/pcm;rate=16000' } } });
  const endTurn = () => {
    releasedEarly = false;
    talking = false;
    answering = true;
    send({ realtimeInput: { activityEnd: {} } });
    set('answering');
    agentState('thinking');
  };

  const offObserve = d.agent.observe((o: Observation) => {
    if (!coachOn || closed || !live?.ready || talking || answering) return;
    if (o.kind !== 'hazard' && o.kind !== 'lab-mistake') return;
    if (d.now() - lastCoach < COACH_MS) return;
    lastCoach = d.now();
    answering = true;
    send({ clientContent: { turns: [{ role: 'user', parts: [{ text: `Observation: ${o.text}. If it helps, say one short sentence to the learner.` }] }], turnComplete: true } });
    agentState('thinking');
  });

  return {
    get status() {
      return status;
    },
    get path() {
      return path;
    },
    get coach() {
      return coachOn;
    },
    setCoach(on) {
      coachOn = on;
    },
    async ask(text) {
      if (closed || talking) return false;
      if (!(await connect()) || closed || talking || !live?.ready) return false;
      endText();
      d.player.clear();
      d.clearTimeout(idleTimer);
      answering = true;
      set('answering');
      agentState('thinking');
      const done = new Promise<boolean>((resolve) => {
        textDone = resolve;
        textTimer = d.setTimeout(endText, TEXT_MS);
      });
      send({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: untrustedContext(d.agent.context()) }, { text: String(text) }] }],
          turnComplete: true,
        },
      });
      return done;
    },
    connect: () => {
      closed = false;
      return connect();
    },
    press() {
      if (closed || talking) return;
      // Barge-in: the person speaks over the answer.
      d.player.clear();
      d.clearTimeout(idleTimer);
      talking = true;
      answering = false;
      releasedEarly = false;
      buffered = [];
      if (live?.ready && live.socket.readyState === 1) {
        set('talking');
        agentState('listening');
        startTurn();
        return;
      }
      void connect().then((ok) => {
        if (!ok) {
          talking = false;
          buffered = [];
          return;
        }
        if (talking || releasedEarly) {
          set('talking');
          agentState('listening');
          startTurn();
        }
      });
    },
    release() {
      if (!talking) return;
      if (live?.ready && live.socket.readyState === 1 && status === 'talking') return endTurn();
      // Still connecting: the turn is sent, and ended, once the session is up.
      releasedEarly = true;
    },
    audio(chunk) {
      if (!talking && !releasedEarly) return;
      if (live?.ready && status === 'talking') sendChunk(chunk);
      else if (buffered.length < BUFFER_CHUNKS) buffered.push(chunk);
    },
    close() {
      closed = true;
      talking = false;
      answering = false;
      d.clearTimeout(refreshTimer);
      d.clearTimeout(idleTimer);
      d.player.clear();
      endText();
      const l = live;
      live = null;
      if (l) l.socket.close(1000, 'voice off');
      offObserve();
      set('off');
      agentState('idle');
    },
  };
}

interface Msg {
  proxyReady?: boolean;
  setupComplete?: unknown;
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string } }> };
  };
  toolCall?: { functionCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }> };
}

function parse(data: unknown): Msg | null {
  try {
    const text = typeof data === 'string' ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : null;
    return text ? (JSON.parse(text) as Msg) : null;
  } catch {
    return null;
  }
}
