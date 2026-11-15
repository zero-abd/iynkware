/** Course sizes for the room flight (src/range/flight/room/size.ts). */
import { describe, expect, it } from 'vitest';
import { roomVolume } from '../src/range/flight/core/room';
import { COMPACT_SIDE_M, nextSize, TABLE_BELOW_EYES_M, volumeFor } from '../src/range/flight/room/size';
import { ROOM_STRINGS } from '../src/range/flight/room/strings';

const head = { x: 1, y: 1.6, z: 2, heading: { fx: 0, fz: -1 } } as const;
const width = (v: ReturnType<typeof volumeFor>) => v.right - v.left;
const depth = (v: ReturnType<typeof volumeFor>) => v.far - v.near;

describe('course size', () => {
  it('Room with no guardian is exactly the volume it always was', () => {
    expect(volumeFor('room', head)).toEqual(roomVolume(head.x, head.z, head.heading));
    expect(volumeFor('room', head, null)).toEqual(roomVolume(head.x, head.z, head.heading));
  });

  it('Compact is a 1.5 m square on the floor; Tabletop floats at chest height', () => {
    const c = volumeFor('compact', head);
    expect([width(c), depth(c), c.floorY]).toEqual([COMPACT_SIDE_M, COMPACT_SIDE_M, 0]);
    const t = volumeFor('table', head);
    expect(width(t)).toBeCloseTo(0.8);
    expect(t.floorY).toBeCloseTo(head.y - TABLE_BELOW_EYES_M);
  });

  it('Room fits a room-scale guardian, but a tiny one falls back to Compact', () => {
    // a 2.6 x 4 m guardian around the person, who faces -z
    const big: Array<[number, number]> = [[-0.3, 2.5], [2.3, 2.5], [2.3, -1.5], [-0.3, -1.5]];
    const fit = volumeFor('room', head, big);
    expect(width(fit)).toBeLessThan(3);
    expect(width(fit)).toBeGreaterThanOrEqual(COMPACT_SIDE_M);
    const tiny: Array<[number, number]> = [[0.5, 2.5], [1.5, 2.5], [1.5, 1.5], [0.5, 1.5]];
    expect(width(volumeFor('room', head, tiny))).toBe(COMPACT_SIDE_M);
  });

  it('cycles Room, Compact, Tabletop, and the plate strings are in six languages', () => {
    expect([nextSize('room'), nextSize('compact'), nextSize('table')]).toEqual(['compact', 'table', 'room']);
    for (const l of ['en', 'de', 'es', 'fr', 'hi', 'zh'] as const) for (const k of ['size', 'size_room', 'size_compact', 'size_table'] as const) expect(ROOM_STRINGS.t(l, k, { size: 'x' })).not.toBe(k);
  });
});
