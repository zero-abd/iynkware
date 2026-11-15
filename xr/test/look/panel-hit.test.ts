import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import { setPanelHit } from '../../src/look/moves';

const events = (g: Group) => (g as unknown as { pointerEvents?: string }).pointerEvents;

describe('hidden panels take no rays', () => {
  it('a hidden panel is pointerEvents none, an open one has no override', () => {
    const g = new Group();
    setPanelHit(g, false);
    expect(events(g)).toBe('none');
    setPanelHit(g, true);
    expect(events(g)).toBeUndefined();
  });
});
