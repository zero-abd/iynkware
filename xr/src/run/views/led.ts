/**
 * The LED view: the meshes of the asset's emissive channel (`led:<part>`, sidecar `channels`) glow with the LED's colour
 * while lit, scaled by brightness; burnt goes dark grey. The channel's materials are the placement's own.
 *
 * A part with several lamps (an RGB LED) has one lens: the lit lamps' colours mix into the one glow. A lamp's colour is
 * its pin's name (`R`, `G`, `B`, or `red`...) and, for a pin the table does not know, the channel's `color`.
 */
import { Color, type Mesh, type MeshStandardMaterial } from '@iwsdk/core';
import type { PartHealth, PartState, PartView, PartViewFactory } from '../../contracts/part-view';
import { LED_GLOW, hexNum } from '../../look/palette';

/** The glow colour a lamp pin names, as a `LED_GLOW` key: `R` and `red` are red, `G` and `green` green, `B` and `blue` blue. */
const LAMP_KEY: Readonly<Record<string, string>> = {
  r: 'red', red: 'red', g: 'green', green: 'green', b: 'blue', blue: 'blue',
  y: 'yellow', yellow: 'yellow', w: 'white', white: 'white', o: 'orange', orange: 'orange',
};

const rgb = (hex: string): [number, number, number] => {
  const n = hexNum(hex);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** The `LED_GLOW` hex a lamp's pin name stands for, if the table knows it. */
export function lampColour(pin: string): string | undefined {
  const key = LAMP_KEY[pin.trim().toLowerCase()];
  return key === undefined ? undefined : LED_GLOW[key];
}

/**
 * The colour of several lit lamps seen as one light: their colours averaged, then brought up to full brightness so two
 * lamps do not look dimmer than one (red and green read yellow, all three read white). Empty gives `fallback`.
 */
export function mixLamps(colours: readonly string[], fallback: string): [number, number, number] {
  if (colours.length === 0) return rgb(fallback);
  const sum: [number, number, number] = [0, 0, 0];
  for (const c of colours) {
    const [r, g, b] = rgb(c);
    sum[0] += r;
    sum[1] += g;
    sum[2] += b;
  }
  const peak = Math.max(sum[0], sum[1], sum[2]);
  return peak === 0 ? rgb(fallback) : [sum[0] / peak, sum[1] / peak, sum[2] / peak];
}

/** The colours of the lit lamps a state names, skipping pins the table does not know. */
export function litColours(lamps: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const pin of lamps ?? []) {
    const c = lampColour(pin);
    if (c !== undefined) out.push(c);
  }
  return out;
}

export const ledView: PartViewFactory = (ctx): PartView => {
  const channel = ctx.asset.sidecar.channels.find((c) => c.kind === 'emissive' && c.id.startsWith('led:'));
  const node = channel?.nodes[0];
  const mesh = node === undefined ? undefined : (ctx.object.getObjectByName(node) as Mesh | undefined);
  const mat = mesh?.material as MeshStandardMaterial | undefined;
  const name = typeof ctx.params.color === 'string' ? ctx.params.color : undefined;
  // The part's own colour: its `color` parameter, else the channel's lit colour, else red.
  const own = (name === undefined ? undefined : LED_GLOW[name]) ?? channel?.color ?? LED_GLOW.red!;
  const ownGlow = new Color(hexNum(own));
  const glow = new Color(ownGlow);
  const base = mat?.color.clone() ?? new Color(0xb02018);
  let health: PartHealth = 'ok';
  let lampKey = '';
  const unlit = () => {
    if (mat) mat.color.copy(glow).multiplyScalar(0.55);
  };
  if (mat) unlit();
  const dark = () => {
    if (!mat) return;
    mat.emissive.setRGB(0, 0, 0);
    mat.emissiveIntensity = 0;
  };
  /** The glow for the lit lamps: the mix of the ones the table knows, else the part's own colour. */
  const mix = (lamps: readonly string[] | undefined) => {
    const key = (lamps ?? []).join(',');
    if (key === lampKey) return;
    lampKey = key;
    const colours = litColours(lamps);
    if (colours.length === 0) glow.copy(ownGlow);
    else glow.setRGB(...mixLamps(colours, own));
  };
  return {
    partId: ctx.partId,
    update(state: PartState) {
      if (!mat || state.kind !== 'led' || health === 'burnt') return;
      if (state.lit) {
        mix(state.lamps);
        mat.emissive.copy(glow);
        mat.color.copy(glow).multiplyScalar(0.55);
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
      lampKey = '';
      glow.copy(ownGlow);
      dark();
      unlit();
    },
    dispose() {
      if (mat) mat.color.copy(base);
    },
  };
};
