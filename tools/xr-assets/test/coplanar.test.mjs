// Coplanar faces keep the figure's paint order (#132): a face drawn over an earlier face in the same plane is lifted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coplanarLayers, MAX_LAYERS } from '../gltf/coplanar.mjs';

// an axis-aligned square in the plane y = h, facing +y (metres)
const sq = (x0, z0, s, h = 0, n = [0, 1, 0]) => ({ v: [[x0, h, z0], [x0, h, z0 + s], [x0 + s, h, z0 + s], [x0 + s, h, z0]], n });

test('a face drawn over an earlier one in its plane is one layer up; the earlier one stays put', () => {
  assert.deepEqual(coplanarLayers([sq(0, 0, 0.01), sq(0.002, 0.002, 0.004)]), [0, 1]);
});

test('each face sits one layer above the highest face it covers', () => {
  // a hub, a gap on it, a mark on the gap, and a second gap beside the first (on the hub only)
  const layers = coplanarLayers([sq(0, 0, 0.02), sq(0.001, 0.001, 0.005), sq(0.002, 0.002, 0.001), sq(0.01, 0.01, 0.005)]);
  assert.deepEqual(layers, [0, 1, 2, 1]);
});

test('touching, apart, back to back, or a plane away: nothing is lifted', () => {
  assert.deepEqual(coplanarLayers([sq(0, 0, 0.01), sq(0.01, 0, 0.01)]), [0, 0], 'sharing an edge');
  assert.deepEqual(coplanarLayers([sq(0, 0, 0.01), sq(0.02, 0, 0.01)]), [0, 0], 'apart');
  assert.deepEqual(coplanarLayers([sq(0, 0, 0.01), sq(0, 0, 0.01, 0, [0, -1, 0])]), [0, 0], 'facing the other way');
  assert.deepEqual(coplanarLayers([sq(0, 0, 0.01), sq(0, 0, 0.01, 0.001)]), [0, 0], '1 mm above');
});

test('faces within the plane tolerance (the figure\'s 0.03 mm decal offsets) count as one plane', () => {
  assert.deepEqual(coplanarLayers([sq(0, 0, 0.01), sq(0.002, 0.002, 0.004, 0.00003)]), [0, 1]);
});

test('a concave face is tested by its area, not its bounding box', () => {
  // an L whose notch holds a later square: they share no area
  const L = { v: [[0, 0, 0], [0, 0, 0.02], [0.01, 0, 0.02], [0.01, 0, 0.01], [0.02, 0, 0.01], [0.02, 0, 0]], n: [0, 1, 0] };
  assert.deepEqual(coplanarLayers([L, sq(0.012, 0.012, 0.006)]), [0, 0]);
  assert.deepEqual(coplanarLayers([L, sq(0.005, 0.005, 0.01)]), [0, 1]);
});

test('a tilted plane works like an axis plane, and the lift is capped', () => {
  const k = Math.SQRT1_2, n = [k, k, 0];
  const tilt = (s, o) => ({ v: [[o * k, -o * k, o], [o * k, -o * k, o + s], [(o + s) * k, -(o + s) * k, o + s], [(o + s) * k, -(o + s) * k, o]], n });
  assert.deepEqual(coplanarLayers([tilt(0.01, 0), tilt(0.004, 0.002)]), [0, 1]);
  const stack = Array.from({ length: MAX_LAYERS + 3 }, () => sq(0, 0, 0.01));
  assert.deepEqual(coplanarLayers(stack), stack.map((_, i) => Math.min(i, MAX_LAYERS)));
});
