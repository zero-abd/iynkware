/**
 * Dev-only harness: one cube bound through the input service, so every pointer path can be seen and logged. It tints
 * yellow while hovered and green while held, toggles its size on each completed select, and logs each event with its
 * pointer source. Not for shipped scenes.
 */
import { BoxGeometry, Color, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import type { World } from '@iwsdk/core';
import type { BindOptions, InputService, InteractionEvent } from '../contracts/input';

export interface DebugCubeOptions {
  /** Default `debug-cube`. */
  id?: string;
  /** World position, metres. Default to the left of the bench, in reach of the default desktop camera. */
  position?: readonly [number, number, number];
  /** Edge length, metres. Default 0.08. */
  size?: number;
  /** Default `near`: the trigger or a pinch along a ray selects it, the grip or a pinch beside it picks it up. */
  grab?: BindOptions['grab'];
  /** Base colour. */
  color?: number;
}

export interface DebugCube {
  readonly mesh: Mesh;
  /** The newest log lines (at most 100), oldest first. */
  readonly log: readonly string[];
  unbind(): void;
}

const MOVE_LOG_MS = 500;

export function describeEvent(e: InteractionEvent): string {
  const p = e.pointer;
  const parts = [
    `[input] ${e.type}`,
    e.target,
    `source=${p.source}`,
    `mode=${p.mode}`,
    `hand=${p.hand ?? '-'}`,
    `pointer=${p.id}`,
  ];
  if (e.instance !== undefined) parts.push(`instance=${e.instance}`);
  if (e.point) parts.push(`point=${e.point.map((v) => v.toFixed(3)).join(',')}`);
  return parts.join(' ');
}

export function bindDebugCube(world: World, input: InputService, opts: DebugCubeOptions = {}): DebugCube {
  const id = opts.id ?? 'debug-cube';
  const size = opts.size ?? 0.08;
  const base = new Color(opts.color ?? 0x4a7bd0);
  const hoverColor = new Color(0xf2c230);
  const heldColor = new Color(0x2e9d4f);
  const material = new MeshStandardMaterial({ color: base.clone(), roughness: 0.6 });
  const mesh = new Mesh(new BoxGeometry(size, size, size), material);
  mesh.name = id;
  const [x, y, z] = opts.position ?? [-0.42, 0.9, -0.45];
  mesh.position.set(x, y, z);
  world.scene.add(mesh);

  const hovering = new Set<number>();
  const holding = new Set<number>();
  let big = false;
  const lines: string[] = [];
  const lastMoveLog = new Map<string, number>();
  const paint = () => material.color.copy(holding.size > 0 ? heldColor : hovering.size > 0 ? hoverColor : base);

  const log = (e: InteractionEvent) => {
    if (e.type === 'drag-move' || e.type === 'grab-move') {
      const key = `${e.type}:${e.pointer.id}`;
      const now = performance.now();
      if (now - (lastMoveLog.get(key) ?? -Infinity) < MOVE_LOG_MS) return;
      lastMoveLog.set(key, now);
    }
    const line = describeEvent(e);
    lines.push(line);
    if (lines.length > 100) lines.shift();
    console.info(line);
  };

  const unbind = input.bind(mesh, { id, ray: true, poke: true, grab: opts.grab ?? 'near' }, (e) => {
    switch (e.type) {
      case 'hover-start':
        hovering.add(e.pointer.id);
        break;
      case 'hover-end':
        hovering.delete(e.pointer.id);
        break;
      case 'select-start':
      case 'grab-start':
        holding.add(e.pointer.id);
        break;
      case 'select-end':
      case 'grab-end':
        holding.delete(e.pointer.id);
        break;
      case 'select':
        big = !big;
        mesh.scale.setScalar(big ? 1.35 : 1);
        break;
      default:
        break;
    }
    paint();
    log(e);
  });

  return { mesh, log: lines, unbind };
}
