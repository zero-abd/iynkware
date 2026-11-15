/**
 * The speech bubble: the agent's words near the person, on the lab's panel kit (one canvas, the look kit's paper
 * plate and ink, redrawn only when the conversation changes). It shows the state (listening, thinking, speaking), the
 * last two turns (the person's transcript too) above the turn being spoken, and reply chips that send their text back
 * as a turn. It sits below the eye line and to the left, follows the head's yaw lazily, stays above the bench top,
 * and hides after a while with nothing new.
 */
import { Euler, Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { createLabPanel } from '../../lab/kit/panel';
import { say } from '../../lab/text';
import { onLookFrame } from '../../look/runner';
import { MUTED, STATE } from '../../look/palette';
import { TYPE } from '../../look/type';
import { AGENT_TEXT } from '../text';
import type { AgentState, Conversation } from './model';

export const SPEECH = { widthM: 0.32, heightM: 0.17, distanceM: 0.55 } as const;
/** Where it sits from the eyes: this far ahead, this far down, turned this far left of where the head faces. */
const AHEAD = 0.55;
const DOWN = 0.16;
const LEFT_RAD = 0.6;
/** The head turns this far before the bubble follows, and it follows at this rate. */
const LAZY_RAD = 0.35;
const FOLLOW = 3;
/** Hidden after this long with nothing new while idle. */
export const FADE_MS = 20_000;

const DOT: Readonly<Record<AgentState, string>> = { connecting: MUTED, listening: STATE.good, thinking: STATE.warn, speaking: STATE.info, idle: MUTED };

export function mountSpeech(app: XrApp, conv: Conversation, send: (text: string) => void): Unsubscribe {
  const panel = createLabPanel(app, { id: 'agent-speech', ...SPEECH });
  panel.group.name = 'agent:speech';
  app.world.scene.add(panel.group);
  const lang = () => app.settings.lang.value;
  let quiet = 0;

  const paint = () => {
    panel.draw(`${conv.version}|${lang()}`, (ui) => {
      const { u, W, H } = ui;
      const pad = 20 * u;
      const inner = W - 2 * pad - 6 * u;
      ui.kicker(say(AGENT_TEXT.name, lang()), pad, 26 * u);
      const st = say(AGENT_TEXT.state[conv.state], lang());
      ui.g.fillStyle = DOT[conv.state];
      ui.g.beginPath();
      ui.g.arc(W - pad - 6 * u - 140 * u, 26 * u, 6 * u, 0, Math.PI * 2);
      ui.g.fill();
      ui.text(st, W - pad - 6 * u - 128 * u, 15 * u, 130 * u, { role: TYPE.caption, colour: MUTED, maxLines: 1 });
      const turns = conv.turns;
      const current = turns[turns.length - 1];
      let y = 44 * u;
      for (const t of turns.slice(-3, -1)) {
        const who = t.who === 'user' ? `${say(AGENT_TEXT.you, lang())}: ` : '';
        y = ui.text(who + t.text, pad, y, inner, { role: TYPE.caption, colour: MUTED, maxLines: 1 }) + 4 * u;
      }
      if (current) {
        const who = current.who === 'user' ? `${say(AGENT_TEXT.you, lang())}: ` : '';
        ui.text(who + current.text + (current.final ? '' : ' …'), pad, y + 2 * u, inner, { role: TYPE.body, maxLines: conv.suggestions.length ? 2 : 3 });
      }
      const chips = conv.suggestions;
      if (chips.length) {
        const h = 52 * u;
        const gap = 8 * u;
        const w = (inner - gap * (chips.length - 1)) / chips.length;
        chips.forEach((c, i) => ui.button(`chip${i}`, pad + i * (w + gap), H - pad - h - 6 * u, w, h, c, () => send(c)));
      }
    });
  };

  const offConv = conv.subscribe(() => {
    quiet = 0;
    paint();
  });
  paint();

  const cam = new Vector3();
  const euler = new Euler(0, 0, 0, 'YXZ');
  let yaw = Number.NaN;
  let following = false;
  const offFrame = onLookFrame(app.world, (dt) => {
    quiet += dt * 1000;
    const show = conv.turns.length > 0 && (conv.state !== 'idle' || quiet < FADE_MS);
    if (panel.group.visible !== show) panel.setVisible(show);
    if (!show) return;
    const camera = app.world.camera;
    camera.getWorldPosition(cam);
    euler.setFromQuaternion(camera.getWorldQuaternion(panel.group.quaternion), 'YXZ');
    const head = euler.y;
    if (Number.isNaN(yaw)) yaw = head;
    let d = Math.atan2(Math.sin(head - yaw), Math.cos(head - yaw));
    if (Math.abs(d) > LAZY_RAD) following = true;
    if (following) {
      yaw += d * (1 - Math.exp(-FOLLOW * Math.min(dt, 0.1)));
      d = Math.atan2(Math.sin(head - yaw), Math.cos(head - yaw));
      if (Math.abs(d) < 0.05) following = false;
    }
    const a = yaw + LEFT_RAD;
    const top = app.bench.benchTop.value.position[1];
    panel.group.position.set(cam.x - Math.sin(a) * AHEAD, Math.max(cam.y - DOWN, top + 0.2), cam.z - Math.cos(a) * AHEAD);
    panel.group.lookAt(cam);
  });

  return () => {
    offFrame();
    offConv();
    panel.dispose();
  };
}
