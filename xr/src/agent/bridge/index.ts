/**
 * The agent bridge on `window.iynkware.agent` (bridge.ts), with the scripted brain as the default (scripted.ts), and
 * a way to ask without voice: the menu row "Ask the assistant" opens a panel of suggestion chips, each a text turn.
 */
import { Euler, Vector3 } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { createLabPanel } from '../../lab/kit/panel';
import { say } from '../../lab/text';
import { TYPE } from '../../look/type';
import { value } from '../../ui/value';
import { agentOf, attachToWindow } from '../hub';
import { AGENT_TEXT } from '../text';
import { createBridge, type AgentBridge } from './bridge';
import { scriptedBrain } from './scripted';

const ASK = { widthM: 0.3, heightM: 0.34, distanceM: 0.55 } as const;

function mountAskPanel(app: XrApp, bridge: AgentBridge): Unsubscribe {
  const open = value(false);
  const panel = createLabPanel(app, { id: 'agent-ask', ...ASK });
  panel.group.name = 'agent:ask';
  panel.setVisible(false);
  app.world.scene.add(panel.group);
  const lang = () => app.settings.lang.value;
  const paint = () =>
    panel.draw(`${lang()}`, (ui) => {
      const { u, W } = ui;
      const pad = 20 * u;
      const inner = W - 2 * pad - 6 * u;
      ui.kicker(say(AGENT_TEXT.name, lang()), pad, 26 * u);
      ui.text(say(AGENT_TEXT.askTitle, lang()), pad, 40 * u, inner, { role: TYPE.title, maxLines: 1 });
      const h = 44 * u;
      let y = 88 * u;
      for (const [i, q] of AGENT_TEXT.questions.entries()) {
        const text = say(q, lang());
        ui.button(`q${i}`, pad, y, inner, h, text, () => {
          open.set(false);
          void bridge.ask(text);
        });
        y += h + 8 * u;
      }
      ui.button('close', pad, y + 4 * u, inner, h, say(AGENT_TEXT.close, lang()), () => open.set(false), { icon: 'close' });
    });
  const cam = new Vector3();
  const euler = new Euler(0, 0, 0, 'YXZ');
  const place = () => {
    const camera = app.world.camera;
    camera.getWorldPosition(cam);
    euler.setFromQuaternion(camera.getWorldQuaternion(panel.group.quaternion), 'YXZ');
    const a = euler.y - 0.5;
    const top = app.bench.benchTop.value.position[1];
    panel.group.position.set(cam.x - Math.sin(a) * 0.5, Math.max(cam.y - 0.22, top + 0.2), cam.z - Math.cos(a) * 0.5);
    panel.group.lookAt(cam);
  };
  const offOpen = open.subscribe((o) => {
    if (o) {
      paint();
      place();
    }
    panel.setVisible(o);
  });
  const offLang = app.settings.lang.subscribe(() => open.value && paint());
  const offMenu = app.shell.addMenuItem({ id: 'agent/ask', group: 'tools', label: AGENT_TEXT.menu, run: () => open.set(true) });
  return () => {
    offMenu();
    offLang();
    offOpen();
    panel.dispose();
  };
}

export const bridgeModule: FeatureModule = {
  id: 'agent/bridge',
  mount(app) {
    const hub = agentOf(app.world);
    if (!hub.tools || !hub.host) return () => undefined;
    const bridge = createBridge({ tools: hub.tools, host: hub.host, conversation: hub.conversation, coach: hub.coach, fallback: scriptedBrain() });
    hub.bridge = bridge;
    const detach = attachToWindow('agent', bridge);
    const offPanel = mountAskPanel(app, bridge);
    return () => {
      offPanel();
      detach();
      hub.bridge = null;
    };
  },
};
