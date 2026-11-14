/**
 * World inputs by hand (XR_DESIGN 3.2 and 6.2): while the run is going (`running` or `paused`) a person presses a button,
 * flips a switch, turns a pot, shades a light sensor, brings a hand towards a distance sensor, warms a temperature
 * sensor and waters a moisture sensor. Which part takes which input comes from its descriptor (`map.ts` `inputsOf`);
 * every input goes to `app.sim.input` as a `part` world input. Nothing happens while the run is stopped, and every
 * input is dropped on reset and on a new load.
 *
 *   controls.ts  button, switch and pot: a hit block at the part's `control:` anchor, the `press:` and `turn:` nodes
 *   sensors.ts   light, distance, temperature, humidity and moisture, read from `app.input.pose(hand)` every frame
 *   map.ts       the maths, tested in node
 *
 * This file keeps the part list (rebuilt on every bench layout), the hover rings, the readout chip and the live state.
 */
import { Mesh, MeshBasicMaterial, Path, Shape, ShapeGeometry, Vector3, type Object3D } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { PartAsset } from '../../contracts/assets';
import { ACCENT, hexNum } from '../../look/palette';
import { animated, MOTION, type Animated } from '../kit/motion';
import { faceViewer, textChip, type Chip } from '../kit/chip';
import { onTick } from '../kit/ticker';
import { buttonPiece, potPiece, switchPiece } from './controls';
import { inputsOf, type DescriptorLike, type InputSpec } from './map';
import { distancePiece, lightPiece, moisturePiece, warmPiece } from './sensors';
import type { Host, LivePart, Piece } from './shared';

/** How long a readout chip stays after the value last changed. */
const CHIP_MS = 1200;
/** The chip's canvas redraws at most 10 times a second. */
const CHIP_REDRAW_MS = 100;
/** Hover ring opacity while the run is live, and while a hand or ray is on the control. */
const RING_LIVE = 0.5;
const RING_HOT = 1;

interface Built {
  part: LivePart;
  pieces: Piece[];
  ring: Mesh;
  level: Animated;
  hot: boolean;
}

function roundedRect(path: Path, hx: number, hy: number): void {
  const r = Math.min(hx, hy) * 0.8;
  path.moveTo(-hx + r, -hy);
  path.lineTo(hx - r, -hy);
  path.quadraticCurveTo(hx, -hy, hx, -hy + r);
  path.lineTo(hx, hy - r);
  path.quadraticCurveTo(hx, hy, hx - r, hy);
  path.lineTo(-hx + r, hy);
  path.quadraticCurveTo(-hx, hy, -hx, hy - r);
  path.lineTo(-hx, -hy + r);
  path.quadraticCurveTo(-hx, -hy, -hx + r, -hy);
}

/** A rounded rectangle outline `width` thick, centred on the origin, in the XY plane. */
function outline(hx: number, hy: number, width: number): Shape {
  const shape = new Shape();
  roundedRect(shape, hx, hy);
  const hole = new Path();
  roundedRect(hole, hx - width, hy - width);
  shape.holes.push(hole);
  return shape;
}

function livePartOf(id: string, object: Object3D, asset: PartAsset, specs: readonly InputSpec[]): LivePart {
  const b = asset.sidecar.bounds;
  const f = asset.footprint;
  const min = b?.min ?? [-f.w / 2, 0, -f.d / 2];
  const max = b?.max ?? [f.w / 2, 0.01, f.d / 2];
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const topAt = [cx, max[1], cz] as const;
  const control = [...asset.anchors.values()].find((a) => a.id.startsWith('control:'));
  return {
    id,
    object,
    asset,
    specs,
    size: [max[0] - min[0], max[2] - min[2]],
    topAt,
    frontAt: [cx, (min[1] + max[1]) / 2, max[2]],
    controlAt: control ? [control.position[0], control.position[1], control.position[2]] : topAt,
  };
}

/** The document may set a part's starting value (`params.pos`); the run then starts there, so the visual must too. */
function specWithDoc(spec: InputSpec, params: Readonly<Record<string, unknown>> | undefined): InputSpec {
  const v = params?.[spec.path];
  if ('rest' in spec && typeof v === 'number' && Number.isFinite(v)) return { ...spec, rest: v };
  return spec;
}

export const inputsModule: FeatureModule = {
  id: 'run/inputs',
  mount(app: XrApp) {
    const lang = () => app.settings.lang.value;
    let live = app.sim.state === 'running' || app.sim.state === 'paused';
    let generation = 0;
    let built: Built[] = [];

    // The one readout chip: above the part whose value changed last, for a moment.
    const chip: Chip = textChip({ widthDmm: 300, lines: 1, distanceM: 0.5 });
    chip.group.visible = false;
    app.bench.table.add(chip.group);
    const chipLevel = animated(
      app,
      0,
      (v) => {
        chip.group.visible = v > 0.01;
        chip.group.scale.setScalar(Math.max(v, 0.001));
      },
      'fade',
    );
    const at = new Vector3();
    const upDir = new Vector3();
    let chipText = '';
    let chipPart: LivePart | null = null;
    let chipDrawn = '';
    let chipDrawnLang = '';
    let chipAt = -Infinity;
    let chipUntil = 0;

    const placeChip = (part: LivePart) => {
      part.object.updateWorldMatrix(true, false);
      at.set(part.topAt[0], part.topAt[1], part.topAt[2]).applyMatrix4(part.object.matrixWorld);
      upDir.setFromMatrixColumn(part.object.matrixWorld, 1).normalize();
      at.addScaledVector(upDir, 0.1);
      app.bench.table.worldToLocal(at);
      chip.group.position.copy(at);
    };

    const host: Host = {
      app,
      live: () => live,
      send(part, path, value) {
        if (!live) return;
        app.sim.input({ kind: 'part', part, path, value }).catch((err) => console.warn('[iynkware] input', part, path, err));
      },
      chip(part, text) {
        chipText = text;
        if (chipPart !== part) {
          chipPart = part;
          placeChip(part);
        }
        chipUntil = performance.now() + CHIP_MS;
        chipLevel.to(1, MOTION.fade);
      },
      hover(part, on) {
        const b = built.find((x) => x.part === part);
        if (!b) return;
        b.hot = on;
        if (live) b.level.to(on ? RING_HOT : RING_LIVE, MOTION.hoverOff);
      },
    };

    const clear = () => {
      for (const b of built) {
        for (const p of b.pieces) p.dispose();
        b.level.dispose();
        b.ring.geometry.dispose();
        (b.ring.material as MeshBasicMaterial).dispose();
        b.ring.removeFromParent();
      }
      built = [];
      chipPart = null;
    };

    /** A thin ring on the surface round the part, in the accent: where to reach while the run is live. */
    const ringOf = (part: LivePart): Mesh => {
      const hx = Math.max(0.012, part.size[0] / 2) * 1.12 + 0.004;
      const hz = Math.max(0.012, part.size[1] / 2) * 1.12 + 0.004;
      const geometry = new ShapeGeometry(outline(hx, hz, 0.0016));
      geometry.rotateX(-Math.PI / 2);
      const material = new MeshBasicMaterial({
        color: hexNum(ACCENT),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        toneMapped: false,
      });
      const ring = new Mesh(geometry, material);
      ring.name = 'input-ring';
      ring.visible = false;
      ring.raycast = () => undefined;
      ring.position.set(part.topAt[0], 0.0008, part.topAt[2]);
      part.object.add(ring);
      return ring;
    };

    const piecesOf = (part: LivePart): Piece[] =>
      part.specs.flatMap((spec): Piece[] => {
        switch (spec.kind) {
          case 'button':
            return [buttonPiece(host, part)];
          case 'switch':
            return [switchPiece(host, part, spec.rest)];
          case 'pot':
            return [potPiece(host, part, spec.rest)];
          case 'light':
            return [lightPiece(host, part)];
          case 'distance':
            return [distancePiece(host, part)];
          case 'temp':
            return [warmPiece(host, part, 'temp')];
          case 'humidity':
            return [warmPiece(host, part, 'humidity')];
          case 'moisture':
            return [moisturePiece(host, part)];
        }
      });

    const apply = (b: Built, on: boolean) => {
      b.level.to(on ? (b.hot ? RING_HOT : RING_LIVE) : 0, MOTION.fade);
      for (const p of b.pieces) p.live?.(on);
    };

    const rebuild = () => {
      const gen = ++generation;
      clear();
      const doc = app.project.doc;
      for (const c of doc.components) {
        const { ref, version } = c.definition;
        const params = c.params as Readonly<Record<string, unknown>> | undefined;
        // A template may pin a version the registry no longer carries; the part still takes the latest one's inputs.
        const described = app.project.describe(ref, version) ?? app.project.describe(ref);
        const specs = inputsOf(described as DescriptorLike | undefined).map((s) => specWithDoc(s, params));
        if (specs.length === 0) continue;
        const object = app.bench.objectOf(c.id);
        if (!object) continue;
        app.assets
          .get(ref, version)
          .catch(() => app.assets.get(ref))
          .then((asset) => {
            if (gen !== generation) return;
            const part = livePartOf(c.id, object, asset, specs);
            const ring = ringOf(part);
            const mat = ring.material as MeshBasicMaterial;
            const level = animated(
              app,
              0,
              (v) => {
                mat.opacity = v * 0.9;
                ring.visible = v > 0.01;
              },
              'fade',
            );
            const b: Built = { part, pieces: piecesOf(part), ring, level, hot: false };
            built.push(b);
            if (live) apply(b, true);
          })
          .catch((err) => console.error('[iynkware] part input', c.id, err));
      }
    };

    const setLive = (on: boolean) => {
      if (on === live) return;
      live = on;
      for (const b of built) {
        apply(b, on);
        if (!on) {
          b.hot = false;
          for (const p of b.pieces) p.reset();
        }
      }
      if (!on) {
        chipLevel.to(0, MOTION.fade);
        chipUntil = 0;
      }
    };

    const offs = [
      app.bench.onLayout(rebuild),
      app.sim.onState((s) => setLive(s === 'running' || s === 'paused')),
      onTick(app.world, (dt) => {
        if (!live) return;
        const now = performance.now();
        for (const b of built) for (const p of b.pieces) p.tick?.(dt, now);
        if (chipPart && chip.group.visible) {
          const l = lang();
          if ((chipText !== chipDrawn || l !== chipDrawnLang) && now - chipAt >= CHIP_REDRAW_MS) {
            chipDrawn = chipText;
            chipDrawnLang = l;
            chipAt = now;
            chip.set({ lines: [chipText], lang: l });
          }
          if (now > chipUntil) chipLevel.to(0, MOTION.fade);
          faceViewer(chip.group, app.world.camera);
        }
      }),
    ];
    rebuild();

    return () => {
      generation++;
      for (const off of offs) off();
      clear();
      chipLevel.dispose();
      chip.dispose();
    };
  },
};
