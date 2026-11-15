/**
 * Space: the Paper room switch on the Look inside panel (the look kit's studio dome crossfades in inside the same
 * immersive-ar session, so nothing restarts), and hands that hide parts in passthrough and draw as ink in the paper room.
 */
import type { FeatureModule, XrApp } from '../../contracts/app';
import { onLookFrame } from '../../look/runner';
import { scaleControls } from '../kit/controls';
import { tr } from '../kit/text';
import { mountHandSkin, type HandVisual } from './hands';
import { SPACE_STRINGS as S } from './strings';

/** The Paper room row: a switch, latched while the paper room is on, hidden when the session is immersive-vr. */
export function paperRoomControl(scale: XrApp['scale']) {
  return {
    id: 'space/room',
    host: 'panel' as const,
    order: 4,
    icon: 'globe' as const,
    label: (lang: Parameters<typeof tr>[1]) => tr(S, lang, 'paperRoom'),
    latched: () => scale.room.value === 'paper',
    hidden: () => !scale.roomSwitchable.value,
    watch: [scale.room, scale.roomSwitchable],
    run: () => scale.setRoom(scale.room.value === 'paper' ? 'passthrough' : 'paper'),
  };
}

export const spaceModule: FeatureModule = {
  id: 'scale/space',
  mount(app) {
    const off = scaleControls(app).add(paperRoomControl(app.scale));

    const xr = app.world.input.xr;
    const out: HandVisual[] = [];
    const visuals = (): HandVisual[] => {
      out.length = 0;
      for (const side of ['left', 'right'] as const) {
        const h = xr.visualAdapters.hand[side].visual?.model;
        if (h) out.push({ kind: 'hand', model: h });
        const c = xr.visualAdapters.controller[side].visual?.model;
        if (c) out.push({ kind: 'controller', model: c });
      }
      return out;
    };
    const skin = mountHandSkin({ visuals, room: app.scale.room, onFrame: (fn) => onLookFrame(app.world, fn) });

    return () => {
      skin.dispose();
      off();
    };
  },
};
