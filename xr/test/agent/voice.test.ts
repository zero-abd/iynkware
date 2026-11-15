import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { l6Problems } from '../../src/lab/text';
import type { Observation } from '../../src/agent/coach/coach';
import { COACH_MS, createVoiceSession, DIRECT_MS, GEMINI_DIRECT, type SocketLike, type VoiceDeps } from '../../src/agent/voice/session';
import { VOICE_TEXT } from '../../src/agent/voice/strings';
import { CONSENT_VERSION, GEMINI_MODEL, TOOLS_VERSION } from '../../../deploy/cloudflare-xr/voice-policy.mjs';

type Fn = (e: { data?: unknown; code?: number }) => void;

/** A socket the test plays Gemini (or the relay) on. */
class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  private fns: Record<string, Fn[]> = {};
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.emit('close', {});
  }
  addEventListener(type: string, fn: Fn) {
    (this.fns[type] ??= []).push(fn);
  }
  emit(type: string, e: { data?: unknown }) {
    for (const fn of this.fns[type] ?? []) fn(e);
  }
  open() {
    this.readyState = 1;
    this.emit('open', {});
  }
  server(msg: unknown) {
    this.emit('message', { data: JSON.stringify(msg) });
  }
  kinds() {
    return this.sent.map((m) => Object.keys(m)[0] === 'realtimeInput' ? `rt:${Object.keys(m.realtimeInput as object)[0]}` : Object.keys(m)[0]);
  }
}

function harness(opts: { directOpens?: boolean } = {}) {
  let t = 0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let ids = 0;
  const sockets: FakeSocket[] = [];
  const said: string[] = [];
  const heard: string[] = [];
  const states: string[] = [];
  const calls: Array<{ name: string; args: unknown }> = [];
  const observers: Array<(o: Observation) => void> = [];
  const player = { played: 0, cleared: 0, play() { this.played++; }, clear() { this.cleared++; }, pending: () => 0 };
  let mints = 0;
  const deps: VoiceDeps = {
    fetch: async (url, init) => {
      mints++;
      expect(url).toBe('/api/voice/token');
      expect(JSON.parse(init.body)).toMatchObject({ adultConsent: true, consentVersion: CONSENT_VERSION, toolsVersion: TOOLS_VERSION });
      return { ok: true, status: 200, json: async () => ({ token: `auth_tokens/tok${mints}xxxxxxxxxxxxxxxx`, model: GEMINI_MODEL }) };
    },
    socket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      const direct = url.startsWith(GEMINI_DIRECT);
      if (!direct || opts.directOpens !== false) queueMicrotask(() => s.open());
      return s;
    },
    agent: {
      context: () => ({ mode: 'lab', items: ['bunsen-burner'] }),
      call: async (name, args) => {
        calls.push({ name, args });
        return { ok: true, id: 'callout_1' };
      },
      user: (text, o) => void heard.push(`${text}${o?.final ? '|' : ''}`),
      say: (text, o) => void said.push(`${text}${o?.final ? '|' : ''}`),
      state: (s) => void states.push(s),
      observe: (fn) => {
        observers.push(fn);
        return () => undefined;
      },
    },
    player,
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = ++ids;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    admission: { deviceId: '7b36b820-f1dc-4c71-b890-0e5adab213d6', consentVersion: CONSENT_VERSION, toolsVersion: TOOLS_VERSION },
    model: GEMINI_MODEL,
    relayUrl: 'ws://localhost/api/voice/live',
  };
  const advance = async (ms: number) => {
    t += ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > t) break;
      timers.shift();
      next.fn();
      await flush();
    }
    await flush();
  };
  const session = createVoiceSession(deps);
  return { session, sockets, said, heard, states, calls, player, observers, advance, mints: () => mints };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** Plays Gemini's setup and a whole answer on `s`: transcripts, a tool call, audio, turnComplete. */
function answer(s: FakeSocket, id: string) {
  s.server({ serverContent: { inputTranscription: { text: 'where is ' } } });
  s.server({ serverContent: { inputTranscription: { text: 'the burner' } } });
  s.server({ toolCall: { functionCalls: [{ id, name: 'point_at', args: { target: 'burner', text: 'This one' } }] } });
  s.server({ serverContent: { outputTranscription: { text: 'It is ' } } });
  s.server({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAAA' } }] } } });
  s.server({ serverContent: { outputTranscription: { text: 'here.' } } });
  s.server({ serverContent: { turnComplete: true } });
}

describe('voice session', () => {
  it('one direct session across two turns: grounding, activity, every chunk, tool responses with matching ids', async () => {
    const h = harness();
    const connected = h.session.connect();
    await flush();
    const s = h.sockets[0]!;
    expect(s.url.startsWith(`${GEMINI_DIRECT}?access_token=`)).toBe(true);
    expect(s.sent[0]).toEqual({ setup: { model: GEMINI_MODEL } });
    s.server({ setupComplete: {} });
    expect(await connected).toBe(true);
    expect(h.session.path).toBe('direct');

    for (const [turn, id] of [[1, 'fc-1'], [2, 'fc-2']] as const) {
      s.sent.length = 0;
      h.session.press();
      // Silence and speech alike are sent: there is no level gate.
      h.session.audio(new Int16Array(640).buffer);
      h.session.audio(new Int16Array(640).fill(3).buffer);
      h.session.release();
      expect(s.kinds()).toEqual(['clientContent', 'rt:activityStart', 'rt:audio', 'rt:audio', 'rt:activityEnd']);
      const grounding = s.sent[0]!.clientContent as { turns: Array<{ parts: Array<{ text: string }> }>; turnComplete: boolean };
      expect(grounding.turnComplete).toBe(false);
      expect(grounding.turns[0]!.parts[0]!.text).toMatch(/^UNTRUSTED_BENCH_CONTEXT\n.*bunsen-burner/);
      answer(s, id);
      await h.advance(200);
      const resp = s.sent.find((m) => m.toolResponse) as { toolResponse: { functionResponses: Array<{ id: string; name: string; response: unknown }> } };
      expect(resp.toolResponse.functionResponses).toEqual([{ id, name: 'point_at', response: { ok: true, id: 'callout_1' } }]);
      expect(h.calls.at(-1)).toEqual({ name: 'point_at', args: { target: 'burner', text: 'This one' } });
      expect(turn).toBeGreaterThan(0);
    }
    expect(h.sockets).toHaveLength(1);
    expect(h.mints()).toBe(1);
    expect(h.said.join('')).toBe('It is here.|It is here.|');
    expect(h.heard.filter((x) => !x.startsWith('|')).join('')).toContain('where is the burner');
    expect(h.player.played).toBe(2);
    expect(h.states).toContain('listening');
    expect(h.states).toContain('thinking');
    expect(h.states.at(-1)).toBe('idle');
  });

  it('barge-in: pressing while the model answers clears its playback', async () => {
    const h = harness();
    const c = h.session.connect();
    await flush();
    h.sockets[0]!.server({ setupComplete: {} });
    await c;
    h.session.press();
    h.session.release();
    const cleared = h.player.cleared;
    h.sockets[0]!.server({ serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AAAA' } }] } } });
    h.session.press();
    expect(h.player.cleared).toBe(cleared + 1);
    expect(h.session.status).toBe('talking');
  });

  it('a typed turn goes to the live session as one completed text turn and waits for the answer', async () => {
    const h = harness();
    const c = h.session.connect();
    await flush();
    const s = h.sockets[0]!;
    s.server({ setupComplete: {} });
    await c;
    s.sent.length = 0;
    let answered: boolean | null = null;
    void h.session.ask('Help me build my own circuit').then((ok) => (answered = ok));
    await flush();
    expect(s.kinds()).toEqual(['clientContent']);
    const turn = s.sent[0]!.clientContent as { turns: Array<{ role: string; parts: Array<{ text: string }> }>; turnComplete: boolean };
    expect(turn.turnComplete).toBe(true);
    expect(turn.turns[0]!.parts[0]!.text).toMatch(/^UNTRUSTED_BENCH_CONTEXT\n/);
    expect(turn.turns[0]!.parts[1]!.text).toBe('Help me build my own circuit');
    expect(h.session.status).toBe('answering');
    expect(answered).toBeNull();
    s.server({ toolCall: { functionCalls: [{ id: 'fc-t', name: 'go_to', args: { where: 'new project' } }] } });
    s.server({ serverContent: { outputTranscription: { text: 'Here is an empty bench.' } } });
    s.server({ serverContent: { turnComplete: true } });
    await h.advance(200);
    expect(answered).toBe(true);
    expect(h.calls.at(-1)).toEqual({ name: 'go_to', args: { where: 'new project' } });
    expect(h.said.join('')).toBe('Here is an empty bench.|');
    expect(h.session.status).toBe('ready');
  });

  it('a typed turn reports false when no session can be had, so the scripted brain answers', async () => {
    const h = harness();
    h.session.close();
    expect(await h.session.ask('hello')).toBe(false);
    expect(h.sockets).toHaveLength(0);
  });

  it('falls back to the relay when the direct socket does not open in time', async () => {
    const h = harness({ directOpens: false });
    const c = h.session.connect();
    await flush();
    expect(h.sockets[0]!.url.startsWith(GEMINI_DIRECT)).toBe(true);
    await h.advance(DIRECT_MS + 10);
    const relay = h.sockets[1]!;
    expect(relay.url).toBe('ws://localhost/api/voice/live');
    expect(relay.sent[0]).toEqual({ authToken: expect.stringContaining('auth_tokens/tok1') });
    relay.server({ proxyReady: true });
    expect(relay.sent[1]).toEqual({ setup: { model: GEMINI_MODEL } });
    relay.server({ setupComplete: {} });
    expect(await c).toBe(true);
    expect(h.session.path).toBe('relay');
    // A press before connect: audio is kept and sent once the session is up.
    h.session.press();
    expect(relay.kinds().slice(-2)).toEqual(['clientContent', 'rt:activityStart']);
  });

  it('a press with no session connects lazily and sends what was said meanwhile', async () => {
    const h = harness();
    h.session.press();
    h.session.audio(new Int16Array(640).buffer);
    h.session.release();
    await flush();
    const s = h.sockets[0]!;
    s.server({ setupComplete: {} });
    await flush();
    expect(s.kinds()).toEqual(['setup', 'clientContent', 'rt:activityStart', 'rt:audio', 'rt:activityEnd']);
  });

  it('coach: a mistake or hazard while idle becomes one text turn per 20 s at most', async () => {
    const h = harness();
    const c = h.session.connect();
    await flush();
    const s = h.sockets[0]!;
    s.server({ setupComplete: {} });
    await c;
    const obs = (kind: Observation['kind'], text: string): Observation => ({ at: 0, kind, text, refs: [] });
    const coachTurns = () => s.sent.filter((m) => (m.clientContent as { turnComplete?: boolean } | undefined)?.turnComplete === true);
    h.observers[0]!(obs('lab-action', 'burner: gas'));
    expect(coachTurns()).toHaveLength(0);
    h.observers[0]!(obs('hazard', 'gas on and unlit'));
    expect(coachTurns()).toHaveLength(1);
    expect(JSON.stringify(coachTurns()[0])).toContain('Observation: gas on and unlit. If it helps, say one short sentence to the learner.');
    s.server({ serverContent: { turnComplete: true } });
    await h.advance(1000);
    h.observers[0]!(obs('lab-mistake', 'loop dirty'));
    expect(coachTurns()).toHaveLength(1);
    await h.advance(COACH_MS);
    h.observers[0]!(obs('lab-mistake', 'loop dirty'));
    expect(coachTurns()).toHaveLength(2);
    h.session.setCoach(false);
    s.server({ serverContent: { turnComplete: true } });
    await h.advance(COACH_MS + 1000);
    h.observers[0]!(obs('hazard', 'again'));
    expect(coachTurns()).toHaveLength(2);
  });

  it('voice strings in six languages', () => {
    expect(l6Problems(VOICE_TEXT)).toEqual([]);
  });

  it('the dev key path is only reachable in a dev build', () => {
    const src = readFileSync(new URL('../../src/agent/voice/index.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/dev: import\.meta\.env\.DEV \? devConfig\(\) : null/);
    expect(src.match(/VITE_GEMINI_API_KEY/g)).toHaveLength(1);
  });
});
