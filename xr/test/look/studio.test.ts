import { describe, expect, it } from 'vitest';
import { studioWanted } from '../../src/look/studio';

describe('paper studio', () => {
  it('is the room in the VR space and the immersive-vr fallback, never on the flat page or in passthrough', () => {
    expect(studioWanted('flat', 'mr')).toBe(false);
    expect(studioWanted('flat', 'vr')).toBe(false);
    expect(studioWanted('mr', 'mr')).toBe(false);
    expect(studioWanted('mr', 'vr')).toBe(true);
    expect(studioWanted('vr', 'mr')).toBe(true);
  });
});
