// Wiring by hand in the IWER emulator, headless, the way a person does it: a hand pinches a free breadboard hole and
// draws a wire to a free hole of another strip (the ring shows there; release adds one wire with exactly those ends;
// undo removes it), a controller trigger on the ray draws one from an Uno header pin to a hole, a refused end changes
// nothing and says why, releasing over nothing changes nothing, B cancels, selecting a wire opens its chip (green,
// Remove, undo), and a pinch on a seated part's body still grabs the part.
//
//   npx vite --mode http --port 23231          # in another terminal
//   node scripts/bench-wire-check.mjs [url] [pending.png] [chip.png]
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23231/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
const SHOT_PENDING = process.argv[3];
const SHOT_CHIP = process.argv[4];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || (m.type() === 'warning' && !t.includes('GL Driver'))) console.log('[page]', m.type(), t.slice(0, 300));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};

await page.goto(target.href, { waitUntil: 'load' });
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 60000 });
await page.evaluate(() => window.iynkware.ready);
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.IWER_DEVICE.remote.dispatch('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await page.evaluate(() => {
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { x: -0.3007, y: 0, z: 0, w: 0.9537 } });
  window.__ev = [];
  window.iynkware.app.input.onAny((e) => {
    if (e.type === 'grab-move' || e.type === 'drag-move') return;
    window.__ev.push(`${e.type}:${e.target}:${e.pointer.source}/${e.pointer.mode}`);
    window.__last[e.pointer.hand] = { type: e.type, target: e.target, origin: [...e.pointer.origin] };
  });
  window.__last = {};
  const { app } = window.iynkware;
  window.__placement = (id) => app.project.doc.views.find((v) => v.kind === 'breadboard').placements.find((p) => p.c === id);
  window.__hole = (h) => app.bench.worldOf({ kind: 'hole', surface: 'cmp_bb', hole: h });
  window.__centre = (id) => {
    const o = app.bench.objectOf(id);
    const b = o.children.find((c) => c.name?.startsWith('bench:proxy'));
    const p = b.getWorldPosition(b.position.clone());
    return [p.x, p.y, p.z];
  };
  window.__ghost = () => {
    const { world } = window.iynkware;
    const g = world.scene.getObjectByProperty('name', 'bench:ghost');
    const count = (n) => world.scene.getObjectByProperty('name', n)?.count ?? 0;
    return { shown: !!g && g.visible, dots: count('bench:ghost-dot'), crosses: count('bench:ghost-cross'), tris: count('bench:ghost-tri') };
  };
  window.__fresh = () => {
    window.__ev.length = 0;
  };
});
await sleep(1200);

const vec = (a, b, k = 1) => a.map((v, i) => v + (b[i] - v) * k);
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);

/** Puts a hand or controller at a position of its own transform; the pose and the grab sphere sit at fixed offsets from it. */
const place = async (device, _side, at) => {
  await page.evaluate(([d, q]) => window.__x('set_transform', { device: d, position: { x: q[0], y: q[1], z: q[2] }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [device, at]);
  await sleep(150);
  return at;
};
const glide = async (device, side, from, to, steps = 8) => {
  let last = from;
  for (let i = 1; i <= steps; i++) {
    last = vec(from, to, i / steps);
    await page.evaluate(([d, q]) => window.__x('set_transform', { device: d, position: { x: q[0], y: q[1], z: q[2] }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [device, last]);
    await sleep(70);
  }
  return last;
};
/**
 * The grab sphere is not where `pose().position` is (a hand's pose is its index tip, the sphere sits at the grip), and it
 * exists only while a press is down: press once over the middle of the breadboard (nothing there takes it), read the
 * pointer's origin from the event and let go, so a later press can be aimed at an item.
 */
const press = (device, on) =>
  device.startsWith('hand')
    ? page.evaluate(([d, v]) => window.__x('set_select_value', { device: d, value: v }), [device, on ? 1 : 0])
    : page.evaluate(([d, v]) => window.__x('set_gamepad_state', { device: d, buttons: [{ index: 1, value: v }], axes: [] }), [device, on ? 1 : 0]);
const calibrate = async (device, side) => {
  const over = await page.evaluate(() => {
    const b = window.iynkware.app.bench.objectOf('cmp_bb').children.find((c) => c.name.startsWith('bench:proxy'));
    return b.getWorldPosition(b.position.clone()).toArray();
  });
  await page.evaluate(() => (window.__last = {}));
  const setAt = add(over, [0, 0.01, 0]);
  await place(device, side, setAt);
  await sleep(300);
  await press(device, true);
  await sleep(350);
  const got = await page.evaluate(([s]) => ({ last: window.__last[s] }), [side]);
  await press(device, false);
  await sleep(300);
  if (!got.last || got.last.type === undefined) return [0, 0, 0];
  return sub(got.last.origin, setAt);
};
const legsOf = (id) => page.evaluate((c) => window.__placement(c)?.legs ?? null, id);



// ---------------------------------------------------------------------------------------------------- page side helpers
await page.evaluate(() => {
  const { app, world } = window.iynkware;
  const view = () => app.project.doc.views.find((v) => v.kind === 'breadboard');
  window.__wires = () => view().wires.map((w) => ({ id: w.id, from: w.from, to: w.to, color: w.color }));
  window.__rev = () => app.project.revision;
  window.__pending = () => {
    const m = world.scene.getObjectByName('bench:wire-pending');
    return !!m && m.visible;
  };
  window.__ring = (side) => {
    const r = world.scene.getObjectByName(`bench:hover-cell:${side}`);
    return r?.visible ? r.getWorldPosition(r.position.clone()).toArray() : null;
  };
  window.__callouts = () => {
    let n = 0;
    world.scene.traverse((o) => {
      if (o.name === 'look:callout' && o.visible && o.parent && !o.parent.name.startsWith('bench:hover-name') && !o.parent.name.startsWith('bench:wire-chip')) n++;
    });
    return n;
  };
  window.__chip = () => {
    const c = world.scene.getObjectByName('bench:wire-chip');
    return c ? { plates: c.children.filter((x) => x.type === 'Group').map((g) => g.getWorldPosition(g.position.clone()).toArray()) } : null;
  };
  window.__pin = (c, p) => app.bench.worldOf({ kind: 'pin', part: c, pin: p });
  window.__mid = (id) => app.bench.worldOf({ kind: 'wire', wire: id });
  window.__legHoles = () => view().placements.flatMap((p) => Object.values(p.legs ?? {}));
});

const wires0 = await page.evaluate(() => window.__wires());
const legHoles = await page.evaluate(() => window.__legHoles());
const START = 'e10';
const END = 'e15';
check('the holes the walk uses are free', !legHoles.includes(START) && !legHoles.includes(END), { legHoles });

// ---------------------------------------------------------------------------------------------------- aiming
const norm = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** The quaternion (x, y, z, w) turning unit vector `a` onto `b`. */
const turn = (a, b) => {
  const c = cross(a, b);
  const w = 1 + dot(a, b);
  if (w < 1e-6) return { x: 0, y: 1, z: 0, w: 0 };
  const l = Math.hypot(c[0], c[1], c[2], w);
  return { x: c[0] / l, y: c[1] / l, z: c[2] / l, w: w / l };
};
const mul = (p, q) => ({
  w: p.w * q.w - p.x * q.x - p.y * q.y - p.z * q.z,
  x: p.w * q.x + p.x * q.w + p.y * q.z - p.z * q.y,
  y: p.w * q.y - p.x * q.z + p.y * q.w + p.z * q.x,
  z: p.w * q.z + p.x * q.y - p.y * q.x + p.z * q.w,
});
const setT = (device, position, orientation) =>
  page.evaluate(([d, p, o]) => window.__x('set_transform', { device: d, position: { x: p[0], y: p[1], z: p[2] }, orientation: o }), [device, position, orientation]);

/** A hand: put the device where its pinch point (the index tip, `pose().position`) lands `lift` above `at`. */
const tipAt = async (device, side, at, lift = 0.002) => {
  const want = add(at, [0, lift, 0]);
  await place(device, side, add(want, [0, 0.06, 0]));
  const tip = await page.evaluate((s) => window.iynkware.app.input.pose(s).position, side);
  const dev = add(add(want, [0, 0.06, 0]), sub(want, tip));
  await place(device, side, dev);
  return dev;
};
/** A controller: turn it so its ray runs through `at`, whatever the ray's offset from the device. */
const rayAt = async (device, side, at, from) => {
  let q = { x: 0, y: 0, z: 0, w: 1 };
  await setT(device, from, q);
  await sleep(120);
  for (let i = 0; i < 3; i++) {
    const ray = await page.evaluate((s) => {
      const p = window.iynkware.app.input.pose(s);
      return p ? { o: [...p.ray.origin], d: [...p.ray.direction] } : null;
    }, side);
    if (!ray) return false;
    const want = norm(sub(at, ray.o));
    q = mul(turn(ray.d, want), q);
    await setT(device, from, q);
    await sleep(120);
  }
  return true;
};
const hand = (on) => press('hand-right', on);
/**
 * The emulated hand moves when it pinches (its tip goes about 9 cm, the grab sphere sits beside it), so a press is aimed
 * by the grab sphere (`calibrate`) and, once pinched, the pinch point is walked with the offset it has then.
 */
let gripOff = null;
const pinchAt = async (at) => {
  gripOff ??= await calibrate('hand-right', 'right');
  const d = add(sub(at, gripOff), [0, 0.003, 0]);
  await place('hand-right', 'right', add(d, [0, 0.05, 0]));
  await glide('hand-right', 'right', add(d, [0, 0.05, 0]), d, 4);
  await sleep(250);
  await hand(true);
  await sleep(350);
  const tip = await page.evaluate(() => window.iynkware.app.input.pose('right').position);
  return { dev: d, off: sub(tip, d) };
};
const trigger = (device, on, extra = []) =>
  page.evaluate(
    ([d, v, x]) =>
      window.__x('set_gamepad_state', {
        device: d,
        buttons: Array.from({ length: 5 }, (_, i) => ({ index: i, value: i === 0 ? v : (x.find((b) => b.index === i)?.value ?? 0) })),
        axes: [],
      }),
    [device, on ? 1 : 0, extra],
  );

// ---------------------------------------------------------------------------------------------------- 1. a hand draws a wire
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(600);
const holeA = await page.evaluate((h) => window.__hole(h), START);
const holeB = await page.evaluate((h) => window.__hole(h), END);
const rev0 = await page.evaluate(() => window.__rev());
let dev = await tipAt('hand-right', 'right', holeA);
await sleep(400);
const ringA = await page.evaluate(() => window.__ring('right'));
check('the pinch point over a free hole rings it', !!ringA && Math.hypot(...ringA.map((v, i) => v - holeA[i])) < 0.002, ringA);
await place('hand-right', 'right', add(holeA, [0, 0.3, 0.3]));
await sleep(300);
await page.evaluate(() => window.__fresh());
const started = await pinchAt(holeA);
dev = started.dev;
let off = started.off;
const stepsTo = async (to) => {
  const from = dev;
  for (let i = 1; i <= 10; i++) {
    await place('hand-right', 'right', vec(from, to, i / 10));
    await sleep(60);
  }
  dev = to;
};
const devOver = (hole) => sub(add(hole, [0, 0.002, 0]), off);
await stepsTo(devOver(add(holeA, [0, 0.03, 0.03])));
const mid = await page.evaluate(() => window.__pending());
await stepsTo(devOver(holeB));
await sleep(400);
const ringB = await page.evaluate(() => window.__ring('right'));
check('while pinching, a pending wire is drawn', mid === true && (await page.evaluate(() => window.__pending())) === true);
check('the ring runs on the cell under the pinch point, over the end hole', !!ringB && Math.hypot(...ringB.map((v, i) => v - holeB[i])) < 0.002, ringB);
if (SHOT_PENDING) await page.screenshot({ path: SHOT_PENDING });
const revMid = await page.evaluate(() => window.__rev());
check('nothing is in the document while pending', revMid === rev0, { revMid, rev0 });
await hand(false);
await sleep(700);
const wires1 = await page.evaluate(() => window.__wires());
const made = wires1.filter((w) => !wires0.some((o) => o.id === w.id));
const ends = made[0] && [made[0].from, made[0].to].map((e) => (e.kind === 'hole' ? e.hole : `${e.c}.${e.p}`)).sort();
check('release over the ringed hole adds exactly one wire with those two ends', made.length === 1 && JSON.stringify(ends) === JSON.stringify([END, START].sort()), { made, ends });
check('the pending wire is gone', (await page.evaluate(() => window.__pending())) === false);
check('the end label shows', (await page.evaluate(() => window.__callouts())) >= 1);
const wireId = made[0]?.id;
await page.evaluate(() => window.iynkware.app.project.undo());
await sleep(500);
check('one undo removes it', (await page.evaluate(() => window.__wires())).length === wires0.length);
await page.evaluate(() => window.iynkware.app.project.redo());
await sleep(700);
check('and redo brings it back', (await page.evaluate(() => window.__wires())).length === wires0.length + 1);

// ---------------------------------------------------------------------------------------------------- 2. chip on that wire (a controller ray)
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(800);
const mid2 = await page.evaluate((id) => window.__mid(id), wireId);
const from2 = add(mid2, [0.0, 0.25, 0.3]);
check('the ray can be aimed at the wire', await rayAt('controller-right', 'right', mid2, from2));
await page.evaluate(() => window.__fresh());
await trigger('controller-right', true);
await sleep(120);
await trigger('controller-right', false);
await sleep(600);
const chip = await page.evaluate(() => window.__chip());
check('a trigger tap on the wire opens its chip (ten colours and Remove)', !!chip && chip.plates.length === 11, chip && chip.plates.length);
if (SHOT_CHIP) await page.screenshot({ path: SHOT_CHIP });
const green = chip?.plates[4];
if (green) {
  await page.evaluate(() => window.__fresh());
  await rayAt('controller-right', 'right', green, add(green, [0.05, 0.1, 0.45]));
  await trigger('controller-right', true);
  await sleep(120);
  await trigger('controller-right', false);
  await sleep(600);
}
const afterGreen = (await page.evaluate(() => window.__wires())).find((w) => w.id === wireId);
check('picking green makes the wire green', afterGreen?.color === 'green', afterGreen);
check('and the chip closes', (await page.evaluate(() => window.__chip())) === null);
await page.evaluate(() => window.iynkware.app.project.undo());
await sleep(500);
check('one undo takes the colour back', (await page.evaluate(() => window.__wires())).find((w) => w.id === wireId)?.color !== 'green');
await page.evaluate(() => window.iynkware.app.project.redo());
await sleep(500);

// Remove
await rayAt('controller-right', 'right', mid2, from2);
await trigger('controller-right', true);
await sleep(120);
await trigger('controller-right', false);
await sleep(600);
const chip2 = await page.evaluate(() => window.__chip());
const rm = chip2?.plates[10];
if (rm) {
  await rayAt('controller-right', 'right', rm, add(rm, [0.05, 0.1, 0.45]));
  await trigger('controller-right', true);
  await sleep(120);
  await trigger('controller-right', false);
  await sleep(700);
}
check('Remove takes the wire out', !(await page.evaluate(() => window.__wires())).some((w) => w.id === wireId));
await page.evaluate(() => window.iynkware.app.project.undo());
await sleep(700);
check('and undo brings it back', (await page.evaluate(() => window.__wires())).some((w) => w.id === wireId));
await page.evaluate(() => window.iynkware.app.project.undo());
await sleep(500);
await page.evaluate(() => window.iynkware.app.project.undo());
await sleep(500);
check('back to the start (wires)', (await page.evaluate(() => window.__wires())).length === wires0.length);

// ---------------------------------------------------------------------------------------------------- 3. a controller ray: Uno pin to a hole
const pin = await page.evaluate(() => window.__pin('brd_main', 'D13'));
const holeC = await page.evaluate(() => window.__hole('e27'));
const pinRay = [pin[0], pin[1] + 0.3, pin[2] + 0.35];
await rayAt('controller-right', 'right', pin, pinRay);
await sleep(300);
const ringPin = await page.evaluate(() => window.__ring('right'));
check('the ray rings the Uno pin', !!ringPin && Math.hypot(...ringPin.map((v, i) => v - pin[i])) < 0.003, ringPin);
await trigger('controller-right', true);
await sleep(300);
// swing the ray to the hole, in steps
for (let i = 1; i <= 8; i++) {
  await rayAt('controller-right', 'right', vec(pin, holeC, i / 8), vec(pinRay, [holeC[0], holeC[1] + 0.3, holeC[2] + 0.35], i / 8));
}
await sleep(300);
check('the pending wire follows the ray', (await page.evaluate(() => window.__pending())) === true);
await trigger('controller-right', false);
await sleep(700);
const w3 = (await page.evaluate(() => window.__wires())).filter((w) => !wires0.some((o) => o.id === w.id));
check('release over the ringed hole adds a wire from the pin to the hole', w3.length === 1 && [w3[0].from, w3[0].to].some((e) => e.kind === 'pin' && e.p === 'D13') && [w3[0].from, w3[0].to].some((e) => e.kind === 'hole' && e.hole === 'e27'), w3);
await page.evaluate(() => window.iynkware.app.project.undo());
await sleep(500);

// ---------------------------------------------------------------------------------------------------- 4. B cancels
const revB = await page.evaluate(() => window.__rev());
await rayAt('controller-right', 'right', pin, pinRay);
await trigger('controller-right', true);
await sleep(300);
for (let i = 1; i <= 8; i++) await rayAt('controller-right', 'right', vec(pin, holeC, i / 8), vec(pinRay, [holeC[0], holeC[1] + 0.3, holeC[2] + 0.35], i / 8));
await sleep(200);
await trigger('controller-right', true, [{ index: 4, value: 1 }]);
await sleep(300);
const pendingAfterB = await page.evaluate(() => window.__pending());
await trigger('controller-right', true, [{ index: 4, value: 0 }]);
await trigger('controller-right', false);
await sleep(600);
check('B during the press cancels: no pending wire, no change', pendingAfterB === false && (await page.evaluate(() => window.__rev())) === revB, { pendingAfterB });

// ---------------------------------------------------------------------------------------------------- 5. hand: refused end, nothing, part body
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(600);
const holeSame = await page.evaluate(() => window.__hole('a10'));
const revR = await page.evaluate(() => window.__rev());
await place('hand-right', 'right', add(holeA, [0, 0.3, 0.3]));
await sleep(400);
({ dev, off } = await pinchAt(holeA));
await stepsTo(devOver(holeSame));
await sleep(300);
await hand(false);
await sleep(500);
check('a refused end (same strip) changes nothing and says why', (await page.evaluate(() => window.__rev())) === revR && (await page.evaluate(() => window.__callouts())) >= 1);
await sleep(1800);

await place('hand-right', 'right', add(holeA, [0, 0.3, 0.3]));
await sleep(400);
({ dev, off } = await pinchAt(holeA));
await stepsTo(add(dev, [0, 0.0, 0.2]));
await sleep(300);
await hand(false);
await sleep(500);
check('released over nothing: no change, no pending wire', (await page.evaluate(() => window.__rev())) === revR && (await page.evaluate(() => window.__pending())) === false);

const ledAt = await page.evaluate(() => window.__centre('cmp_led1'));
const gripH = await calibrate('hand-right', 'right');
const aimH = sub(ledAt, gripH);
let h2 = await place('hand-right', 'right', add(aimH, [0, 0.04, 0]));
h2 = await glide('hand-right', 'right', h2, aimH, 6);
await sleep(300);
await hand(true);
await sleep(350);
const outline = await page.evaluate(() => window.iynkware.app.bench.objectOf('cmp_led1').children.find((c) => c.name.startsWith('bench:outline'))?.visible);
check('a pinch on a seated part body still grabs the part, no wire starts', outline === true && (await page.evaluate(() => window.__pending())) === false, { outline });
await hand(false);
await sleep(900);

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
