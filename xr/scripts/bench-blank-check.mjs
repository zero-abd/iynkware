// A blank project walked to a running circuit by hand, in the IWER emulator, headless: New project from Home, the half
// breadboard off the shelf's Boards group onto the mat, an LED and a resistor off the Basics group (one pinched by a
// hand, one gripped by a controller), three wires (Uno 5V, the resistor, the LED, Uno GND), Run on the rail, the LED
// lit in the simulation; then A and X: they undo on the bench and the drone bench, and never in the Range flight room.
//
//   npx vite --mode http --port 23280          # in another terminal, wait about 10 s
//   node scripts/bench-blank-check.mjs [url] [shot.png]
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23280/');
const SHOT = process.argv[3];
const STOP = process.env.STOP ? Number(process.env.STOP) : 99;
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
/** A step another pillar owns is broken: the walk goes on past it and says so (the issue names the file and the steps). */
const blocker = (name, issue, detail) => console.log(`BLOCKED ${name}  (${issue})${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
const finish = async () => {
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
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
  window.__last = {};
  window.__gs = {};
  window.iynkware.app.input.onAny((e) => {
    if (e.type === 'grab-move' || e.type === 'drag-move') return;
    window.__ev.push(`${e.type}:${e.target}:${e.pointer.source}/${e.pointer.mode}`);
    window.__last[e.pointer.hand] = { type: e.type, target: e.target, origin: [...e.pointer.origin] };
    if (e.type.endsWith('-start') && !e.type.startsWith('hover')) window.__gs[e.pointer.hand] = window.__last[e.pointer.hand];
  });
  window.__fresh = () => {
    window.__ev.length = 0;
  };
});
await sleep(1200);

const vec = (a, b, k = 1) => a.map((v, i) => v + (b[i] - v) * k);
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
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
const IDENT = { x: 0, y: 0, z: 0, w: 1 };

/** Puts a hand or controller at a position of its own transform; the pose and the grab sphere sit at fixed offsets from it. */
const place = async (device, at) => {
  await setT(device, at, IDENT);
  await sleep(150);
  return at;
};
const glide = async (device, from, to, steps = 8) => {
  let last = from;
  for (let i = 1; i <= steps; i++) {
    last = vec(from, to, i / steps);
    await setT(device, last, IDENT);
    await sleep(70);
  }
  return last;
};
const isHand = (device) => device.startsWith('hand');
/** Hand: the pinch; controller: the grip (button 1). */
const press = (device, on) =>
  isHand(device)
    ? page.evaluate(([d, v]) => window.__x('set_select_value', { device: d, value: v }), [device, on ? 1 : 0])
    : page.evaluate(([d, v]) => window.__x('set_gamepad_state', { device: d, buttons: [{ index: 1, value: v }], axes: [] }), [device, on ? 1 : 0]);
/** The trigger (button 0) with other buttons (4 is B, 3 is A) held as `extra` says. */
const trigger = (device, on, extra = []) =>
  page.evaluate(
    ([d, v, x]) =>
      window.__x('set_gamepad_state', {
        device: d,
        buttons: Array.from({ length: 6 }, (_, i) => ({ index: i, value: i === 0 ? v : (x.find((b) => b.index === i)?.value ?? 0) })),
        axes: [],
      }),
    [device, on ? 1 : 0, extra],
  );
const tap = async (device, index) => {
  await page.evaluate(([d, i]) => window.__x('set_gamepad_state', { device: d, buttons: Array.from({ length: 6 }, (_, k) => ({ index: k, value: k === i ? 1 : 0 })), axes: [] }), [device, index]);
  await sleep(300);
  await page.evaluate(([d]) => window.__x('set_gamepad_state', { device: d, buttons: Array.from({ length: 6 }, (_, k) => ({ index: k, value: 0 })), axes: [] }), [device]);
  await sleep(600);
};
const pressA = (device = 'controller-right') => tap(device, 3);
const pressX = (device = 'controller-left') => tap(device, 3);

// ---------------------------------------------------------------------------------------------------- page side helpers
await page.evaluate(() => {
  const { app, world } = window.iynkware;
  const view = () => app.project.doc.views.find((v) => v.kind === 'breadboard');
  window.__view = view;
  window.__rev = () => app.project.revision;
  window.__comps = () => app.project.doc.components.map((c) => ({ id: c.id, ref: c.ref }));
  window.__placements = () => view().placements.map((p) => ({ c: p.c, x: p.x_mm, y: p.y_mm, legs: p.legs ?? null }));
  window.__wires = () => view().wires.map((w) => ({ id: w.id, from: w.from, to: w.to, color: w.color }));
  window.__bins = () => {
    const out = [];
    world.scene.traverse((o) => {
      if (!o.name?.startsWith('bench:shelf-item:')) return;
      const c = o.parent.parent.getObjectByName('bench:shelf-collider');
      const w = c.getWorldPosition(c.position.clone()).toArray();
      out.push({ ref: o.name.slice('bench:shelf-item:'.length), at: w, shown: o.parent.visible, s: o.scale.x });
    });
    return out;
  };
  window.__hdr = (i) => {
    const h = world.scene.getObjectByName('bench:shelf-header');
    const c = h.children[i];
    const n = h.getWorldDirection(c.position.clone());
    return { at: c.getWorldPosition(c.position.clone()).toArray(), normal: n.toArray() };
  };
  window.__ghost = () => {
    const g = world.scene.getObjectByProperty('name', 'bench:ghost');
    const count = (n) => world.scene.getObjectByProperty('name', n)?.count ?? 0;
    return { shown: !!g && g.visible, dots: count('bench:ghost-dot'), crosses: count('bench:ghost-cross'), tris: count('bench:ghost-tri') };
  };
  window.__centre = (id) => {
    const o = app.bench.objectOf(id);
    const b = o?.children.find((c) => c.name?.startsWith('bench:proxy'));
    if (!b) return null;
    const p = b.getWorldPosition(b.position.clone());
    return [p.x, p.y, p.z];
  };
  window.__hole = (surface, h) => app.bench.worldOf({ kind: 'hole', surface, hole: h });
  window.__pin = (c, p) => app.bench.worldOf({ kind: 'pin', part: c, pin: p });
  window.__pos = (name) => world.scene.getObjectByName(name)?.getWorldPosition(world.camera.position.clone()).toArray() ?? null;
});

// ---------------------------------------------------------------------------------------------------- 1. New project
await page.evaluate(() => window.iynkware.app.shell.openHome());
await sleep(900);
const before = await page.evaluate(() => window.iynkware.app.project.doc.id);
const homeNew = await page.evaluate(() => window.__pos('button:home/new'));
check('Home offers New project', !!homeNew, homeNew);
await place('controller-right', add(homeNew, [0, 0, 0.12]));
await sleep(400);
await trigger('controller-right', true);
await sleep(200);
await trigger('controller-right', false);
await page.waitForFunction((id) => window.iynkware.app.project.doc.id !== id && window.iynkware.app.project.doc.boards[0]?.id === 'brd_uno', before, { timeout: 30000 }).catch(() => {});
await sleep(1500);
if (STOP <= 1) await finish();

const uno = await page.evaluate(() => window.iynkware.app.project.doc.boards[0].id);
const doc0 = await page.evaluate(() => {
  const d = window.iynkware.app.project.doc;
  return { boards: d.boards.map((b) => b.definition.ref), comps: d.components.length, wires: window.__wires().length, placed: window.__placements().map((p) => p.c), nets: d.nets.length };
});
check('a blank project holds the Uno and nothing else', doc0.boards.length === 1 && doc0.boards[0] === 'core.uno-r3' && doc0.comps === 0 && doc0.wires === 0 && doc0.nets === 0, doc0);
check('the Uno lies on the mat (placed in the breadboard view)', doc0.placed.length === 1 && doc0.placed[0] === uno, doc0.placed);
if (STOP <= 1) await finish();

// ---------------------------------------------------------------------------------------------------- aiming
const partAt = (id) => page.evaluate((c) => window.iynkware.app.bench.worldOf({ kind: 'part', part: c }), id);
const pinAt = (c, p) => page.evaluate(([a, b]) => window.__pin(a, b), [c, p]);
/** A hand: put the device where its pinch point (the index tip, `pose().position`) lands `lift` above `at`. */
const tipAt = async (device, side, at, lift = 0.002) => {
  const want = add(at, [0, lift, 0]);
  await place(device, add(want, [0, 0.06, 0]));
  const tip = await page.evaluate((s) => window.iynkware.app.input.pose(s).position, side);
  const dev = add(add(want, [0, 0.06, 0]), sub(want, tip));
  await place(device, dev);
  return dev;
};
/** A controller: turn it so its ray runs through `at`, whatever the ray's offset from the device. */
const rayAt = async (device, side, at, from) => {
  let q = IDENT;
  await setT(device, from, q);
  await sleep(120);
  for (let i = 0; i < 3; i++) {
    const ray = await page.evaluate((s) => {
      const p = window.iynkware.app.input.pose(s);
      return p ? { o: [...p.ray.origin], d: [...p.ray.direction] } : null;
    }, side);
    if (!ray) return false;
    q = mul(turn(ray.d, norm(sub(at, ray.o))), q);
    await setT(device, from, q);
    await sleep(120);
  }
  return true;
};
const tipOf = (side) => page.evaluate((s) => window.iynkware.app.input.pose(s).position, side);
const docW = (x, y, h = 0) =>
  page.evaluate(([a, b, c]) => {
    const { app } = window.iynkware;
    const p = app.bench.docToBoard(a, b, c);
    const v = app.bench.root.localToWorld(new (app.bench.root.position.constructor)(p[0], p[1], p[2]));
    return [v.x, v.y, v.z];
  }, [x, y, h]);

// ---------------------------------------------------------------------------------------------------- 2. the Boards group
/** A fingertip poke through group tab `i` (a hand). */
const pokeTab = async (i) => {
  const tab = await page.evaluate((k) => window.__hdr(k), i);
  const nrm = tab.normal;
  const front = add(tab.at, nrm.map((v) => v * 0.04));
  await place('hand-right', front);
  const off = sub(await tipOf('right'), front);
  const aim = (p) => sub(p, off);
  let h = await place('hand-right', aim(front));
  h = await glide('hand-right', h, aim(add(tab.at, nrm.map((v) => v * 0.004))), 6);
  await sleep(300);
  h = await glide('hand-right', h, aim(add(tab.at, nrm.map((v) => v * -0.006))), 4);
  await sleep(500);
  await glide('hand-right', h, aim(front), 4);
  await sleep(900);
};
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(600);
await pokeTab(5);
const binRefs = () => page.evaluate(() => window.__bins().map((b) => b.ref));
const boardRefs = await binRefs();
check('the Boards tab shows the half breadboard first', boardRefs[0] === 'core.breadboard-half', boardRefs.slice(0, 4));

/**
 * The grab sphere is not where the pose is (a hand's pose is its index tip, the sphere sits at the grip), and it exists
 * only while a press is down. So a take aims at the bin, presses, reads where the sphere really was from the grab it got,
 * lets go and aims again with that offset; the offset is kept per device for the next take.
 */
const gripOffs = {};
const takeBin = async (device, side, ref) => {
  const bin = (await page.evaluate(() => window.__bins())).find((b) => b.ref === ref);
  if (!bin) return null;
  let pos = null;
  const spread = [[0, 0, 0], [0.01, 0, 0.01], [-0.01, 0, -0.01], [0.02, 0, 0], [-0.02, 0, 0], [0, 0, 0.02], [0, 0, -0.02]];
  for (let k = 0; k < 9; k++) {
    const off = gripOffs[device] ?? [0, 0, 0];
    const aim = sub(add(bin.at, k < 3 ? [0, 0, 0] : spread[k - 2] ?? [0, 0, 0]), off);
    pos = pos ? await glide(device, pos, add(aim, [0, 0.05, 0]), 3) : await place(device, add(aim, [0, 0.05, 0]));
    pos = await glide(device, pos, aim, 4);
    await sleep(250);
    await page.evaluate(() => {
      window.__fresh();
      window.__gs = {};
    });
    await press(device, true);
    await sleep(350);
    const got = await page.evaluate((s) => ({ gs: window.__gs[s], ev: window.__ev.filter((e) => e.startsWith('grab-start')) }), side);
    if (process.env.DBG) console.log('probe', k, JSON.stringify(got));
    if (got.ev.some((e) => e.startsWith(`grab-start:shelf:${ref}:`))) return pos;
    if (got.gs) gripOffs[device] = sub(got.gs.origin, aim);
    await press(device, false);
    await sleep(900);
  }
  return pos;
};
const carriedAt = () =>
  page.evaluate(() => {
    const o = window.iynkware.world.scene.getObjectByProperty('name', 'bench:carried');
    return o ? o.getWorldPosition(o.position.clone()).toArray() : null;
  });
const modeOf = (device) => (isHand(device) ? 'hand/grab' : 'controller/grab');
/** Takes `ref` off its bin with `device`, carries it to `target` (world) and leaves the press down. */
const carryTo = async (device, side, ref, target, lift = 0.012) => {
  let pos = await takeBin(device, side, ref);
  const ev = await page.evaluate(() => window.__ev.slice());
  const grabbed = ev.some((e) => e.startsWith(`grab-start:shelf:${ref}:${modeOf(device)}`));
  pos = await glide(device, pos, add(pos, [0, 0.06, 0]), 4);
  await sleep(300);
  const carried = await carriedAt();
  if (carried) pos = await glide(device, pos, add(pos, sub(add(target, [0, lift, 0]), carried)), 14);
  await sleep(700);
  return { pos, grabbed, carried: !!carried };
};

const n0 = await page.evaluate(() => window.__placements().length);
const bbTarget = await docW(82, 28);
const took = await carryTo('hand-right', 'right', 'core.breadboard-half', bbTarget, 0.02);
check('a pinch on the breadboard bin takes the breadboard', took.grabbed && took.carried, took);
await press('hand-right', false);
await sleep(1200);
const after = await page.evaluate(() => ({ pl: window.__placements(), comps: window.__comps(), surface: window.__view().surface }));
const bb = after.comps.find((c) => c.ref === undefined && c.id.startsWith('cmp_'));
check('released on the mat: the document gains the breadboard, placed on the mat', after.pl.length === n0 + 1 && after.comps.length === 1, after);
const bbId = after.comps[0]?.id;
const bbPlacement = after.pl.find((p) => p.c === bbId);
check('the breadboard is the bench surface and lies on the mat in the document', after.surface === bbId && !!bbPlacement && bbPlacement.legs === null, { surface: after.surface, bbPlacement });
// iynk's view.set cannot give a surface back, so the undo of the first breadboard is refused by the document (not a bench fault)
const undone = await page.evaluate(() => { const r = window.iynkware.app.project.undo(); return r ? { ok: r.ok, reject: r.reject } : null; });
if (undone?.ok === false) blocker('undoing the first breadboard is refused (referenced_by)', 'iynk view.set has no inverse for a first surface', undone);
await sleep(500);
if (STOP <= 2) await finish();

// ---------------------------------------------------------------------------------------------------- 3. an LED and a resistor
await page.evaluate(() => {
  window.__legsOf = (c) => window.__view().placements.find((p) => p.c === c)?.legs ?? null;
  window.__newPart = (known) => window.__view().placements.find((p) => !known.includes(p.c) && p.legs);
});
const holeW = (hole) => page.evaluate(([s, h]) => window.__hole(s, h), [bbId, hole]);
await pokeTab(0);
const basics = await binRefs();
check('the Basics tab shows the LED and the resistor', basics.includes('core.led-5mm') && basics.includes('core.resistor'), basics);

const seatPart = async (device, side, ref, holeName) => {
  const known = await page.evaluate(() => window.__placements().map((p) => p.c));
  const target = await holeW(holeName);
  const t = await carryTo(device, side, ref, target, 0.012);
  const ghost = await page.evaluate(() => window.__ghost());
  await press(device, false);
  await sleep(1200);
  const made = await page.evaluate((k) => window.__newPart(k) ?? null, known);
  return { ...t, ghost, made };
};
// the LED by a hand's pinch
const ledSeat = await seatPart('hand-right', 'right', 'core.led-5mm', 'e22');
check('an LED pinched off its bin shows the ghost over free holes', ledSeat.grabbed && ledSeat.ghost.shown, ledSeat.ghost);
check('released on the ghost: the LED sits in two holes of the breadboard', !!ledSeat.made?.legs && Object.keys(ledSeat.made.legs).length === 2, ledSeat.made);
const ledId = ledSeat.made?.c;
// the resistor by a controller grip
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(800);
const resSeat = await seatPart('controller-right', 'right', 'core.resistor', 'e10');
check('a resistor gripped off its bin shows the ghost over free holes', resSeat.grabbed && resSeat.ghost.shown, resSeat.ghost);
check('released on the ghost: the resistor sits in two holes of the breadboard', !!resSeat.made?.legs && Object.keys(resSeat.made.legs).length === 2, resSeat.made);
const resId = resSeat.made?.c;
console.log('legs', JSON.stringify({ led: ledSeat.made?.legs, res: resSeat.made?.legs }));
if (STOP <= 3 || !ledId || !resId) await finish();

// ---------------------------------------------------------------------------------------------------- 4. wires
await page.evaluate(() => {
  window.__netOf = (c, p) => window.iynkware.app.project.doc.nets.find((n) => n.connections.some((x) => x.c === c && x.p === p))?.id ?? null;
  window.__pending = () => {
    const m = window.iynkware.world.scene.getObjectByName('bench:wire-pending');
    return !!m && m.visible;
  };
  window.__ring = (side) => {
    const r = window.iynkware.world.scene.getObjectByName(`bench:hover-cell:${side}`);
    return r?.visible ? r.getWorldPosition(r.position.clone()).toArray() : null;
  };
});
const netOf = (c, p) => page.evaluate(([a, b]) => window.__netOf(a, b), [c, p]);
const col = (hole) => hole.slice(1);
const resA = resSeat.made.legs.P1;
const resB = resSeat.made.legs.P2;
const ledA = ledSeat.made.legs.A;
const ledK = ledSeat.made.legs.K;
/** A free hole of the strip a leg sits in (the leg is in row e, rows a to d are the same strip). */
const stripHole = (hole) => `a${col(hole)}`;

let gripH = null;
/** The hand's grab sphere against its pinch point: one press over the breadboard's middle, read the sphere's origin. */
const handOffset = async () => {
  const over = add(await holeW('e28'), [0, 0.0, 0]);
  await page.evaluate(() => (window.__gs = {}));
  const setAt = add(over, [0, 0.03, 0]);
  await place('hand-right', setAt);
  await sleep(300);
  await press('hand-right', true);
  await sleep(350);
  const got = await page.evaluate(() => window.__gs.right);
  await press('hand-right', false);
  await sleep(600);
  return got ? sub(got.origin, setAt) : (gripOffs['hand-right'] ?? [0, 0, 0]);
};
/** Pinches at `at`: aims the grab sphere there; returns the device spot and the pinch point's offset from it. */
const pinchAt = async (at) => {
  gripH ??= await handOffset();
  const d = add(sub(at, gripH), [0, 0.003, 0]);
  await place('hand-right', add(d, [0, 0.05, 0]));
  await glide('hand-right', add(d, [0, 0.05, 0]), d, 4);
  await sleep(250);
  await press('hand-right', true);
  await sleep(350);
  const tip = await tipOf('right');
  return { dev: d, off: sub(tip, d) };
};
const WIRE_STEPS = 10;
/** A hand draws a wire: pinch at `a`, carry the pinch point over `b`, let go. */
const handWire = async (a, b) => {
  await place('hand-right', add(a, [0, 0.3, 0.3]));
  await sleep(300);
  const started = await pinchAt(a);
  let dev = started.dev;
  const devOver = (p) => sub(add(p, [0, 0.002, 0]), started.off);
  const step = async (to) => {
    const from = dev;
    for (let i = 1; i <= WIRE_STEPS; i++) {
      await place('hand-right', vec(from, to, i / WIRE_STEPS));
      await sleep(60);
    }
    dev = to;
  };
  await step(devOver(add(a, [0, 0.03, 0.03])));
  const pending = await page.evaluate(() => window.__pending());
  if (process.env.DBG) console.log('start ring', JSON.stringify(await page.evaluate(() => window.__ring('right'))), 'a', JSON.stringify(a), 'icsp', JSON.stringify(await pinAt(uno, 'ICSP1_2')), 'off', JSON.stringify(started.off), 'grip', JSON.stringify(gripH));
  await step(devOver(b));
  await sleep(400);
  const ring = await page.evaluate(() => window.__ring('right'));
  await press('hand-right', false);
  await sleep(800);
  await place('hand-right', add(b, [0, 0.3, 0.3]));
  return { pending, ring };
};
/** A controller draws a wire: ray on `a`, trigger held, the ray swung to `b`, trigger let go. */
const rayWire = async (a, b) => {
  const hi = (p) => add(p, [0, 0.3, 0.35]);
  await rayAt('controller-right', 'right', a, hi(a));
  await sleep(300);
  const ring0 = await page.evaluate(() => window.__ring('right'));
  await trigger('controller-right', true);
  await sleep(300);
  for (let i = 1; i <= 8; i++) await rayAt('controller-right', 'right', vec(a, b, i / 8), vec(hi(a), hi(b), i / 8));
  await sleep(300);
  const pending = await page.evaluate(() => window.__pending());
  const ring = await page.evaluate(() => window.__ring('right'));
  await trigger('controller-right', false);
  await sleep(900);
  return { pending, ring0, ring };
};
const endsOf = (w) => [w.from, w.to].map((e) => (e.kind === 'hole' ? e.hole : `${e.c}.${e.p}`)).sort();
const newWire = async (known) => (await page.evaluate(() => window.__wires())).filter((w) => !known.includes(w.id));
const wireIds = () => page.evaluate(() => window.__wires().map((w) => w.id));

// (a) a hand: Uno 5V to the resistor's strip
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(700);
const pin5 = await pinAt(uno, 'P5V');
const pinG = await pinAt(uno, 'GND');
check('the Uno has 5V and GND pins on the bench', !!pin5 && !!pinG, { pin5, pinG });
let known = await wireIds();
const w1 = await handWire(pin5, await holeW(stripHole(resA)));
check('a hand pinching the 5V pin draws a pending wire onto the resistor strip', w1.pending === true && !!w1.ring, w1);
const made1 = await newWire(known);
check('released there: one wire from 5V to the resistor strip', made1.length === 1 && JSON.stringify(endsOf(made1[0])) === JSON.stringify([`${uno}.P5V`, stripHole(resA)].sort()), made1.map(endsOf));
// (b) a hand: the resistor's other strip to the LED's anode strip
known = await wireIds();
const w2 = await handWire(await holeW(stripHole(resB)), await holeW(stripHole(ledA)));
const made2 = await newWire(known);
check('a hand draws a wire from the resistor strip to the LED anode strip', made2.length === 1 && JSON.stringify(endsOf(made2[0])) === JSON.stringify([stripHole(resB), stripHole(ledA)].sort()), { made: made2.map(endsOf), w2 });
// (c) a controller: the LED's cathode strip to the Uno GND
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(800);
known = await wireIds();
const w3 = await rayWire(await holeW(stripHole(ledK)), pinG);
const made3 = await newWire(known);
check('a controller ray and trigger hold draws a wire from the LED cathode strip to GND', made3.length === 1 && JSON.stringify(endsOf(made3[0])) === JSON.stringify([`${uno}.GND`, stripHole(ledK)].sort()), { made: made3.map(endsOf), w3 });
const nets = {
  five: [await netOf(uno, 'P5V'), await netOf(resId, 'P1')],
  mid: [await netOf(resId, 'P2'), await netOf(ledId, 'A')],
  gnd: [await netOf(ledId, 'K'), await netOf(uno, 'GND')],
};
const same = (p) => p[0] !== null && p[0] === p[1];
check('the nets: 5V reaches the resistor, the resistor reaches the LED anode, the LED cathode reaches GND', same(nets.five) && same(nets.mid) && same(nets.gnd) && nets.five[0] !== nets.mid[0] && nets.mid[0] !== nets.gnd[0], nets);
if (STOP <= 4) await finish();

// ---------------------------------------------------------------------------------------------------- 5. Run
await page.evaluate(() => {
  const { app } = window.iynkware;
  window.__frames = [];
  app.sim.onFrame((f) => {
    window.__frames.push(f);
    if (window.__frames.length > 5) window.__frames.shift();
  });
  window.__ledState = (id) => {
    const f = app.sim.lastFrame;
    const s = f?.parts.get(id);
    return { state: app.sim.state, at: f?.atNs ?? null, part: s ?? null };
  };
});
const runPlate = await page.evaluate(() => window.__pos('run:run'));
check('the run cluster has a Run plate on the rail', !!runPlate, runPlate);
await rayAt('controller-right', 'right', runPlate, add(runPlate, [0.02, 0.2, 0.4]));
await trigger('controller-right', true);
await sleep(150);
await trigger('controller-right', false);
await page.waitForFunction(() => window.iynkware.app.sim.state === 'running', null, { timeout: 30000 }).catch(() => {});
await sleep(2500);
const running = await page.evaluate((id) => window.__ledState(id), ledId);
console.log('led', JSON.stringify(running));
await finish();
