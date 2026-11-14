/** A dashed ink line between two board-frame points: one draw call, its dashes rewritten in place (nothing allocated per frame). */
import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, type Object3D } from '@iwsdk/core';
import { INK, hexNum } from '../../look/palette';

const DASHES = 22;

export interface Tether {
  readonly line: LineSegments;
  /** From `a` to `b`, in the parent's frame. Shows the line. */
  set(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void;
  hide(): void;
  dispose(): void;
}

let material: LineBasicMaterial | null = null;

export function createTether(parent: Object3D): Tether {
  const positions = new Float32Array(DASHES * 2 * 3);
  const geometry = new BufferGeometry();
  const attr = new BufferAttribute(positions, 3);
  geometry.setAttribute('position', attr);
  material ??= new LineBasicMaterial({ color: hexNum(INK), toneMapped: false });
  const line = new LineSegments(geometry, material);
  line.name = 'bench:tether';
  line.frustumCulled = false;
  line.visible = false;
  line.raycast = () => undefined;
  parent.add(line);
  return {
    line,
    set(ax, ay, az, bx, by, bz) {
      for (let i = 0; i < DASHES; i++) {
        const t0 = i / DASHES;
        const t1 = (i + 0.55) / DASHES;
        const k = i * 6;
        positions[k] = ax + (bx - ax) * t0;
        positions[k + 1] = ay + (by - ay) * t0;
        positions[k + 2] = az + (bz - az) * t0;
        positions[k + 3] = ax + (bx - ax) * t1;
        positions[k + 4] = ay + (by - ay) * t1;
        positions[k + 5] = az + (bz - az) * t1;
      }
      attr.needsUpdate = true;
      line.visible = true;
    },
    hide() {
      line.visible = false;
    },
    dispose() {
      line.removeFromParent();
      geometry.dispose();
    },
  };
}
