/**
 * Voice: Gemini Live in the app, on the agent bridge. Turned on once from a real activation (the menu row "Voice", an
 * XR select, or the small 2D button), after the adult consent and the disclosure: then one AudioContext, one
 * microphone track and one Live session stay up until it is turned off. The right thumbstick held (or the 2D "Hold to
 * talk" button) is push-to-talk. Transport: session.ts. Audio: audio.ts. The Worker's token route, consent, quota and
 * device checks are unchanged (deploy/cloudflare-xr/worker.js).
 */
import { Vector3 } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import {
  CONSENT_VERSION,
  GEMINI_MODEL,
  LOCKED_LIVE_CONFIG,
  TOOLS_VERSION,
} from '../../../../deploy/cloudflare-xr/voice-policy.mjs';
import { rawSetup } from '../../../../deploy/cloudflare-xr/voice/client-core.mjs';
import { createLabPanel } from '../../lab/kit/panel';
import { say } from '../../lab/text';
import { onLookFrame } from '../../look/runner';
import { TYPE } from '../../look/type';
import { value } from '../../ui/value';
import { agentOf } from '../hub';
import { createAudioIO, type AudioIO } from './audio';
import { createVoiceSession, type SocketLike, type VoiceDeps, type VoiceSession, type VoiceStatus } from './session';
import { VOICE_TEXT, type VoiceStatusKey } from './strings';

const DEVICE_KEY = 'iynkware:voice-device:v2';

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

type Seams = { __iynkwareVoiceSocket?: (url: string) => SocketLike; __iynkwareVoiceFetch?: VoiceDeps['fetch'] };

/** Dev only (no Worker): the plain endpoint with the key from xr/.env.local and the full setup. Never in a production build. */
function devConfig(): VoiceDeps['dev'] {
  const key = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!key) return null;
  return {
    url: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`,
    setup: rawSetup(GEMINI_MODEL, LOCKED_LIVE_CONFIG),
  };
}

const STATUS_NOTE: Partial<Record<VoiceStatus, VoiceStatusKey>> = {
  off: 'off',
  connecting: 'connecting',
  ready: 'ready',
  failed: 'failed',
  quota: 'quota',
  unavailable: 'unavailable',
};

export function mountVoice(app: XrApp): Unsubscribe {
  const hub = agentOf(app.world);
  const conv = hub.conversation;
  const lang = () => app.settings.lang.value;
  const on = value(false);
  const coach = value(true);
  let consented = false;
  let audio: AudioIO | null = null;
  let session: VoiceSession | null = null;
  let down = false;
  const WARN: ReadonlySet<VoiceStatusKey> = new Set(['micMuted', 'micEnded', 'suspended', 'blocked', 'quota', 'failed', 'unavailable']);
  const note = (k: VoiceStatusKey | null) => conv.setNote(k ? say(VOICE_TEXT.status[k], lang()) : '', !!k && WARN.has(k));
  const seams = (import.meta.env.DEV ? (globalThis as Seams) : {}) as Seams;

  const enable = () => {
    if (on.value || !hub.bridge) return;
    const bridge = hub.bridge;
    on.set(true);
    blockSelection(true);
    note('starting');
    let s: VoiceSession | null = null;
    const io = createAudioIO({
      onChunk: (pcm) => s?.audio(pcm),
      onIssue: (i) => {
        if (i === 'muted') note('micMuted');
        else if (i === 'ended') note('micEnded');
        else if (i === 'suspended') note('suspended');
        else if (i === 'unmuted' || i === 'running') note(s?.status === 'ready' ? 'ready' : null);
      },
    });
    audio = io;
    s = createVoiceSession({
      fetch: seams.__iynkwareVoiceFetch ?? ((url, init) => fetch(url, init)),
      socket: (url) => {
        const sock = seams.__iynkwareVoiceSocket ? seams.__iynkwareVoiceSocket(url) : new WebSocket(url);
        if (sock instanceof WebSocket) sock.binaryType = 'arraybuffer';
        return sock;
      },
      agent: bridge,
      player: io,
      now: () => performance.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      admission: { deviceId: deviceId(), consentVersion: CONSENT_VERSION, toolsVersion: TOOLS_VERSION },
      model: GEMINI_MODEL,
      relayUrl: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/voice/live`,
      dev: import.meta.env.DEV ? devConfig() : null,
      onStatus: (st) => {
        const k = STATUS_NOTE[st];
        if (st === 'talking' || st === 'answering') note(null);
        else if (k) note(k);
      },
      log: (m) => console.info(m),
    });
    s.setCoach(coach.value);
    session = s;
    if (import.meta.env.DEV) (globalThis as { __iynkwareVoice?: unknown }).__iynkwareVoice = { session: s, audio: io };
    io.start().then(
      () => {
        if (session === s) void s.connect();
      },
      (err) => {
        console.warn('[voice] microphone', err);
        disable();
        note('blocked');
      },
    );
  };

  const disable = () => {
    session?.close();
    session = null;
    audio?.stop();
    audio = null;
    down = false;
    blockSelection(false);
    if (on.value) on.set(false);
    note('off');
  };

  // Quest Browser selects the words under a pointer held down (the trigger on Talk, or the right stick over the 2D
  // page, where the browser keeps the controllers). While voice is on nothing on the page can be selected, and a turn
  // starts by clearing any selection.
  let blocking = false;
  const clearSelection = () => {
    if (typeof document !== 'undefined') document.getSelection()?.removeAllRanges();
  };
  const blockSelection = (block: boolean) => {
    blocking = block;
    if (typeof document === 'undefined') return;
    const root = document.documentElement.style;
    root.setProperty('user-select', block ? 'none' : '');
    root.setProperty('-webkit-user-select', block ? 'none' : '');
    if (block) clearSelection();
  };
  const noSelect = (e: Event) => {
    if (blocking) e.preventDefault();
  };
  if (typeof document !== 'undefined') document.addEventListener('selectstart', noSelect);

  const press = () => {
    if (!session) return;
    clearSelection();
    audio?.wake();
    session.press();
  };
  const release = () => session?.release();

  // ---- consent, in the world --------------------------------------------------------------------------------------
  const panel = createLabPanel(app, { id: 'agent-voice-consent', widthM: 0.36, heightM: 0.3, distanceM: 0.6 });
  panel.group.name = 'agent:voice-consent';
  panel.setVisible(false);
  app.world.scene.add(panel.group);
  const eye = new Vector3();
  const showConsent = (show: boolean) => {
    if (show) {
      panel.draw(`consent|${lang()}`, (ui) => {
        const { u, W, H } = ui;
        const pad = 22 * u;
        const inner = W - 2 * pad - 6 * u;
        ui.text(say(VOICE_TEXT.title, lang()), pad, pad, inner, { role: TYPE.title, maxLines: 1 });
        let y = ui.text(say(VOICE_TEXT.disclosure, lang()), pad, pad + 44 * u, inner, { maxLines: 5 }) + 10 * u;
        y = ui.text(say(VOICE_TEXT.consent, lang()), pad, y, inner, { maxLines: 3 });
        const h = 46 * u;
        const w = (inner - 10 * u) / 2;
        ui.button('agree', pad, H - pad - h - 6 * u, w, h, say(VOICE_TEXT.enable, lang()), () => {
          showConsent(false);
          consented = true;
          enable();
        }, { primary: true });
        ui.button('cancel', pad + w + 10 * u, H - pad - h - 6 * u, w, h, say(VOICE_TEXT.cancel, lang()), () => showConsent(false));
      });
      const cam = app.world.camera;
      cam.getWorldPosition(eye);
      const q = cam.getWorldQuaternion(panel.group.quaternion);
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
      panel.group.position.set(eye.x - Math.sin(yaw) * 0.55, Math.max(eye.y - 0.12, app.bench.benchTop.value.position[1] + 0.25), eye.z - Math.cos(yaw) * 0.55);
      panel.group.lookAt(eye);
    }
    panel.setVisible(show);
  };
  const toggle = () => {
    if (on.value) return disable();
    if (consented) return enable();
    showConsent(true);
  };

  // ---- the 2D controls, for the flat page --------------------------------------------------------------------------
  const dom = typeof document !== 'undefined' ? document.createElement('div') : null;
  const offDom: Array<() => void> = [];
  if (dom) {
    dom.id = 'agent-voice';
    dom.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:20;display:flex;flex-direction:column;gap:6px;align-items:flex-end;max-width:min(360px,calc(100vw - 24px));font:600 15px system-ui,sans-serif;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none';
    const btn = (id: string) => {
      const b = document.createElement('button');
      b.id = id;
      b.style.cssText = 'min-height:40px;padding:6px 14px;border:2px solid #231e16;border-radius:10px;background:#f2efe7;color:#231e16;font:inherit;touch-action:none';
      return b;
    };
    const card = document.createElement('div');
    card.style.cssText = 'display:none;padding:12px;border:2px solid #231e16;border-radius:12px;background:#f2efe7;color:#231e16;font-weight:400';
    const agree = btn('agent-voice-agree');
    const voice = btn('agent-voice-toggle');
    const talk = btn('agent-voice-talk');
    const paint = () => {
      voice.textContent = say(on.value ? VOICE_TEXT.disable : VOICE_TEXT.enable, lang());
      talk.textContent = say(VOICE_TEXT.talk, lang());
      talk.style.display = on.value ? '' : 'none';
      agree.textContent = say(VOICE_TEXT.consent, lang());
      card.firstChild!.textContent = say(VOICE_TEXT.disclosure, lang());
    };
    card.append(document.createElement('p'), agree);
    dom.append(card, talk, voice);
    document.body.append(dom);
    voice.addEventListener('click', () => {
      if (on.value) return disable();
      if (consented) return enable();
      card.style.display = card.style.display === 'none' ? 'block' : 'none';
    });
    agree.addEventListener('click', () => {
      card.style.display = 'none';
      consented = true;
      enable();
    });
    talk.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      talk.setPointerCapture(e.pointerId);
      press();
    });
    for (const t of ['pointerup', 'pointercancel'] as const) talk.addEventListener(t, () => release());
    // a long press is a turn, not a context menu
    talk.addEventListener('contextmenu', (e) => e.preventDefault());
    offDom.push(on.subscribe(paint), app.settings.lang.subscribe(paint));
    paint();
  }

  // ---- menu rows, the thumbstick, the meter ---------------------------------------------------------------------------
  const offMenu = app.shell.addMenuItem({ id: 'agent/voice', group: 'tools', label: VOICE_TEXT.menu, toggle: on, run: toggle });
  const offCoach = app.shell.addMenuItem({
    id: 'agent/voice-tips',
    group: 'tools',
    label: VOICE_TEXT.coachMenu,
    toggle: coach,
    run: () => {
      coach.set(!coach.value);
      session?.setCoach(coach.value);
    },
  });
  hub.micLevel = () => (session?.status === 'talking' && audio ? audio.level : null);
  const offFrame = onLookFrame(app.world, () => {
    if (!session) return;
    const pressed = app.input.button('right', 'stick').pressed;
    if (pressed && !down) {
      app.input.pulse('right', 0.35, 30);
      press();
    } else if (!pressed && down) {
      app.input.pulse('right', 0.18, 20);
      release();
    }
    down = pressed;
  });
  const onHide = () => disable();
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide);

  return () => {
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide);
    if (typeof document !== 'undefined') document.removeEventListener('selectstart', noSelect);
    offFrame();
    offMenu();
    offCoach();
    hub.micLevel = null;
    disable();
    for (const off of offDom) off();
    dom?.remove();
    panel.dispose();
  };
}

export const voiceModule: FeatureModule = {
  id: 'agent/voice',
  mount: (app) => mountVoice(app),
};
