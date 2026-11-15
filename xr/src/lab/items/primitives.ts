/**
 * The placeholder look for lab items, until their converted glTF lands: each kind drawn from a few primitives at its
 * real size (the figures' `foot`, anchors and channel pivots), in the look kit's ink style when the ink material is in
 * the tree (three bands from the palette, an ink silhouette), else plain lit colours. Glass is see-through, lights and
 * flames are flat glowing colours, readouts are canvas text. Clearly a stand-in: the figures carry the real drawing.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Material,
  type Object3D,
} from '@iwsdk/core';
import { paintBands, smoothOutlineNormals, type InkKit } from '../../look/ink';
import { BANDS, bandsOf, INK, type Bands } from '../../look/palette';
import { FONT_MONO } from '../../look/type';
import { textLabel, type TextLabel } from '../../ui/text';
import { ACID_AT, dishX, LOOP_REST, SALT_DISHES } from './controls';
import type { ChannelValue, ItemVisual, ItemVisualSource } from './visual';

const DEG = Math.PI / 180;
const CLEAR = '#cfe6ee';

/** Builds meshes for one placement and remembers what to dispose. */
class Painter {
  readonly owned: Array<{ dispose(): void }> = [];
  constructor(private readonly kit: InkKit | null) {}

  body(geometry: BufferGeometry, bands: Bands, at?: readonly [number, number, number], name?: string): Mesh {
    let mesh: Mesh;
    if (this.kit) {
      paintBands(geometry, bands);
      smoothOutlineNormals(geometry, 1e-5);
      mesh = new Mesh(geometry, this.kit.body(geometry));
      this.kit.outline(mesh, 2.2);
    } else {
      mesh = new Mesh(geometry, new MeshLambertMaterial({ color: bands.l }));
    }
    this.track(mesh);
    if (at) mesh.position.set(at[0], at[1], at[2]);
    if (name) mesh.name = name;
    return mesh;
  }

  /** A flat colour that reads as light: LEDs, flames, glowing rings. */
  glow(geometry: BufferGeometry, colour: string, opts: { opacity?: number; at?: readonly [number, number, number]; name?: string } = {}): Mesh {
    const material = new MeshBasicMaterial({ color: colour, transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1, depthWrite: (opts.opacity ?? 1) >= 1, toneMapped: false });
    const mesh = new Mesh(geometry, material);
    this.track(mesh);
    if (opts.at) mesh.position.set(opts.at[0], opts.at[1], opts.at[2]);
    if (opts.name) mesh.name = opts.name;
    return mesh;
  }

  /** Clear glass: a faint tint, drawn after what is inside it. */
  glass(geometry: BufferGeometry, at?: readonly [number, number, number]): Mesh {
    const mesh = new Mesh(geometry, new MeshLambertMaterial({ color: CLEAR, transparent: true, opacity: 0.28, depthWrite: false }));
    mesh.renderOrder = 2;
    this.track(mesh);
    if (at) mesh.position.set(at[0], at[1], at[2]);
    return mesh;
  }

  text(w: number, h: number, opts: { fg?: string; bg?: string; mono?: boolean } = {}): TextLabel {
    const l = textLabel(w, h, { px: 7000, role: opts.mono ? 'code' : 'label', bg: opts.bg, fg: opts.fg });
    l.mesh.raycast = () => undefined;
    this.owned.push(l);
    return l;
  }

  track(mesh: Mesh): void {
    this.owned.push(mesh.geometry);
    const m = mesh.material as Material | Material[];
    for (const x of Array.isArray(m) ? m : [m]) this.owned.push(x);
  }

  dispose(): void {
    for (const o of this.owned.splice(0)) o.dispose();
  }
}

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
const cyl = (r: number, h: number, seg = 20, rTop = r) => new CylinderGeometry(rTop, r, h, seg);
/** A knob facing +z: a cylinder with a pointer bar, under a group that turns about z. */
function knob(p: Painter, at: readonly [number, number, number], r = 0.011, name?: string): Group {
  const g = new Group();
  g.position.set(at[0], at[1], at[2]);
  if (name) g.name = name;
  const k = p.body(cyl(r, 0.012, 18), BANDS.blackPlastic);
  k.rotation.x = Math.PI / 2;
  g.add(k);
  const mark = p.glow(box(0.0016, r * 0.8, 0.002), '#f6f4ea', { at: [0, r * 0.45, 0.0065] });
  g.add(mark);
  return g;
}
const screen = (p: Painter, parent: Object3D, at: readonly [number, number, number], w: number, h: number, fg: string): TextLabel => {
  const t = p.text(w, h, { fg, bg: '#1d1b19', mono: true });
  t.mesh.position.set(at[0], at[1], at[2]);
  parent.add(t.mesh);
  return t;
};
const lamp = (p: Painter, parent: Object3D, at: readonly [number, number, number], on: string): { set(level: number): void } => {
  const off = new Color('#3a3632');
  const lit = new Color(on);
  const m = p.glow(new SphereGeometry(0.0035, 10, 8), '#3a3632', { at });
  parent.add(m);
  return { set: (level) => (m.material as MeshBasicMaterial).color.copy(level > 0.5 ? lit : off) };
};

type Build = (p: Painter, root: Group, label?: string) => { set(ch: string, v: ChannelValue): void; update?(dt: number): void; nodes?: Record<string, Object3D> };

const BUILDERS: Readonly<Record<string, Build>> = {
  'bunsen-burner'(p, root) {
    const X = 0.055;
    root.add(p.body(cyl(0.045, 0.012, 24, 0.04), BANDS.dark, [X, 0.006, 0]));
    root.add(p.body(cyl(0.0065, 0.138, 16), BANDS.steel, [X, 0.081, 0]));
    const collar = new Group();
    collar.name = 'COLLAR';
    collar.position.set(X, 0.032, 0);
    collar.add(p.body(cyl(0.0085, 0.02, 18), BANDS.gold));
    collar.add(p.glow(box(0.004, 0.008, 0.002), INK, { at: [0, 0, 0.0088] }));
    root.add(collar);
    // The bench gas tap, its lever turning about up, and the hose to the burner's inlet.
    root.add(p.body(cyl(0.008, 0.04, 14), BANDS.steel, [-0.077, 0.02, -0.018]));
    const tap = new Group();
    tap.name = 'TAP';
    tap.position.set(-0.077, 0.042, -0.018);
    tap.add(p.body(box(0.034, 0.006, 0.008), BANDS.tomato, [0.012, 0, 0]));
    root.add(tap);
    const hose = p.body(cyl(0.0035, 0.1, 10), bandsOf('#8a3b2b'), [-0.028, 0.02, -0.009]);
    hose.rotation.z = Math.PI / 2 - 0.25;
    hose.rotation.y = 0.18;
    root.add(hose);
    // The flame: an outer cone in the flame's colour and an inner blue cone, from the barrel top.
    const flame = new Group();
    flame.name = 'FLAME';
    flame.position.set(X, 0.15, 0);
    flame.visible = false;
    const outer = p.glow(new ConeGeometry(0.009, 1, 14, 1, true), '#f6b73c', { opacity: 0.8 });
    outer.geometry.translate(0, 0.5, 0);
    const inner = p.glow(new ConeGeometry(0.0045, 0.4, 12, 1, true), '#46c3f2', { opacity: 0.9 });
    inner.geometry.translate(0, 0.2, 0);
    flame.add(outer, inner);
    root.add(flame);
    let height = 0.105;
    let t = 0;
    const outerColour = (outer.material as MeshBasicMaterial).color;
    return {
      nodes: { FLAME: flame },
      set(ch, v) {
        if (ch === 'turn:COLLAR') collar.rotation.y = -(v as number) * DEG;
        else if (ch === 'turn:TAP') tap.rotation.y = (v as number) * DEG;
        else if (ch === 'flame:BURNER') flame.visible = (v as number) > 0.5;
        else if (ch === 'tint:FLAME') outerColour.set(v as string);
        else if (ch === 'height:FLAME') height = (v as number) / 1000;
      },
      update(dt) {
        if (!flame.visible) return;
        t += dt;
        const k = 1 + 0.06 * Math.sin(t * 23) + 0.03 * Math.sin(t * 41);
        outer.scale.set(1, height * k, 1);
        inner.scale.set(1, height * 1.4 * (2 - k), 1);
      },
    };
  },

  'flame-test-kit'(p, root) {
    root.add(p.body(box(0.24, 0.012, 0.14), BANDS.white, [0, 0.006, 0]));
    SALT_DISHES.forEach((d, i) => {
      root.add(p.body(cyl(0.011, 0.008, 18, 0.012), BANDS.ceramic, [dishX(i), 0.016, -0.025]));
      root.add(p.glow(cyl(0.009, 0.002, 16), d === 'Cu' ? '#2fa7a0' : d === 'unknown' ? '#efe9dc' : '#f7f5ef', { at: [dishX(i), 0.0205, -0.025] }));
    });
    root.add(p.glow(cyl(0.0145, 0.012, 18), '#e9f3c9', { opacity: 0.85, at: [ACID_AT[0], 0.018, ACID_AT[2]] }));
    root.add(p.glass(cyl(0.016, 0.026, 18), [ACID_AT[0], 0.025, ACID_AT[2]]));
    // The nichrome loop: a handle, a wire and the loop at its left end (its tip), resting on the tray.
    const loop = new Group();
    loop.name = 'LOOP';
    loop.position.set(LOOP_REST[0], LOOP_REST[1], LOOP_REST[2]);
    const handle = p.body(cyl(0.004, 0.06, 10), BANDS.wood, [0.02, 0, 0]);
    handle.rotation.z = Math.PI / 2;
    const wire = p.glow(cyl(0.0007, 0.045, 6), '#8a8f94', { at: [-0.0325, 0, 0] });
    wire.rotation.z = Math.PI / 2;
    const ring = p.glow(new TorusGeometry(0.0035, 0.0008, 6, 16), '#8a8f94', { at: [-0.0585, 0, 0] });
    loop.add(handle, wire, ring);
    root.add(loop);
    const ringColour = (ring.material as MeshBasicMaterial).color;
    const wireColour = (wire.material as MeshBasicMaterial).color;
    return {
      nodes: { LOOP: loop },
      set(ch, v) {
        if (ch === 'tint:LOOP') {
          ringColour.set(v as string);
          wireColour.set(v as string);
        }
      },
    };
  },

  'beaker-250'(p, root) {
    root.add(p.body(box(0.1, 0.012, 0.1), BANDS.dark, [0, 0.006, 0]));
    const ring = p.glow(new TorusGeometry(0.03, 0.002, 6, 28), '#3a3632', { at: [0, 0.0125, 0] });
    ring.rotation.x = Math.PI / 2;
    root.add(ring);
    const liquid = p.glow(cyl(0.0335, 1, 24), '#3f8fd6', { opacity: 0.85, at: [0, 0.014, 0] });
    liquid.geometry.translate(0, 0.5, 0);
    root.add(liquid);
    root.add(p.glass(cyl(0.035, 0.095, 24), [0, 0.012 + 0.0475, 0]));
    const temp = screen(p, root, [0.04, 0.008, 0.052], 0.03, 0.01, '#ff4b33');
    temp.mesh.rotation.x = -60 * DEG;
    const ringColour = (ring.material as MeshBasicMaterial).color;
    return {
      set(ch, v) {
        if (ch === 'level:LIQUID') {
          liquid.scale.y = Math.max(0.0001, ((v as number) - 2) / 1000);
          liquid.visible = (v as number) > 2.5;
        } else if (ch === 'tint:LIQUID') (liquid.material as MeshBasicMaterial).color.set(v as string);
        else if (ch === 'led:HEAT') ringColour.set((v as number) > 0.5 ? '#ff4b33' : '#3a3632');
        else if (ch === 'text:TEMP') temp.set(v as string);
      },
    };
  },

  'erlenmeyer-250'(p, root) {
    const flask = new Group();
    root.add(flask);
    const liquid = p.glow(cyl(0.04, 1, 24, 0.028), '#7fbf5a', { opacity: 0.85, at: [0, 0.002, 0] });
    liquid.geometry.translate(0, 0.5, 0);
    flask.add(liquid);
    flask.add(p.glass(cyl(0.0425, 0.108, 24, 0.017), [0, 0.054, 0]));
    flask.add(p.glass(cyl(0.017, 0.037, 18), [0, 0.1265, 0]));
    let t = 0;
    let swirl = 0;
    return {
      set(ch, v) {
        if (ch === 'level:LIQUID') {
          liquid.scale.y = Math.max(0.0001, ((v as number) - 2) / 1000);
          liquid.visible = (v as number) > 2.5;
        } else if (ch === 'tint:LIQUID') (liquid.material as MeshBasicMaterial).color.set(v as string);
        else if (ch === 'swirl:FLASK') swirl = v as number;
      },
      update(dt) {
        t += dt;
        const a = swirl > 0 ? 12.4 * DEG * Math.min(1, swirl) : 0;
        flask.rotation.set(a * Math.sin(t * 9), 0, a * Math.cos(t * 9));
      },
    };
  },

  'ph-meter'(p, root) {
    root.add(p.body(box(0.075, 0.04, 0.1), BANDS.blackPlastic, [-0.015, 0.02, 0.03]));
    const ph = screen(p, root, [-0.015, 0.0405, 0.0], 0.06, 0.018, '#4dff6a');
    ph.mesh.rotation.x = -Math.PI / 2;
    ph.mesh.position.set(-0.015, 0.0405, -0.005);
    const cal = screen(p, root, [-0.015, 0.0405, -0.008], 0.04, 0.008, '#f4d37c');
    cal.mesh.rotation.x = -Math.PI / 2;
    cal.mesh.position.set(-0.015, 0.0405, -0.012);
    const power = lamp(p, root, [0.016, 0.042, 0.072], '#4dff6a');
    // The rinse water, the pH 7 buffer and the probe's storage cap, beside the meter.
    root.add(p.glow(cyl(0.0135, 0.03, 16), '#cfe6f2', { opacity: 0.8, at: [0.045, 0.015, 0.045] }));
    root.add(p.glass(cyl(0.015, 0.045, 16), [0.045, 0.0225, 0.045]));
    root.add(p.body(cyl(0.012, 0.045, 16), BANDS.mustard, [0.045, 0.0225, 0.0]));
    root.add(p.body(cyl(0.008, 0.03, 12), BANDS.white, [0.045, 0.015, -0.05]));
    const probe = new Group();
    probe.name = 'PROBE';
    probe.add(p.body(cyl(0.006, 0.12, 12), BANDS.white, [0, 0.06, 0]));
    probe.add(p.glow(new SphereGeometry(0.006, 12, 8), '#cfe6ee', { at: [0, 0.0, 0] }));
    root.add(probe);
    return {
      nodes: { PROBE: probe },
      set(ch, v) {
        if (ch === 'text:PH') ph.set(v as string);
        else if (ch === 'text:CAL') cal.set(v as string);
        else if (ch === 'led:POWER') power.set(v as number);
      },
    };
  },

  'bench-power-supply'(p, root) {
    root.add(p.body(box(0.15, 0.125, 0.236), BANDS.paper, [0, 0.0625, -0.022]));
    root.add(p.body(box(0.15, 0.125, 0.004), BANDS.dark, [0, 0.0625, 0.098]));
    const vout = screen(p, root, [-0.038, 0.095, 0.1012], 0.05, 0.022, '#ff4b33');
    const iout = screen(p, root, [0.032, 0.095, 0.1012], 0.05, 0.022, '#4dff6a');
    const set = screen(p, root, [0, 0.075, 0.1012], 0.07, 0.009, '#d9dcd8');
    const vset = knob(p, [-0.038, 0.05, 0.103], 0.012, 'VSET');
    const iset = knob(p, [0.038, 0.05, 0.103], 0.012, 'ISET');
    root.add(vset, iset);
    const cv = lamp(p, root, [-0.007, 0.062, 0.1015], '#4dff6a');
    const cc = lamp(p, root, [0.007, 0.062, 0.1015], '#ff4b33');
    const power = new Group();
    power.position.set(-0.052, 0.019, 0.101);
    power.add(p.body(box(0.016, 0.012, 0.006), BANDS.tomato));
    root.add(power);
    root.add(p.body(box(0.024, 0.008, 0.004), BANDS.steel, [-0.008, 0.019, 0.1015]));
    // The - , GND and + posts.
    for (const [x, c] of [[0.02, BANDS.blackPlastic], [0.038, BANDS.mint], [0.056, BANDS.tomato]] as const) {
      const post = p.body(cyl(0.004, 0.01, 10), c, [x, 0.022, 0.104]);
      post.rotation.x = Math.PI / 2;
      root.add(post);
    }
    // The load on the bench in front, between the + and - posts.
    const load = new Group();
    load.position.set(0, 0.006, 0.136);
    const res = p.body(box(0.03, 0.008, 0.008), BANDS.tan);
    const leadL = p.glow(box(0.0012, 0.0012, 0.034), '#9a958c', { at: [-0.019, 0.006, -0.017] });
    const leadR = p.glow(box(0.0012, 0.0012, 0.034), '#9a958c', { at: [0.019, 0.006, -0.017] });
    load.add(res, leadL, leadR);
    root.add(load);
    const resColour = (res.material as { color?: Color }).color;
    return {
      set(ch, v) {
        switch (ch) {
          case 'turn:VSET':
            vset.rotation.z = -(v as number) * DEG;
            break;
          case 'turn:ISET':
            iset.rotation.z = -(v as number) * DEG;
            break;
          case 'led:CV':
            cv.set(v as number);
            break;
          case 'led:CC':
            cc.set(v as number);
            break;
          case 'press:POWER':
            power.rotation.x = (v as number) * DEG;
            break;
          case 'text:VOUT':
            vout.set(`${v} V`);
            break;
          case 'text:IOUT':
            iout.set(`${v} A`);
            break;
          case 'text:SET':
            set.set(v as string);
            break;
          case 'load:LOAD': {
            const [kind, hot] = String(v).split(':');
            load.visible = kind !== 'open';
            res.scale.set(kind === 'short' ? 1.2 : kind === 'r10' ? 1.4 : 1, kind === 'short' ? 0.2 : 1, kind === 'short' ? 0.2 : 1);
            // Plain colours only (the ink bands are baked): tint where the material can be.
            resColour?.set(hot ? '#a8402b' : kind === 'unknown' ? '#76a0e2' : kind === 'r10' ? '#fbfaf3' : '#e3c79a');
            break;
          }
          default:
            break;
        }
      },
    };
  },

  'soldering-station'(p, root) {
    root.add(p.body(box(0.08, 0.095, 0.14), BANDS.cobalt, [-0.052, 0.0475, 0.0]));
    const tip = screen(p, root, [-0.052, 0.08, 0.0705], 0.05, 0.016, '#ff4b33');
    const dial = knob(p, [-0.052, 0.052, 0.0705], 0.014, 'DIAL');
    root.add(dial);
    const power = lamp(p, root, [-0.075, 0.03, 0.0705], '#ff4b33');
    const heat = lamp(p, root, [-0.028, 0.03, 0.0705], '#ff4b33');
    root.add(p.body(box(0.016, 0.01, 0.004), BANDS.blackPlastic, [-0.075, 0.017, 0.0705]));
    // The stand (a coil on a foot) and the sponge tray.
    root.add(p.body(box(0.05, 0.008, 0.11), BANDS.dark, [0.042, 0.004, 0.0]));
    const coil = p.body(cyl(0.012, 0.07, 14, 0.016), BANDS.steel, [0.042, 0.05, -0.04]);
    coil.rotation.x = -0.75;
    root.add(coil);
    const sponge = p.body(box(0.044, 0.01, 0.03), BANDS.mustard, [0.042, 0.013, 0.075]);
    root.add(sponge);
    const iron = new Group();
    iron.name = 'IRON';
    const grip = p.body(cyl(0.008, 0.08, 12), BANDS.blackPlastic, [0, 0.04, 0]);
    const shaft = p.body(cyl(0.002, 0.045, 8, 0.0012), BANDS.steel, [0, -0.0225, 0]);
    iron.add(grip, shaft);
    root.add(iron);
    const a = new Vector3();
    const b = new Vector3();
    const up = new Vector3(0, 1, 0);
    const pose = (inHand: boolean) => {
      // The figure's iron poses (extras.ironPoses), tip to end, in the asset frame.
      if (inHand) a.set(0.02, 0.03, 0.092), b.set(0.056, 0.1, 0.024);
      else a.set(0.042, 0.014, 0.005), b.set(0.042, 0.084, -0.077);
      iron.position.copy(a).lerp(b, 0.36);
      iron.quaternion.setFromUnitVectors(up, b.sub(a).normalize());
    };
    pose(false);
    const spongeColour = (sponge.material as { color?: Color }).color;
    return {
      set(ch, v) {
        if (ch === 'turn:DIAL') dial.rotation.z = -(v as number) * DEG;
        else if (ch === 'led:POWER') power.set(v as number);
        else if (ch === 'led:HEAT') heat.set(v as number);
        else if (ch === 'pose:IRON') pose((v as number) > 0.5);
        else if (ch === 'text:TIP') tip.set(v as string);
        else if (ch === 'tint:SPONGE') spongeColour?.set(v as string);
      },
    };
  },

  'pendulum-stand'(p, root) {
    root.add(p.body(box(0.2, 0.012, 0.13), BANDS.dark, [0, 0.006, 0]));
    root.add(p.body(cyl(0.006, 0.612, 14), BANDS.steel, [-0.078, 0.306, 0]));
    root.add(p.body(box(0.15, 0.01, 0.01), BANDS.steel, [-0.008, 0.553, 0]));
    root.add(p.body(box(0.018, 0.018, 0.018), BANDS.dark, [0.062, 0.553, 0]));
    const read = screen(p, root, [0, 0.0125, 0.06], 0.13, 0.012, '#f4d37c');
    read.mesh.rotation.x = -Math.PI / 2;
    read.mesh.position.set(0, 0.0125, 0.02);
    const swing = new Group();
    swing.position.set(0.062, 0.553, 0);
    const string = p.glow(cyl(0.0006, 1, 6), INK);
    string.geometry.translate(0, -0.5, 0);
    const bob = new Group();
    bob.name = 'BOB';
    bob.add(p.body(new SphereGeometry(0.0115, 18, 12), BANDS.gold));
    swing.add(string, bob);
    root.add(swing);
    const length = (mm: number) => {
      string.scale.y = mm / 1000 - 0.0115;
      bob.position.set(0, -mm / 1000, 0);
    };
    length(400);
    return {
      nodes: { BOB: bob },
      set(ch, v) {
        if (ch === 'swing:BOB') swing.rotation.x = (v as number) * DEG;
        else if (ch === 'length:STRING') length(v as number);
        else if (ch === 'text:READ') read.set(v as string);
      },
    };
  },

  'function-generator'(p, root) {
    root.add(p.body(box(0.22, 0.09, 0.2), BANDS.paper, [0, 0.045, 0]));
    root.add(p.body(box(0.22, 0.09, 0.004), BANDS.dark, [0, 0.045, 0.099]));
    const display = screen(p, root, [-0.03, 0.065, 0.1015], 0.12, 0.022, '#4dff6a');
    const freq = knob(p, [0.015, 0.03, 0.103], 0.011);
    const amp = knob(p, [0.052, 0.03, 0.103], 0.011);
    root.add(freq, amp);
    root.add(p.body(box(0.02, 0.012, 0.004), BANDS.steel, [-0.085, 0.025, 0.1015]));
    root.add(p.body(box(0.02, 0.012, 0.004), BANDS.tomato, [0.088, 0.028, 0.1015]));
    const out = lamp(p, root, [0.088, 0.045, 0.1015], '#4dff6a');
    root.add(p.body(cyl(0.005, 0.012, 12), BANDS.steel, [0.088, 0.065, 0.104]));
    root.children.at(-1)!.rotation.x = Math.PI / 2;
    return {
      set(ch, v) {
        if (ch === 'text:DISPLAY') display.set(v as string);
        else if (ch === 'led:OUT') out.set(v as number);
      },
    };
  },

  oscilloscope(p, root) {
    root.add(p.body(box(0.32, 0.16, 0.2), BANDS.paper, [0, 0.08, 0]));
    root.add(p.body(box(0.32, 0.16, 0.004), BANDS.dark, [0, 0.08, 0.099]));
    // The screen: one canvas, redrawn only when the trace key changes.
    const W = 0.19;
    const H = 0.13;
    const canvas = document.createElement('canvas');
    canvas.width = 760;
    canvas.height = 520;
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    const scr = new Mesh(new PlaneGeometry(W, H), new MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.set(-0.055, 0.085, 0.1015);
    scr.raycast = () => undefined;
    p.track(scr);
    p.owned.push(tex);
    root.add(scr);
    let last = '';
    const draw = (key: string) => {
      if (key === last) return;
      last = key;
      const g = canvas.getContext('2d');
      if (!g) return;
      const cw = canvas.width;
      const ch = canvas.height;
      g.fillStyle = '#10140f';
      g.fillRect(0, 0, cw, ch);
      if (key === 'off') {
        tex.needsUpdate = true;
        return;
      }
      const [present, periods, divs, wave, head, meas] = key.split('|');
      const top = 40;
      const gh = ch - 90;
      const gw = cw - 40;
      const x0 = 20;
      g.strokeStyle = '#2f4a33';
      g.lineWidth = 2;
      for (let i = 0; i <= 10; i++) {
        g.beginPath();
        g.moveTo(x0 + (gw * i) / 10, top);
        g.lineTo(x0 + (gw * i) / 10, top + gh);
        g.stroke();
      }
      for (let j = 0; j <= 8; j++) {
        g.beginPath();
        g.moveTo(x0, top + (gh * j) / 8);
        g.lineTo(x0 + gw, top + (gh * j) / 8);
        g.stroke();
      }
      g.fillStyle = '#9fe6a0';
      g.font = `600 26px ${FONT_MONO}`;
      g.textBaseline = 'middle';
      g.fillText(head ?? '', x0, 20);
      g.fillStyle = '#f4d37c';
      g.fillText(meas ?? '', x0, ch - 28);
      if (present === '1') {
        const n = Number(periods);
        const d = Math.min(Number(divs), 9.5);
        g.strokeStyle = '#7dff8a';
        g.lineWidth = 4;
        g.save();
        g.beginPath();
        g.rect(x0, top, gw, gh);
        g.clip();
        g.beginPath();
        const steps = Math.min(1500, Math.max(200, Math.round(n * 40)));
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          const ph = u * n * 2 * Math.PI;
          const s = wave === 'square' ? (Math.sin(ph) >= 0 ? 1 : -1) : wave === 'triangle' ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : Math.sin(ph);
          const x = x0 + u * gw;
          const y = top + gh / 2 - (s * d * gh) / 16;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        g.restore();
      }
      tex.needsUpdate = true;
    };
    draw('off');
    const time = knob(p, [0.085, 0.118, 0.103], 0.012);
    const volts = knob(p, [0.13, 0.118, 0.103], 0.012);
    root.add(time, volts);
    root.add(p.body(box(0.034, 0.012, 0.004), BANDS.steel, [0.108, 0.07, 0.1015]));
    root.add(p.body(box(0.024, 0.012, 0.004), BANDS.mustard, [0.085, 0.03, 0.1015]));
    root.add(p.body(box(0.02, 0.012, 0.004), BANDS.tomato, [0.135, 0.03, 0.1015]));
    const power = lamp(p, root, [0.135, 0.045, 0.1015], '#4dff6a');
    const probe = new Group();
    probe.name = 'PROBE';
    probe.position.set(0.085, 0.045, 0.104);
    root.add(probe);
    return {
      nodes: { PROBE: probe },
      set(ch, v) {
        if (ch === 'screen:TRACE') draw(v as string);
        else if (ch === 'led:POWER') power.set(v as number);
      },
    };
  },

  generic(p, root, label) {
    root.add(p.body(box(0.12, 0.12, 0.12), BANDS.paper, [0, 0.06, 0]));
    const tag = p.text(0.11, 0.03, {});
    tag.mesh.position.set(0, 0.07, 0.0605);
    tag.set(label ?? '?');
    root.add(tag.mesh);
    return { set: () => undefined };
  },
};

/** Primitives for every kind; the stand-in box for a kind with no builder. */
export function createPrimitiveSource(kit: () => InkKit | null): ItemVisualSource {
  return {
    has: (kind) => kind in BUILDERS,
    async create(kind, opts) {
      const p = new Painter(kit());
      const root = new Group();
      root.name = `lab-visual:${kind}`;
      const rig = (BUILDERS[kind] ?? BUILDERS.generic!)(p, root, opts.label ?? kind);
      const visual: ItemVisual = {
        object: root,
        source: 'primitive',
        set: (ch, v) => rig.set(ch, v),
        node: (name) => rig.nodes?.[name],
        update: (dt) => rig.update?.(dt),
        dispose: () => {
          p.dispose();
          root.removeFromParent();
        },
      };
      return visual;
    },
  };
}
