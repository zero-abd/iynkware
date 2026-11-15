// Carrying, seating and pulling parts in the IWER emulator, headless, the way a person does it: a hand pinches the LED,
// lifts it past one pitch, carries it over free holes (a ghost shows), releases (the document's placement has new legs),
// then a controller grips the resistor and carries it past the end of the breadboard (no fit: it lies loose beside the
// board and says why), the LED is dropped off the bench (it falls to the floor and stays there, out of the circuit), and
// undo puts everything back.
//
//   npx vite --mode http --port 23150          # in another terminal
//   node scripts/bench-edit-check.mjs [url] [ghost.png]
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23150/');
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
    // calibrate() reads only the grab-start origin: a ray hover on a panel is the last event otherwise.
    if (e.type === 'grab-start') window.__grab[e.pointer.hand] = [...e.pointer.origin];
  });
  window.__last = {};
  window.__grab = {};
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
  await page.evaluate(() => ((window.__last = {}), (window.__grab = {})));
  const setAt = add(over, [0, 0.01, 0]);
  await place(device, side, setAt);
  await sleep(300);
  await press(device, true);
  await sleep(350);
  const got = await page.evaluate(([s]) => ({ origin: window.__grab[s] }), [side]);
  await press(device, false);
  await sleep(300);
  if (!got.origin) return [0, 0, 0];
  return sub(got.origin, setAt);
};
const legsOf = (id) => page.evaluate((c) => window.__placement(c)?.legs ?? null, id);


// ---------------------------------------------------------------------------------------------------- 0. hover before commit
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(600);
{
  const hole = await page.evaluate(() => window.__hole('e25'));
  // the hand's pose is its index tip: aim the device so the tip is 2 mm above hole e25
  await place('hand-right', 'right', add(hole, [0, 0.06, 0]));
  const tip = await page.evaluate(() => window.iynkware.app.input.pose('right').position);
  const dev = add(hole, [0, 0.06, 0]);
  const fixed = add(dev, sub(add(hole, [0, 0.002, 0]), tip));
  await place('hand-right', 'right', fixed);
  await sleep(400);
  const ring = await page.evaluate(() => {
    const { world, app } = window.iynkware;
    const r = world.scene.getObjectByName('bench:hover-cell:right');
    const l = world.scene.getObjectByName('bench:hover-name:right');
    if (!r?.visible) return null;
    const p = r.getWorldPosition(r.position.clone()).toArray();
    const h = window.__hole('e25');
    return { dist_mm: Math.round(Math.hypot(...p.map((v, i) => v - h[i])) * 1e4) / 10, label: !!l?.visible };
  });
  check('a pinch point over a hole shows the hover ring and its name on that hole', !!ring && ring.dist_mm < 2 && ring.label, ring);
  await place('hand-right', 'right', add(hole, [0, 0.3, 0.3]));
}

// ---------------------------------------------------------------------------------------------------- 1. a hand
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(600);
const led0 = await legsOf('cmp_led1');
const doc0 = await page.evaluate(() => window.iynkware.app.project.revision);
const ledAt = await page.evaluate(() => window.__centre('cmp_led1'));
const gripH = await calibrate('hand-right', 'right');
console.log('hand grab sphere offset from the device', gripH.map((v) => +v.toFixed(3)));
// With the onboarding card open (low in the ring, behind the board), a ray through the LED towards it must hit the bench.
{
  const open = await page.evaluate(() => !!window.iynkware.world.scene.getObjectByName('shell-panel:onboarding')?.visible);
  if (!open) console.log('SKIP ray through the LED towards the onboarding card: the card is not open');
  else {
    const skipAt = await page.evaluate(() => {
      const o = window.iynkware.world.scene.getObjectByName('button:onboarding/skip');
      return o.getWorldPosition(o.position.clone()).toArray();
    });
    const d = sub(skipAt, ledAt);
    const n = Math.hypot(...d);
    const u = d.map((v) => v / n);
    const q = { x: u[1], y: -u[0], z: 0, w: 1 - u[2] };
    const m = Math.hypot(q.x, q.y, q.w);
    await page.evaluate(([p, o]) => window.__x('set_transform', { device: 'hand-right', position: { x: p[0], y: p[1], z: p[2] }, orientation: { x: o.x, y: o.y, z: 0, w: o.w } }), [sub(ledAt, u.map((v) => v * 0.1)), { x: q.x / m, y: q.y / m, w: q.w / m }]);
    await sleep(400);
    const hit = await page.evaluate(() => window.iynkware.world.input.xr.multiPointers.right.getPointer('ray').getIntersection()?.object?.name ?? null);
    const under = await page.evaluate((nm) => {
      let o = window.iynkware.world.scene.getObjectByName(nm);
      for (; o; o = o.parent) if (o.name === 'cmp_led1') return true;
      return false;
    }, hit ?? '');
    check('a ray through the LED towards the onboarding card hits the LED, not the card', !!hit && !/onboarding/.test(hit) && (hit === 'bench:proxy:cmp_led1' || under), hit);
    await place('hand-right', 'right', add(ledAt, [0, 0.3, 0.3]));
  }
}
const aimH = sub(ledAt, gripH);
let hand = await place('hand-right', 'right', add(aimH, [0, 0.04, 0]));
check('hand tracked', !!hand, hand);
hand = await glide('hand-right', 'right', hand, aimH, 6);
await sleep(300);
await page.evaluate(() => window.__fresh());
await press('hand-right', true);
await sleep(300);
const ev1 = await page.evaluate(() => window.__ev.slice());
check('a pinch on the LED is a grab of the LED', ev1.some((e) => e.startsWith('grab-start:cmp_led1:hand/grab')), ev1);
const hovered = await page.evaluate(() => window.iynkware.app.bench.objectOf('cmp_led1').children.find((c) => c.name.startsWith('bench:outline'))?.visible);
check('hovering the LED lights its outline once pinched', hovered === true, hovered);

// lift past one pitch (7.6 mm of the world at 3x): the legs stay in the document until the release
hand = await glide('hand-right', 'right', hand, add(hand, [0, 0.004, 0]), 3);
await sleep(150);
const shortLift = await page.evaluate(() => {
  const p = window.iynkware.app.bench.objectOf('cmp_led1').position;
  return { y: p.y, tether: !!window.iynkware.world.scene.getObjectByName('bench:tether')?.visible };
});
check('below one pitch the LED stays seated, a tether shows', shortLift.y > 0.0084 && shortLift.y < 0.0086 && shortLift.tether, shortLift);
hand = await glide('hand-right', 'right', hand, add(hand, [0, 0.012, 0]), 4);
await sleep(300);
check('lifted past one pitch the document still has the legs', JSON.stringify(await legsOf('cmp_led1')) === JSON.stringify(led0), await legsOf('cmp_led1'));

// carry six columns to the right over free holes
const d = sub(await page.evaluate(() => window.__hole('c20')), await page.evaluate(() => window.__hole('c14')));
hand = await glide('hand-right', 'right', hand, add(hand, d), 14);
await sleep(500);
const ghost1 = await page.evaluate(() => window.__ghost());
check('the ghost shows over free holes', ghost1.shown && ghost1.dots >= 2 && ghost1.crosses === 0, ghost1);
const calls = await page.evaluate(() => window.iynkware.world.renderer.info.render.calls);
console.log('draw calls (both eyes) with a ghost shown', calls);
if (SHOT) await page.screenshot({ path: SHOT, clip: { x: 560, y: 300, width: 300, height: 190 } });
const rev1 = await page.evaluate(() => window.iynkware.app.project.revision);
check('nothing changed in the document while carrying', rev1 === doc0, { rev1, doc0 });
await page.evaluate(() => window.__x('set_select_value', { device: 'hand-right', value: 0 }));
await sleep(900);
const led1 = await legsOf('cmp_led1');
check('released over the ghost: the LED has new legs', led1?.A === 'c20' && led1?.K === 'c21', led1);
const seatedAt = await page.evaluate(() => {
  const { app } = window.iynkware;
  const o = app.bench.objectOf('cmp_led1');
  const a = app.bench.worldOf({ kind: 'pin', part: 'cmp_led1', pin: 'A' });
  const h = window.__hole('c20');
  return { dist_mm: Math.round(Math.hypot(...a.map((v, i) => v - h[i])) * 1e4) / 10, y: o.position.y };
});
check('and it sits in them', seatedAt.dist_mm < 1.5, seatedAt);
check('one undo restores it', await page.evaluate(async () => {
  const { app } = window.iynkware;
  app.project.undo();
  await new Promise((r) => setTimeout(r, 600));
  const p = window.__placement('cmp_led1');
  return p.legs.A === 'c14' && p.legs.K === 'c15';
}));
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(600);
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(300);

// ---------------------------------------------------------------------------------------------------- 2. a controller
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(800);
const res0 = await legsOf('cmp_res1');
const resAt = await page.evaluate(() => window.__centre('cmp_res1'));
const gripC = await calibrate('controller-left', 'left');
console.log('controller grab sphere offset', gripC.map((v) => +v.toFixed(3)));
const aimC = sub(resAt, gripC);
let ctl = await place('controller-left', 'left', add(aimC, [0, 0.04, 0]));
check('controller tracked', !!ctl, ctl);
ctl = await glide('controller-left', 'left', ctl, aimC, 6);
await sleep(300);
await page.evaluate(() => window.__fresh());
await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-left', buttons: [{ index: 1, value: 1 }], axes: [] }));
await sleep(300);
const ev2 = await page.evaluate(() => window.__ev.slice());
// the grab sphere reports the nearest proxy (the breadboard's plate is as near as the part on it): the bench resolves the part
const held2 = await page.evaluate(() => window.iynkware.app.bench.objectOf('cmp_res1').children.find((c) => c.name.startsWith('bench:outline'))?.visible);
check('a grip on the resistor is a grab of the resistor, not of the board', ev2.some((e) => e.startsWith('grab-start:')) && held2 === true, { ev2, held2 });
ctl = await glide('controller-left', 'left', ctl, add(ctl, [0, 0.02, 0]), 5);
await sleep(300);
// carry it so its first leg is over the last column but one: the second leg has no hole
const dEnd = sub(await page.evaluate(() => window.__hole('c29')), await page.evaluate(() => window.__hole('b10')));
ctl = await glide('controller-left', 'left', ctl, add(ctl, dEnd), 16);
await sleep(600);
const ghost2 = await page.evaluate(() => window.__ghost());
check('over the end of the board the ghost has no fit but marks the holes', !ghost2.shown && ghost2.dots + ghost2.crosses + ghost2.tris >= 1, ghost2);
const revBefore = await page.evaluate(() => window.iynkware.app.project.revision);
await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-left', buttons: [{ index: 1, value: 0 }], axes: [] }));
await sleep(400);
const reason = await page.evaluate(() => {
  const g = window.iynkware.world.scene.getObjectByName('look:callout');
  return !!g?.visible;
});
await sleep(900);
const res1 = await legsOf('cmp_res1');
const revAfter = await page.evaluate(() => window.iynkware.app.project.revision);
const loose = await page.evaluate(() => {
  const p = window.__placement('cmp_res1');
  const o = window.iynkware.app.bench.objectOf('cmp_res1').position;
  // the breadboard fills 0..83 mm by 0..55 mm of the view and the Uno -90..-21 by 0..53: the resistor must clear both
  const clear = p.x_mm > 83 || p.x_mm < -12 || p.y_mm > 55 || p.y_mm < -4;
  return { legs: p.legs ?? null, onMat: Math.abs(o.y) < 0.0005, clear, at_mm: [p.x_mm, p.y_mm] };
});
check('released with no valid fit: not seated, lying loose on the mat beside the board, in one undo', !res1 && revAfter > revBefore && loose.onMat && loose.clear, { res1, loose, revBefore, revAfter });
check('the reason callout showed', reason === true, reason);
await page.evaluate(() => window.iynkware.app.project.undo());
await sleep(700);
check('undo puts the resistor back in its holes', JSON.stringify(await legsOf('cmp_res1')) === JSON.stringify(res0), await legsOf('cmp_res1'));

// ---------------------------------------------------------------------------------------------------- 2b. take apart: pull, lay loose, pick up, reseat, put back on a bin
const wiresOf = (id) => page.evaluate((c) => JSON.stringify(window.iynkware.app.project.doc.views.find((v) => v.kind === 'breadboard').wires ?? []).split(`"${c}"`).length - 1, id);
const worldNow = (id) => page.evaluate((c) => window.__centre(c), id);
const binCentre = () =>
  page.evaluate(() => {
    const o = window.iynkware.world.scene.getObjectByName('bench:shelf-bin:0');
    o.updateWorldMatrix(true, false);
    return o.getWorldPosition(o.position.clone()).toArray();
  });
const frameLit = () =>
  page.evaluate(() => {
    let lit = 0;
    window.iynkware.world.scene.traverse((o) => {
      if (o.name === 'bench:shelf-bin-frame' && o.visible) lit++;
    });
    return lit;
  });
/** Grabs `id` where it is, lifts it, runs `move`, and lets go (hand: pinch; controller: grip). Returns the new device position. */
const takeApart = async (label, device, side, grip, id, partLegs, firstPin, seatHole, moveDelta) => {
  const hands = device.startsWith('hand');
  const down = (on) => (hands ? press(device, on) : page.evaluate(([d, v]) => window.__x('set_gamepad_state', { device: d, buttons: [{ index: 1, value: v }], axes: [] }), [device, on ? 1 : 0]));
  const grab = async (lift) => {
    const at = await worldNow(id);
    let p = await place(device, side, add(sub(at, grip), [0, 0.05, 0]));
    p = await glide(device, side, p, sub(at, grip), 5);
    await sleep(250);
    await down(true);
    await sleep(300);
    return glide(device, side, p, add(p, [0, lift, 0]), 5);
  };
  // 1. pull it out of its holes (past one pitch), carry it off the board, let go: it lies loose on the mat
  const rev0 = await page.evaluate(() => window.iynkware.app.project.revision);
  let p = await grab(0.02);
  p = await glide(device, side, p, add(p, moveDelta), 12);
  await sleep(300);
  await down(false);
  await sleep(1000);
  const loose = await page.evaluate(([c]) => {
    const pl = window.__placement(c);
    return { legs: pl.legs ?? null, y: window.iynkware.app.bench.objectOf(c).position.y, rev: window.iynkware.app.project.revision };
  }, [id]);
  const unseated = !loose.legs || Object.keys(loose.legs).length === 0;
  check(`${label}: pulled out past one pitch and let go on the mat, the part is out of the circuit, lying loose`, unseated && loose.rev > rev0, { loose, rev0 });
  // 2. pick it up again and reseat it elsewhere
  p = await grab(0.01);
  const pinNow = await page.evaluate(([c, pin]) => window.iynkware.app.bench.worldOf({ kind: 'pin', part: c, pin }), [id, firstPin]);
  p = await glide(device, side, p, add(p, sub(await page.evaluate((h) => window.__hole(h), seatHole), pinNow)), 14);
  const against = await page.evaluate((h) => window.__hole(h), seatHole);
  const tip = await page.evaluate(() => window.__ghost());
  await sleep(500);
  await down(false);
  await sleep(1000);
  const reseated = await legsOf(id);
  check(`${label}: picked up again from the mat and reseated in other holes`, reseated?.[firstPin] === seatHole, { reseated, tip, against });
  // 3. pull it again and put it back on a shelf bin
  const rev1 = await page.evaluate(() => window.iynkware.app.project.revision);
  const wires0 = await wiresOf(id);
  await page.evaluate(() => window.__fresh());
  p = await grab(0.02);
  const evs = await page.evaluate(() => window.__ev.filter((e) => e.startsWith('grab-start')));
  const centre = await worldNow(id);
  const bin = await binCentre();
  p = await glide(device, side, p, add(p, add(sub(bin, centre), [0, 0.06, 0])), 22);
  await sleep(500);
  const lit = await frameLit();
  check(`${label}: over a shelf bin that bin shows it will take the part`, lit === 1, lit);
  if (SHOT && label.startsWith('hand')) await page.screenshot({ path: SHOT.replace(/\.png$/, '-bin.png'), clip: { x: 340, y: 120, width: 700, height: 460 } });
  const revHeld = await page.evaluate(() => window.iynkware.app.project.revision);
  await down(false);
  await sleep(1200);
  const gone = await page.evaluate(([c]) => ({ has: !!window.__placement(c), rev: window.iynkware.app.project.revision, ob: window.iynkware.app.bench.objectOf(c) ? 'object' : null }), [id]);
  check(`${label}: released over the bin the part is gone from the document with its wires, in one change`, !gone.has && gone.rev === rev1 + 1 && revHeld === rev1 && (await wiresOf(id)) === 0, { gone, wires0, rev1, evs });
  check(`${label}: the bin's light goes out`, (await frameLit()) === 0);
  await page.evaluate(() => window.iynkware.app.project.undo());
  await sleep(900);
  check(`${label}: one undo brings it back with its legs and wires`, !!(await legsOf(id)) && (await wiresOf(id)) === wires0, { legs: await legsOf(id), wires: await wiresOf(id), wires0 });
};

await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(600);
await takeApart('hand/LED', 'hand-right', 'right', gripH, 'cmp_led1', null, 'A', 'c20', [0.32, 0, 0.02]);
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(800);
await takeApart('controller/LED', 'controller-left', 'left', gripC, 'cmp_led1', null, 'A', 'c26', [0.32, 0, 0.02]);

// the only board stays: carried to a bin, the Uno says so and goes back
{
  const unoAt = await worldNow('brd_main');
  const uno0 = await page.evaluate(() => ({ ...window.__placement('brd_main') }));
  const rev = await page.evaluate(() => window.iynkware.app.project.revision);
  let c = await place('controller-left', 'left', add(sub(unoAt, gripC), [0, 0.04, 0]));
  c = await glide('controller-left', 'left', c, sub(unoAt, gripC), 5);
  await sleep(300);
  await press('controller-left', true);
  await sleep(300);
  const bin = await binCentre();
  c = await glide('controller-left', 'left', c, add(c, add(sub(bin, unoAt), [0, 0.06, 0])), 20);
  await sleep(500);
  check('board: carried over a bin the bin lights', (await frameLit()) === 1);
  await press('controller-left', false);
  await sleep(200);
  const card = await page.evaluate(() => !!window.iynkware.world.scene.getObjectByName('look:callout')?.visible);
  await sleep(1200);
  const uno1 = await page.evaluate(() => ({ ...window.__placement('brd_main') }));
  check('board: the only board is refused, says why and goes back', card && uno1.x_mm === uno0.x_mm && uno1.y_mm === uno0.y_mm && (await page.evaluate(() => window.iynkware.app.project.revision)) === rev, { card, uno0, uno1 });
}

// ---------------------------------------------------------------------------------------------------- 3. off the bench
const ledNow = await page.evaluate(() => window.__centre('cmp_led1'));
const gripR = await calibrate('controller-right', 'right');
const aimR = sub(ledNow, gripR);
let ctl2 = await place('controller-right', 'right', add(aimR, [0, 0.04, 0]));
ctl2 = await glide('controller-right', 'right', ctl2, aimR, 5);
await sleep(300);
await page.evaluate(() => window.__fresh());
await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-right', buttons: [{ index: 1, value: 1 }], axes: [] }));
await sleep(300);
const ev3 = await page.evaluate(() => window.__ev.slice());
check('a grip on the LED is a grab of the LED', ev3.some((e) => e.startsWith('grab-start:cmp_led1:controller/grab')), ev3);
ctl2 = await glide('controller-right', 'right', ctl2, add(ctl2, [0, 0.03, 0]), 4);
ctl2 = await glide('controller-right', 'right', ctl2, add(ctl2, [0.9, 0, 0.4]), 14);
await sleep(300);
const rev3 = await page.evaluate(() => window.iynkware.app.project.revision);
await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-right', buttons: [{ index: 1, value: 0 }], axes: [] }));
await sleep(1200);
const back = await page.evaluate(() => {
  const { app } = window.iynkware;
  const o = app.bench.objectOf('cmp_led1');
  o.updateWorldMatrix(true, false);
  const w = o.getWorldPosition(o.position.clone());
  return { rev: app.project.revision, legs: window.__placement('cmp_led1').legs ?? null, world: [w.x, w.y, w.z] };
});
const unseated = !back.legs || Object.keys(back.legs).length === 0;
check('released off the bench: the LED stays where it was let go, on the floor, out of the circuit', back.rev > rev3 && unseated && Math.abs(back.world[1]) < 0.02, back);

// ---------------------------------------------------------------------------------------------------- 4. a whole board
const unoAt = await page.evaluate(() => window.__centre('brd_main'));
const uno0 = await page.evaluate(() => ({ ...window.__placement('brd_main') }));
const aimU = sub(unoAt, gripC);
let ctl3 = await place('controller-left', 'left', add(aimU, [0, 0.04, 0]));
ctl3 = await glide('controller-left', 'left', ctl3, aimU, 5);
await sleep(300);
await press('controller-left', true);
await sleep(300);
ctl3 = await glide('controller-left', 'left', ctl3, add(ctl3, [0.06, 0, 0.03]), 8);
await sleep(300);
const during = await page.evaluate(() => ({ rev: window.iynkware.app.project.revision, x: window.iynkware.app.bench.objectOf('brd_main').position.x }));
await press('controller-left', false);
await sleep(900);
const uno1 = await page.evaluate(() => ({ ...window.__placement('brd_main') }));
check('a controller grip on the Uno moves the whole board, level, in one change', Math.abs(uno1.x_mm - uno0.x_mm - 20) < 3 && Math.abs(uno1.y_mm - uno0.y_mm - 10) < 3, { uno0, uno1, during });
await page.evaluate(() => window.iynkware.app.project.undo());
await sleep(700);
const uno2 = await page.evaluate(() => ({ ...window.__placement('brd_main') }));
check('and undo puts it back', uno2.x_mm === uno0.x_mm && uno2.y_mm === uno0.y_mm, uno2);

// ---------------------------------------------------------------------------------------------------- 5. the breadboard to the floor
const bbAt = await page.evaluate(() => window.__centre('cmp_bb'));
const bbRev = await page.evaluate(() => window.iynkware.app.project.revision);
const aimB = sub(bbAt, gripC);
let ctl4 = await place('controller-left', 'left', add(aimB, [0, 0.04, 0]));
ctl4 = await glide('controller-left', 'left', ctl4, aimB, 5);
await sleep(300);
await press('controller-left', true);
await sleep(300);
ctl4 = await glide('controller-left', 'left', ctl4, add(ctl4, [0, 0.15, 0]), 6);
ctl4 = await glide('controller-left', 'left', ctl4, add(ctl4, [-0.9, 0, 0.3]), 14);
await sleep(300);
await press('controller-left', false);
await sleep(1500);
const bbDown = await page.evaluate(() => {
  const { app } = window.iynkware;
  const w = (id) => {
    const o = app.bench.objectOf(id);
    o.updateWorldMatrix(true, false);
    const p = o.getWorldPosition(o.position.clone());
    return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)];
  };
  const res = window.__placement('cmp_res1');
  const pin = app.bench.worldOf({ kind: 'pin', part: 'cmp_res1', pin: Object.keys(res.legs ?? {})[0] ?? 'P1' });
  return { rev: app.project.revision, bb: w('cmp_bb'), res: w('cmp_res1'), resLegs: res.legs, pinY: pin && +pin[1].toFixed(3) };
});
check('the breadboard set down on the floor stays there, its parts riding in their holes, document unchanged',
  bbDown.rev === bbRev && Math.abs(bbDown.bb[1]) < 0.02 && bbDown.bb[0] < -0.5 && !!bbDown.resLegs && bbDown.pinY !== null && bbDown.pinY < 0.1, bbDown);

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
