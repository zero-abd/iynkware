/** Room size: sizing and placement, the fade machine, the live copy, strings. */
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { buildRoomCopy } from '../../src/scale/room/copy';
import { createFade } from '../../src/scale/room/fade';
import { angleDiff, boundsShortSide, needsReplace, roomPose, roomScale, targetSide } from '../../src/scale/room/size';
import { ROOM_STRINGS } from '../../src/scale/room/strings';
import { tableProblems } from '../../src/scale/kit/text';

const uno = { minX: 0, maxX: 0.0686, minZ: 0, maxZ: 0.0534 };

describe('room size', () => {
  it('makes the largest side 3 m, or 0.8 of the shorter guardian side, never under 1.5 m', () => {
    expect(targetSide(null)).toBe(3);
    expect(targetSide(5)).toBe(3);
    expect(targetSide(3)).toBeCloseTo(2.4);
    expect(targetSide(1)).toBe(1.5);
    expect(roomScale(uno, null) * 0.0686).toBeCloseTo(3);
  });
  it('reads the shorter side of the bounds', () => {
    const pts = [{ x: -1, z: -2 }, { x: 1, z: -2 }, { x: 1, z: 2 }, { x: -1, z: 2 }];
    expect(boundsShortSide(pts)).toBe(2);
    expect(boundsShortSide([])).toBeNull();
  });
  it('puts the nearest edge 1 m ahead of the head, level, facing the head', () => {
    const s = roomScale(uno, null);
    for (const [fx, fz] of [[0, -1], [1, 0], [-0.6, -0.8], [0, 1]] as const) {
      const p = roomPose(uno, s, { x: 0.3, z: -0.2, fx, fz });
      const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
      const cx = ((uno.minX + uno.maxX) / 2) * s, ez = uno.maxZ * s;
      const wx = p.x + c * cx + sn * ez, wz = p.z - sn * cx + c * ez;
      expect(wx).toBeCloseTo(0.3 + fx);
      expect(wz).toBeCloseTo(-0.2 + fz);
      // the board's +z side points back at the head
      expect(sn).toBeCloseTo(-fx);
      expect(c).toBeCloseTo(-fz);
    }
  });
  it('measures heading differences across the wrap', () => {
    expect(angleDiff(3.1, -3.1)).toBeLessThan(0.1);
    expect(needsReplace(0, (30 * Math.PI) / 180)).toBe(false);
    expect(needsReplace(0, (50 * Math.PI) / 180)).toBe(true);
  });
});

describe('room fade', () => {
  it('fades the bench out first, then the room in, and back', () => {
    const f = createFade({ outMs: 250, inMs: 400 });
    f.go(1);
    let s = f.step(125);
    expect(s.bench).toBeGreaterThan(0);
    expect(s.bench).toBeLessThan(1);
    expect(s.room).toBe(0);
    s = f.step(125);
    expect(s.bench).toBe(0);
    expect(s.room).toBe(0);
    s = f.step(200);
    expect(s.room).toBeGreaterThan(0);
    s = f.step(1000);
    expect(s).toMatchObject({ p: 1, bench: 0, room: 1, moving: false });
    f.go(0);
    s = f.step(1000);
    expect(s).toMatchObject({ p: 0, bench: 1, room: 0, moving: false });
  });
  it('reverses from where it is', () => {
    const f = createFade({ outMs: 250, inMs: 400 });
    f.go(1);
    const mid = f.step(325);
    f.go(0);
    const back = f.step(10);
    expect(back.p).toBeLessThan(mid.p);
    expect(f.step(2000).p).toBe(0);
  });
  it('snaps and honours shorter times', () => {
    const f = createFade({ outMs: 75, inMs: 75 });
    f.go(1);
    expect(f.step(150).moving).toBe(false);
    f.snap(0);
    expect(f.state).toMatchObject({ p: 0, bench: 1, room: 0 });
  });
});

describe('room copy', () => {
  const make = () => {
    const root = new Group();
    const mat = new MeshStandardMaterial({ color: 0x00ff00 });
    const mesh = new Mesh(new BoxGeometry(0.2, 0.01, 0.1), mat);
    mesh.position.set(0.1, 0.005, 0.05);
    const holder = new Group();
    holder.add(mesh);
    root.add(holder);
    return { root, mat, mesh };
  };
  it('has its own materials and mirrors the source without writing it', () => {
    const { root, mat, mesh } = make();
    const copy = buildRoomCopy(root);
    const cm = (copy.root.children[0]!.children[0] as Mesh).material as MeshStandardMaterial;
    expect(cm).not.toBe(mat);
    mat.color.set(0xff0000);
    mesh.position.x = 0.4;
    mesh.visible = false;
    copy.sync(0.5);
    expect(cm.color.getHex()).toBe(0xff0000);
    expect(cm.opacity).toBeCloseTo(0.5);
    expect(cm.transparent).toBe(true);
    expect((copy.root.children[0]!.children[0] as Mesh).position.x).toBeCloseTo(0.4);
    expect((copy.root.children[0]!.children[0] as Mesh).visible).toBe(false);
    expect(mat.opacity).toBe(1);
    expect(mat.transparent).toBe(false);
    copy.sync(1);
    expect(cm.transparent).toBe(false);
  });
  it('measures its extent in the board frame whatever its pose', () => {
    const { root } = make();
    const copy = buildRoomCopy(root);
    copy.root.position.set(5, 0, 5);
    copy.root.scale.setScalar(10);
    const e = copy.extent();
    expect(e.minX).toBeCloseTo(0);
    expect(e.maxX).toBeCloseTo(0.2);
    expect(e.minZ).toBeCloseTo(0);
    expect(e.maxZ).toBeCloseTo(0.1);
  });
  it('is not raycastable', () => {
    const { root } = make();
    const copy = buildRoomCopy(root);
    const hits: unknown[] = [];
    copy.root.traverse((o) => o.raycast({ ray: undefined } as never, hits as never));
    expect(hits.length).toBe(0);
  });
});

describe('room strings', () => {
  it('has every key in all six languages', () => {
    expect(tableProblems(ROOM_STRINGS)).toEqual([]);
  });
});
