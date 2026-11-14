/**
 * The LED view: the meshes of the asset's emissive channel (`led:<part>`, sidecar `channels`) glow with the LED's colour
 * while lit, scaled by brightness; burnt goes dark grey. The channel's materials are the placement's own.
 */
import { Color, type Mesh, type MeshStandardMaterial } from '@iwsdk/core';
import type { PartHealth, PartState, PartView, PartViewFactory } from '../../contracts/part-view';

export const LED_COLOURS: Record<string, number> = {
  red: 0xff2a1a, green: 0x2cff5a, yellow: 0xffd21a, blue: 0x2a6bff, white: 0xfff6e0, orange: 0xff8a1a,
};

export const ledView: PartViewFactory = (ctx): PartView => {
  const channel = ctx.asset.sidecar.channels.find((c) => c.kind === 'emissive' && c.id.startsWith('led:'));
  const node = channel?.nodes[0];
  const mesh = node === undefined ? undefined : (ctx.object.getObjectByName(node) as Mesh | undefined);
  const mat = mesh?.material as MeshStandardMaterial | undefined;
  const name = typeof ctx.params.color === 'string' ? ctx.params.color : 'red';
  const glow = new Color(LED_COLOURS[name] ?? LED_COLOURS.red);
  const base = mat?.color.clone() ?? new Color(0xb02018);
  if (mat) mat.color.copy(glow).multiplyScalar(0.55);
  let health: PartHealth = 'ok';
  const dark = () => {
    if (!mat) return;
    mat.emissive.setRGB(0, 0, 0);
    mat.emissiveIntensity = 0;
  };
  return {
    partId: ctx.partId,
    update(state: PartState) {
      if (!mat || state.kind !== 'led' || health === 'burnt') return;
      if (state.lit) {
        mat.emissive.copy(glow);
        mat.emissiveIntensity = 0.6 + 2.4 * Math.max(0, Math.min(1, state.brightness));
      } else dark();
    },
    health(next) {
      health = next;
      if (!mat) return;
      if (next === 'burnt') {
        dark();
        mat.color.setRGB(0.18, 0.17, 0.16);
      } else if (next === 'hot') mat.color.setRGB(1, 0.55, 0.2);
      else mat.color.copy(glow).multiplyScalar(0.55);
    },
    reset() {
      health = 'ok';
      dark();
      if (mat) mat.color.copy(glow).multiplyScalar(0.55);
    },
    dispose() {
      if (mat) mat.color.copy(base);
    },
  };
};
