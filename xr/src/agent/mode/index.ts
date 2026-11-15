/**
 * The companion's mode, Assist or Build (`hub.mode`): a small button floating over the bunny shows it and flips it,
 * and the Tools menu has it as a switch ("Assistant can build"). In Assist the tools that change things refuse
 * (catalog.ts `CHANGES`); the model is told the mode with every turn (`look().companion`). A notice says what changed.
 */
import { Vector3 } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { companionOf } from '../../assistant/presence';
import { onLookFrame } from '../../look/runner';
import { say } from '../../lab/text';
import { shellButton } from '../../shell/kit';
import { value } from '../../ui/value';
import { agentOf } from '../hub';
import { AGENT_TEXT } from '../text';

/** Above the bunny's head, metres (table frame). */
const LIFT = 0.055;
const W = 0.07;
const H = 0.026;
const READ_AT = 0.6;

export function mountMode(app: XrApp): Unsubscribe {
  const hub = agentOf(app.world);
  const lang = () => app.settings.lang.value;
  const building = value(hub.mode.value === 'build');
  const flip = () => hub.mode.set(hub.mode.value === 'build' ? 'assist' : 'build');

  const look = () => {
    const b = hub.mode.value === 'build';
    return { label: say(b ? AGENT_TEXT.mode.build : AGENT_TEXT.mode.assist, lang()), icon: b ? ('wrench' as const) : ('lightbulb' as const), selected: b };
  };
  const button = shellButton(app, { id: 'agent/mode', w: W, h: H, distanceM: READ_AT, poke: true, onSelect: flip }, look());
  button.group.name = 'agent:mode';
  app.bench.table.add(button.group);

  const offMode = hub.mode.subscribe((m) => {
    building.set(m === 'build');
    button.set(look());
    app.shell.notify({ id: 'agent/mode', tone: 'info', text: m === 'build' ? AGENT_TEXT.mode.buildOn : AGENT_TEXT.mode.assistOn, ms: 3500 });
  });
  const offLang = app.settings.lang.subscribe(() => button.set(look()));
  const offMenu = app.shell.addMenuItem({ id: 'agent/mode', group: 'tools', label: AGENT_TEXT.mode.menu, toggle: building, run: flip });

  const cam = new Vector3();
  const offFrame = onLookFrame(app.world, () => {
    const c = companionOf(app.world);
    const show = !!c && c.group.visible;
    button.group.visible = show;
    if (!c || !show) return;
    button.group.position.set(c.position.x, c.position.y + LIFT, c.position.z);
    app.world.camera.getWorldPosition(cam);
    button.group.lookAt(cam);
  });

  return () => {
    offFrame();
    offMenu();
    offLang();
    offMode();
    button.group.removeFromParent();
    button.dispose();
  };
}

export const modeModule: FeatureModule = { id: 'agent/mode', mount: (app) => mountMode(app) };
