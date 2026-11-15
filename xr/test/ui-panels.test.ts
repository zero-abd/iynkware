import { Group, Quaternion, Vector3 } from '@iwsdk/core';
import { describe, expect, test } from 'vitest';
import { BENCH_BOX, beginDrag, clampReach, heldPoint, keepAboveBench, REACH, type MVec3 } from '../src/ui/panels/drag';
import { barCentreY, barWidth, dropOf, GRIP_DMM } from '../src/ui/panels/grip';
import { createPanelPlaces, type PanelPlaces } from '../src/ui/panels/registry';
import { createPlaceStore, formatPlaces, parsePlaces, PLACES_KEY, type StorageLike } from '../src/ui/panels/store';
import { PANELS_COPY } from '../src/ui/panels/copy';
import { LANGS } from '../src/contracts/common';
import { dmm } from '../src/look/type';

const near = (a: readonly number[], b: readonly number[], d = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i] ?? NaN, d));
const unit = (d: MVec3): MVec3 => {
  const l = Math.hypot(...d);
  return [d[0] / l, d[1] / l, d[2] / l];
};
const ray = (origin: MVec3, direction: MVec3) => ({ origin, direction: unit(direction), mode: 'ray' as const });
const hand = (origin: MVec3) => ({ origin, direction: [0, 0, -1] as MVec3, mode: 'grab' as const });

describe('ui/panels drag maths', () => {
  test('a ray holds the hit at its depth: the panel swings with the ray', () => {
    const hold = beginDrag([0, 1.2, -1], ray([0, 1.5, 0], [0, -0.3, -1]), [0, 1.2, -1]);
    near(heldPoint(hold, ray([0, 1.5, 0], [0, -0.3, -1]), [0, 0, 0]), [0, 1.2, -1]);
    // Turn the ray 90 degrees to the right: the panel goes round at the same distance from the ray's origin.
    const turned = heldPoint(hold, ray([0, 1.5, 0], [1, -0.3, 0]), [0, 0, 0]);
    near(turned, [1, 1.2, 0]);
  });

  test('the panel keeps its offset from the held point (the grip is under its centre)', () => {
    const d: MVec3 = [0, -0.4, -1];
    const l = Math.hypot(...d);
    const dir: MVec3 = [d[0] / l, d[1] / l, d[2] / l];
    const hold = beginDrag([0, 1.3, -1], ray([0, 1.5, 0], dir), [0, 1.1, -1]);
    near(hold.offset, [0, 0.2, 0]);
    near(heldPoint(hold, ray([0, 1.5, 0], dir), [0, 0, 0]), [0, 1.3, -1]);
  });

  test('a near pinch holds the hand: the panel follows it one to one', () => {
    const hold = beginDrag([0.1, 1.2, -0.5], hand([0.1, 1.05, -0.45]));
    expect(hold.depth).toBe(0);
    near(heldPoint(hold, hand([0.3, 1.1, -0.6]), [0, 0, 0]), [0.3, 1.25, -0.65]);
  });

  test('reach: 0.3 to 2 m from the eyes, along the line from the eye', () => {
    expect(REACH).toEqual({ min: 0.3, max: 2.0 });
    const eye: MVec3 = [0, 1.6, 0];
    near(clampReach([0, 1.6, -5], eye), [0, 1.6, -2]);
    near(clampReach([0, 1.6, -0.1], eye), [0, 1.6, -0.3]);
    near(clampReach([0.6, 1.2, -0.8], eye), [0.6, 1.2, -0.8]);
    // On the eye itself: straight ahead at the near limit.
    near(clampReach([0, 1.6, 0], eye), [0, 1.6, -0.3]);
  });

  test('never under the bench top when over the bench; above the floor beside it', () => {
    // Over the bench: lowest edge (0.2 under the origin) kept 15 mm above the top.
    near(keepAboveBench([0, 0.05, 0], 0.2, -0.8), [0, 0.2 + BENCH_BOX.clear, 0]);
    // A wide panel just off the side still counts as over it.
    near(keepAboveBench([0.6, 0, 0], 0.1, -0.8, 0.2), [0.6, 0.1 + BENCH_BOX.clear, 0]);
    // Well beside the bench it may go lower, down to the floor's clearance.
    near(keepAboveBench([1.2, -0.5, 0], 0.1, -0.8), [1.2, -0.5, 0]);
    near(keepAboveBench([1.2, -0.9, 0], 0.1, -0.8), [1.2, -0.8 + BENCH_BOX.floorClear + 0.1, 0]);
    // High enough already: untouched.
    near(keepAboveBench([0, 0.5, 0], 0.2, -0.8), [0, 0.5, 0]);
  });
});

describe('ui/panels store', () => {
  const memory = (): StorageLike & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };

  test('a place set is kept in storage and read back by a new store (a reload)', () => {
    const s = memory();
    const a = createPlaceStore(s);
    a.set('shell/home', [0.1, 0.5, -0.9]);
    a.set('learn/guide', [0.4, 0.3, -0.6]);
    expect(s.data.has(PLACES_KEY)).toBe(true);
    const b = createPlaceStore(s);
    near(b.get('shell/home')!, [0.1, 0.5, -0.9]);
    near(b.get('learn/guide')!, [0.4, 0.3, -0.6]);
    expect(b.ids().sort()).toEqual(['learn/guide', 'shell/home']);
  });

  test('clear forgets everything and removes the record', () => {
    const s = memory();
    const a = createPlaceStore(s);
    a.set('x', [0, 0, 0]);
    a.clear();
    expect(a.get('x')).toBeUndefined();
    expect(s.data.has(PLACES_KEY)).toBe(false);
    expect(createPlaceStore(s).ids()).toEqual([]);
  });

  test('broken, foreign or out-of-range records are skipped', () => {
    expect(parsePlaces('nope').size).toBe(0);
    expect(parsePlaces(JSON.stringify({ v: 2, places: { a: [0, 0, 0] } })).size).toBe(0);
    const m = parsePlaces(JSON.stringify({ v: 1, places: { a: [0, 1, 2], b: [0, 'x', 1], c: [0, 0], d: [99, 0, 0], e: [0, 0, null] } }));
    expect([...m.keys()]).toEqual(['a']);
  });

  test('storage that throws keeps places in memory', () => {
    const bad: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => undefined,
    };
    const a = createPlaceStore(bad);
    a.set('p', [1, 2, 3]);
    near(a.get('p')!, [1, 2, 3]);
    expect(createPlaceStore(null).get('p')).toBeUndefined();
  });

  test('the record rounds to a tenth of a millimetre', () => {
    expect(formatPlaces(new Map([['a', [0.123456, 1, -0.00004] as MVec3]]))).toBe('{"v":1,"places":{"a":[0.1235,1,0]}}');
  });
});

describe('ui/panels grip geometry', () => {
  test('the bar sits under the lower edge, clear of the panel shadow, its hit touching the edge', () => {
    const d = 1;
    const y = barCentreY(0, 0.5, d);
    expect(y).toBeLessThan(-0.25 - dmm(PANEL_SHADOW_DMM, d));
    // The hit's top reaches the panel's lower edge, never over the panel's own controls.
    expect(y + dmm(GRIP_DMM.hitH / 2, d)).toBeLessThanOrEqual(-0.25 + 1e-9);
    expect(dropOf(0, 0.5, d)).toBeCloseTo(-(y - dmm(GRIP_DMM.hitH / 2, d)), 9);
  });

  test('a panel standing on the bench carries it over its upper edge; its drop is then its own lower edge', () => {
    const y = barCentreY(0, 0.62, 0.62, 'top');
    expect(y).toBeGreaterThan(0.31);
    expect(dropOf(0, 0.62, 0.62, 'top')).toBeCloseTo(0.31, 9);
    // Off-centre roots (a card with its buttons under it).
    expect(barCentreY(-0.05, 0.3, 1)).toBeCloseTo(barCentreY(0, 0.3, 1) - 0.05, 9);
  });

  test('the bar is about a third of the panel wide, within its limits', () => {
    expect(barWidth(0.8, 1)).toBeCloseTo(dmm(GRIP_DMM.maxW, 1), 9);
    expect(barWidth(0.15, 0.8)).toBeCloseTo(dmm(GRIP_DMM.minW, 0.8), 9);
    expect(barWidth(0.4, 1)).toBeCloseTo(0.136, 9);
  });

  test('Tidy up is in all six languages', () => {
    for (const l of LANGS) expect(PANELS_COPY.tidy[l]?.length ?? 0).toBeGreaterThan(0);
  });
});

const PANEL_SHADOW_DMM = 6;

describe('ui/panels registry: the late pass, persistence and Tidy up', () => {
  const setup = (store = createPlaceStore(null)) => {
    const scene = new Group();
    const bench = new Group();
    bench.position.set(0, 0.8, -0.6);
    bench.rotation.y = 0.3;
    scene.add(bench);
    const eyeAt = new Vector3(0, 1.6, 0);
    const places: PanelPlaces = createPanelPlaces({ store, frame: bench, scene, bench: true, eye: (out) => out.copy(eyeAt) });
    const panel = new Group();
    panel.position.set(0.1, 0.5, -0.2);
    bench.add(panel);
    const shown: boolean[] = [];
    let attached = 0;
    const h = places.add({
      id: 'learn/guide',
      group: panel,
      drop: 0.25,
      halfWidth: 0.26,
      onShown: (s) => void shown.push(s),
      onAttached: () => void attached++,
    });
    return { scene, bench, panel, places, h, shown, eyeAt, store, attached: () => attached };
  };
  const worldOf = (o: Group) => o.getWorldPosition(new Vector3());

  test('a panel nobody moved keeps its pillar place; the pass only notes it', () => {
    const { panel, places, attached, shown } = setup();
    places.step();
    near(panel.position.toArray(), [0.1, 0.5, -0.2]);
    expect(attached()).toBe(1);
    expect(shown).toEqual([true]);
    places.step();
    expect(attached()).toBe(1);
  });

  test('a ray drag moves it, turns it to the eyes, and it stays where it is released', () => {
    const { panel, places, h, eyeAt, store } = setup();
    places.step();
    const start = worldOf(panel);
    const origin: MVec3 = [0.2, 1.3, -0.1];
    const toPanel = start.clone().sub(new Vector3(...origin));
    const dir = toPanel.clone().normalize().toArray() as MVec3;
    h.begin(ray(origin, dir), start.toArray() as MVec3);
    expect(h.dragging).toBe(true);
    // Sweep the ray 0.3 rad to the left.
    const turned = new Vector3(...dir).applyAxisAngle(new Vector3(0, 1, 0), 0.3).toArray() as MVec3;
    h.move(ray(origin, turned));
    places.step();
    const moved = worldOf(panel);
    expect(moved.distanceTo(new Vector3(...origin))).toBeCloseTo(toPanel.length(), 4);
    expect(moved.distanceTo(start)).toBeGreaterThan(0.1);
    // Facing the eyes: its +z points at the eye.
    const z = new Vector3(0, 0, 1).applyQuaternion(panel.getWorldQuaternion(new Quaternion()));
    const toEye = eyeAt.clone().sub(moved).normalize();
    expect(z.dot(toEye)).toBeCloseTo(1, 5);
    h.end();
    expect(h.dragging).toBe(false);
    expect(store.get('learn/guide')).toBeDefined();
    // The pillar puts it back at its old place (it re-places on a layout change): the person's place wins.
    panel.position.set(0.1, 0.5, -0.2);
    places.step();
    expect(worldOf(panel).distanceTo(moved)).toBeLessThan(1e-6);
  });

  test('a stored place comes back on the first frame it is shown (a reload), relative to the bench', () => {
    const store = createPlaceStore(null);
    store.set('learn/guide', [-0.3, 0.35, -0.1]);
    const { panel, places, bench } = setup(store);
    places.step();
    near(worldOf(panel).toArray(), bench.localToWorld(new Vector3(-0.3, 0.35, -0.1)).toArray(), 5);
    // Recentre moves the bench: the panel goes with it.
    bench.position.set(0.5, 0.8, -0.4);
    bench.updateMatrixWorld(true);
    places.step();
    near(worldOf(panel).toArray(), bench.localToWorld(new Vector3(-0.3, 0.35, -0.1)).toArray(), 5);
  });

  test('Tidy up forgets the place and puts the panel back at its pillar place', () => {
    const store = createPlaceStore(null);
    store.set('learn/guide', [-0.3, 0.35, -0.1]);
    const { panel, places } = setup(store);
    places.step();
    expect(panel.position.distanceTo(new Vector3(0.1, 0.5, -0.2))).toBeGreaterThan(0.1);
    places.tidy();
    near(panel.position.toArray(), [0.1, 0.5, -0.2]);
    expect(store.get('learn/guide')).toBeUndefined();
    places.step();
    near(panel.position.toArray(), [0.1, 0.5, -0.2]);
  });

  test('Tidy up restores the latest pillar place, also for a panel that is closed now', () => {
    const store = createPlaceStore(null);
    store.set('learn/guide', [-0.3, 0.35, -0.1]);
    const { panel, places } = setup(store);
    places.step();
    // The pillar re-places it (a posture change), the pass overrides it again.
    panel.position.set(0.2, 0.45, -0.25);
    places.step();
    panel.visible = false;
    places.step();
    places.tidy();
    near(panel.position.toArray(), [0.2, 0.45, -0.25]);
  });

  test('a hidden or closed panel is not placed and its grip is told (no rays)', () => {
    const store = createPlaceStore(null);
    store.set('learn/guide', [-0.3, 0.35, -0.1]);
    const { panel, places, shown } = setup(store);
    (panel as { pointerEvents?: string }).pointerEvents = 'none';
    places.step();
    near(panel.position.toArray(), [0.1, 0.5, -0.2]);
    expect(shown).toEqual([]);
    (panel as { pointerEvents?: string }).pointerEvents = undefined;
    places.step();
    expect(shown).toEqual([true]);
    panel.visible = false;
    places.step();
    expect(shown).toEqual([true, false]);
  });

  test('a drag never puts it under the bench top, nor further than 2 m', () => {
    const { panel, places, h, bench, eyeAt } = setup();
    places.step();
    const start = worldOf(panel);
    h.begin(hand(start.toArray() as MVec3));
    // Push the hand down through the bench.
    h.move(hand([start.x, 0.2, start.z]));
    places.step();
    const local = bench.worldToLocal(worldOf(panel));
    expect(local.y - 0.25).toBeGreaterThanOrEqual(BENCH_BOX.clear - 1e-9);
    // Throw it far away.
    h.move(hand([0, 1.6, -6]));
    places.step();
    expect(worldOf(panel).distanceTo(eyeAt)).toBeCloseTo(2, 5);
    h.end();
  });

  test('a panel not in the scene is left alone until it is (input binds only then)', () => {
    const scene = new Group();
    const bench = new Group();
    scene.add(bench);
    const places = createPanelPlaces({ store: createPlaceStore(null), frame: bench, scene, bench: true, eye: (o) => o.set(0, 1.6, 0) });
    const loose = new Group();
    let attached = 0;
    places.add({ id: 'a', group: loose, drop: 0.1, halfWidth: 0.1, onAttached: () => void attached++ });
    places.step();
    expect(attached).toBe(0);
    scene.add(loose);
    places.step();
    expect(attached).toBe(1);
    expect(places.ids()).toEqual(['a']);
  });
});
