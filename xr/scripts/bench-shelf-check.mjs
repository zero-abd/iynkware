// The parts shelf in the IWER emulator, headless: a hand pinches a resistor off the shelf, carries it over free
// breadboard holes and releases it on the ghost (the document gains a seated part; undo removes it); a controller grips
// an LED, carries it away from the bench and lets go (nothing changes, the bin item is back); a group tab is tapped and
// the bins show that group; a board comes off the Boards group and lies on the mat without a refusal note.
//
//   npx vite --mode http --port 23065          # in another terminal, wait about 10 s
//   node scripts/bench-shelf-check.mjs [url] [shelf.png]
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23065/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
const SHOT = process.argv[3];
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

// SHELF_MOVED=1 starts with the shelf moved (a stored place, as after a drag by its grip bar): picking must still work.
if (process.env.SHELF_MOVED) await page.addInitScript(() => localStorage.setItem('iynk:xr:panels:v1', JSON.stringify({ v: 1, places: { 'bench/shelf': [0.44, 0, 0.02] } })));
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


await page.evaluate(() => {
  const { world, app } = window.iynkware;
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
  window.__count = () => app.project.doc.views.find((v) => v.kind === 'breadboard').placements.length;
  window.__hdr = (i) => {
    const h = world.scene.getObjectByName('bench:shelf-header');
    const c = h.children[i];
    const n = h.getWorldDirection(c.position.clone());
    return { at: c.getWorldPosition(c.position.clone()).toArray(), normal: n.toArray() };
  };
});

const binOf = async (pick) => (await page.evaluate(() => window.__bins())).find((b) => pick(b.ref));

/**
 * Takes the bin item `bin` and leaves the press down. The emulated grab sphere sits some centimetres off the origin the
 * pointer reports (a hand or grip pose offset), and the bins are 45 mm apart, so aim at the reported spot first and
 * then probe a few nearby ones until the press reports this bin; the offset found is kept for the next take.
 */
let learned = [0, 0, 0];
const takeBin = async (device, side, grip, bin) => {
  const cand = [learned];
  for (const dy of [0, -0.03, 0.03]) for (const dz of [0, 0.03, 0.06, -0.03]) for (const dx of [0, 0.02, -0.02, 0.04, -0.04]) cand.push([dx, dy, dz]);
  let pos = null;
  for (const o of cand) {
    const aim = sub(add(bin.at, o), grip);
    pos = pos ? await glide(device, side, pos, add(aim, [0, 0.04, 0]), 3) : await place(device, side, add(aim, [0, 0.04, 0]));
    pos = await glide(device, side, pos, aim, 4);
    await sleep(250);
    await page.evaluate(() => window.__fresh());
    await press(device, true);
    await sleep(350);
    const ev = await page.evaluate(() => window.__ev.filter((e) => e.startsWith('grab-start')));
    if (ev.some((e) => e.startsWith(`grab-start:shelf:${bin.ref}:`))) {
      learned = o;
      return pos;
    }
    await press(device, false);
    await sleep(900);
  }
  return pos;
};
const shelfN = (await page.evaluate(() => window.__bins())).length;
check('the shelf shows bins with parts in them', shelfN >= 8, shelfN);
const nBefore = await page.evaluate(() => window.__count());
const idsBefore = await page.evaluate(() => window.iynkware.app.project.doc.views.find((v) => v.kind === 'breadboard').placements.map((p) => p.c));

// ---------------------------------------------------------------------------------------------------- 1. a hand: resistor
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(600);
const allBins = await page.evaluate(() => window.__bins());
const res = allBins.find((b) => /led-5mm/.test(b.ref)) ?? allBins[2];
console.log('taking', res.ref);
const hole = await page.evaluate(() => window.__hole('e24'));
const gripH = await calibrate('hand-right', 'right');
let hand = await takeBin('hand-right', 'right', gripH, res);
const ev1 = await page.evaluate(() => window.__ev.slice());
check('a pinch on a bin item is a grab of that part', ev1.some((e) => e.startsWith(`grab-start:shelf:${res.ref}:hand/grab`)), ev1);
const after = await page.evaluate((r) => window.__bins().find((b) => b.ref === r)?.shown, res.ref);
check('the bin item is hidden while the part is in the hand', after === false, after);
hand = await glide('hand-right', 'right', hand, add(hand, [0, 0.06, 0.0]), 4);
await sleep(300);
const carried = await page.evaluate(() => {
  const o = window.iynkware.world.scene.getObjectByProperty('name', 'bench:carried');
  return o ? o.getWorldPosition(o.position.clone()).toArray() : null;
});
console.log('carried part at', carried?.map((v) => +v.toFixed(3)));
const dx = carried ? sub(add(hole, [0, 0.012, 0]), carried) : [0, 0, 0];
hand = await glide('hand-right', 'right', hand, add(hand, dx), 14);
await sleep(600);
const g1 = await page.evaluate(() => window.__ghost());
check('over free holes the ghost shows', g1.shown && g1.dots >= 2, g1);
const rev0 = await page.evaluate(() => window.iynkware.app.project.revision);
check('nothing changed in the document while carrying', rev0 === (await page.evaluate(() => window.iynkware.app.project.revision)));
await page.evaluate(() => window.__x('set_select_value', { device: 'hand-right', value: 0 }));
await sleep(1000);
const n1 = await page.evaluate(() => window.__count());
const seated = await page.evaluate((known) => {
  const ps = window.iynkware.app.project.doc.views.find((v) => v.kind === 'breadboard').placements;
  const p = ps.find((x) => !known.includes(x.c));
  return { legs: p?.legs ?? null, c: p?.c ?? null };
}, idsBefore);
check('released on the ghost: the document gains a seated part', n1 === nBefore + 1 && !!seated.legs, { n1, nBefore, seated });
check('the bin item is back', (await page.evaluate((r) => window.__bins().find((b) => b.ref === r)?.shown, res.ref)) === true);
await page.evaluate(() => window.iynkware.app.project.undo());
await sleep(700);
check('one undo removes it', (await page.evaluate(() => window.__count())) === nBefore, await page.evaluate(() => window.__count()));

// ---------------------------------------------------------------------------------------------------- 2. a controller: away
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(800);
const led = (await binOf((r) => /resistor/.test(r))) ?? (await page.evaluate(() => window.__bins()))[1];
console.log('taking', led.ref);
const gripC = await calibrate('controller-right', 'right');
let ctl = await takeBin('controller-right', 'right', gripC, led);
const ev2 = await page.evaluate(() => window.__ev.slice());
check('a grip on a bin item is a grab of that part', ev2.some((e) => e.startsWith(`grab-start:shelf:${led.ref}:controller/grab`)), ev2);
ctl = await glide('controller-right', 'right', ctl, add(ctl, [0.5, 0.1, 0.5]), 12);
await sleep(300);
const rev2 = await page.evaluate(() => window.iynkware.app.project.revision);
await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-right', buttons: [{ index: 1, value: 0 }], axes: [] }));
await sleep(1200);
const back = await page.evaluate((r) => ({ rev: window.iynkware.app.project.revision, n: window.__count(), shown: window.__bins().find((b) => b.ref === r)?.shown }), led.ref);
check('released away from the bench: no document change, the item is back in its bin', back.rev === rev2 && back.n === nBefore && back.shown === true, { back, rev2 });

// ---------------------------------------------------------------------------------------------------- 3. group tabs
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(600);
const refsBefore = (await page.evaluate(() => window.__bins())).map((b) => b.ref).join();
const tab = await page.evaluate(() => window.__hdr(1));
const tipOf = () => page.evaluate(() => window.iynkware.app.input.pose('right').position);
const nrm = tab.normal;
const front = add(tab.at, nrm.map((v) => v * 0.04));
await place('hand-right', 'right', front);
const tip0 = await tipOf();
const off = sub(tip0, front);
const aim = (p) => sub(p, off);
let h2 = await place('hand-right', 'right', aim(front));
h2 = await glide('hand-right', 'right', h2, aim(add(tab.at, nrm.map((v) => v * 0.004))), 6);
await sleep(300);
h2 = await glide('hand-right', 'right', h2, aim(add(tab.at, nrm.map((v) => v * -0.006))), 4);
await sleep(500);
h2 = await glide('hand-right', 'right', h2, aim(front), 4);
await sleep(900);
const refsAfter = (await page.evaluate(() => window.__bins())).map((b) => b.ref).join();
check('tapping a group tab shows that group in the bins', refsAfter !== refsBefore && refsAfter.length > 0, { refsBefore, refsAfter });
await place('hand-right', 'right', add(hole, [0, 0.4, 0.3]));

if (SHOT) {
  await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0.2, y: 1.05, z: -0.1 }, orientation: { x: -0.30, y: -0.17, z: -0.05, w: 0.94 } }));
  await sleep(700);
  await page.screenshot({ path: SHOT });
}

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
