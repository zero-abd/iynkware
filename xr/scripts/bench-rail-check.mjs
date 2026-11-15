// Undo, Redo and the ticker on the bench rail in the IWER emulator: Undo and Redo are greyed in a fresh project, a wire is
// drawn by hand, a fingertip poke on Undo removes it (ticker: Undid), the ray and trigger on Redo bring it back
// (Redid), the controller's A button undoes it again, and A does nothing when there is nothing to undo.
//
//   npx vite --mode http --port 23231          # in another terminal
//   node scripts/bench-rail-check.mjs [url] [rail.png]
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


// ---------------------------------------------------------------------------------------------------- the rail
await page.evaluate(() => {
  const { world } = window.iynkware;
  window.__rail = () => {
    const r = world.scene.getObjectByName('bench:rail');
    if (!r) return null;
    const plates = r.children.filter((c) => c.type === 'Group');
    const at = (g) => g.getWorldPosition(g.position.clone()).toArray();
    const tick = r.children.find((c) => c.name === 'bench:ticker');
    return {
      undo: at(plates[0]),
      redo: at(plates[1]),
      undoOff: plates[0].userData.disabled,
      redoOff: plates[1].userData.disabled,
      ticker: tick ? { text: tick.userData.text, visible: tick.visible } : null,
    };
  };
});
const rail0 = await page.evaluate(() => window.__rail());
check('the rail has Undo and Redo plates', !!rail0 && rail0.undo.length === 3);
check('Undo and Redo are greyed in a fresh project', rail0?.undoOff === true && rail0?.redoOff === true, rail0 && { undoOff: rail0.undoOff, redoOff: rail0.redoOff });

// a wire by hand: a controller ray from the Uno's D13 pin to a hole
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(800);
const pin = await page.evaluate(() => window.__pin('brd_main', 'D13'));
const holeC = await page.evaluate(() => window.__hole('e27'));
const pinRay = [pin[0], pin[1] + 0.3, pin[2] + 0.35];
await rayAt('controller-right', 'right', pin, pinRay);
await sleep(300);
await trigger('controller-right', true);
await sleep(300);
for (let i = 1; i <= 8; i++) {
  await rayAt('controller-right', 'right', vec(pin, holeC, i / 8), vec(pinRay, [holeC[0], holeC[1] + 0.3, holeC[2] + 0.35], i / 8));
}
await sleep(300);
await trigger('controller-right', false);
await sleep(800);
const wiresN = (await page.evaluate(() => window.__wires())).length;
check('a wire was added by hand', wiresN === wires0.length + 1, { wiresN });
const rail1 = await page.evaluate(() => window.__rail());
check('Undo is live now, Redo is greyed', rail1?.undoOff === false && rail1?.redoOff === true, rail1 && { undoOff: rail1.undoOff, redoOff: rail1.redoOff });
check('the ticker says the wire was joined', rail1?.ticker?.visible === true && /D13/.test(rail1.ticker.text), rail1?.ticker);

// (1) a fingertip pokes Undo
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(700);
const u = rail1.undo;
let dev = await tipAt('hand-right', 'right', add(u, [0, 0.05, 0.03]), 0);
for (let i = 1; i <= 12; i++) {
  await place('hand-right', 'right', add(dev, [0, -0.07 * (i / 12), -0.04 * (i / 12)]));
  await sleep(70);
}
await sleep(600);
check('poking Undo with a fingertip removes the wire', (await page.evaluate(() => window.__wires())).length === wires0.length, (await page.evaluate(() => window.__wires())).length);
const rail2 = await page.evaluate(() => window.__rail());
check('the ticker says "Undid: wire"', rail2?.ticker?.text === 'Undid: wire' && rail2.ticker.visible, rail2?.ticker);
check('Undo is greyed again, Redo is live', rail2?.undoOff === true && rail2?.redoOff === false);
await place('hand-right', 'right', add(u, [0, 0.4, 0.3]));
await sleep(500);

// (2) the ray and the trigger on Redo
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(800);
const rd = rail2.redo;
check('the ray can be aimed at Redo', await rayAt('controller-right', 'right', rd, add(rd, [0.02, 0.2, 0.4])));
await trigger('controller-right', true);
await sleep(150);
await trigger('controller-right', false);
await sleep(700);
check('the ray and trigger on Redo bring the wire back', (await page.evaluate(() => window.__wires())).length === wires0.length + 1);
const rail3 = await page.evaluate(() => window.__rail());
check('the ticker says "Redid: wire"', rail3?.ticker?.text === 'Redid: wire', rail3?.ticker);

// (3) the controller's A button
await trigger('controller-right', false, [{ index: 3, value: 1 }]);
await sleep(300);
await trigger('controller-right', false, [{ index: 3, value: 0 }]);
await sleep(700);
check('the A button undoes it again', (await page.evaluate(() => window.__wires())).length === wires0.length);
const rail4 = await page.evaluate(() => window.__rail());
check('the ticker says "Undid: wire" again', rail4?.ticker?.text === 'Undid: wire' && rail4.ticker.visible, rail4?.ticker);
if (SHOT_PENDING) await page.screenshot({ path: SHOT_PENDING });

// nothing left to undo: A does nothing
const revEnd = await page.evaluate(() => window.__rev());
await trigger('controller-right', false, [{ index: 3, value: 1 }]);
await sleep(300);
await trigger('controller-right', false, [{ index: 3, value: 0 }]);
await sleep(500);
check('with nothing to undo, A changes nothing', (await page.evaluate(() => window.__rev())) === revEnd);

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
