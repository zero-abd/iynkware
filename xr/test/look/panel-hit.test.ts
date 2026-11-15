import { Group, Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { setPanelHit } from '../../src/look/moves';

const events = (g: Object3D) => (g as unknown as { pointerEvents?: string }).pointerEvents;

describe('hidden panels take no rays', () => {
  it('a hidden panel is pointerEvents none, an open one has no override', () => {
    const g = new Group();
    const hit = new Mesh();
    const decorative = new Mesh();
    (decorative as unknown as { pointerEvents?: string }).pointerEvents = 'listener';
    g.add(hit, decorative);
    setPanelHit(g, false);
    expect(events(g)).toBe('none');
    expect(events(hit)).toBe('none');
    expect(events(decorative)).toBe('none');
    setPanelHit(g, true);
    expect(events(g)).toBeUndefined();
    expect(events(hit)).toBeUndefined();
    expect(events(decorative)).toBe('listener');
  });
});
