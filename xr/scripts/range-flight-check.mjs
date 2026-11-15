// Controller flight in the IWER emulator, headless (issue #314), the way a person gets there: Home, the Drones tile with
// the controller ray and trigger, then the Range. The first-flight hint says how to arm; A arms; the left stick up takes
// off (the craft climbs in the room) and the hint goes; a centred stick holds; the right stick flies forward; the left
// stick turns; A disarms; B puts the craft back on the pad.
//
// The page never calls `app.input.stick()` here: the room has to read the sticks itself every frame (an older walk read
// them from the page each round, which hid a room that never did).
//
//   npx vite --mode http --port 23314 --strictPort            # in another terminal
//   node scripts/range-flight-check.mjs [url]                 # url defaults to http://localhost:23314/
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23314/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[vite]') || t.includes('GL Driver')) return;
  if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), t.slice(0, 300));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};

await page.goto(target.href, { waitUntil: 'load' });
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 120000 });
await page.evaluate(async () => {
  await window.iynkware.ready;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  window.__room = () => window.iynkware.world.scene.getObjectByName('range-room');
  window.__flight = () => window.__room()?.userData.flight;
});
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await sleep(800);
await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.5, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }));
check('controllers in the session', await page.evaluate(() => window.iynkware.app.input.sources.value.right === 'controller'));

// Home, then the Drones tile with the right controller's ray and trigger
await page.evaluate(() => window.iynkware.app.shell.openHome());
await sleep(900);
const tile = await page.evaluate(() => window.iynkware.world.scene.getObjectByName('button:home/drone')?.getWorldPosition(window.iynkware.world.camera.position.clone()).toArray());
check('Home shows the Drones tile', !!tile, tile);
await page.evaluate(([q]) => window.__x('set_transform', { device: 'controller-right', position: { x: q[0], y: q[1], z: q[2] + 0.12 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [tile]);
await sleep(400);
await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 1 }));
await sleep(200);
await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 0 }));
const inRange = await page.waitForFunction(() => window.iynkware.app.shell.place.value === 'range' && window.__flight(), null, { timeout: 60000 }).then(() => true, () => false);
check('the Drones tile opens the Range with a craft to fly', inRange);
if (!inRange) {
  await browser.close();
  process.exit(1);
}
// the ray off the plates, out of the way
await page.evaluate(() => window.__x('set_transform', { device: 'controller-right', position: { x: 0.25, y: 1.0, z: -0.2 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }));
await sleep(1500);

const pad = (device, buttons, axes) => page.evaluate(([d, b, a]) => window.__x('set_gamepad_state', { device: d, buttons: b, axes: a }), [device, buttons, axes]);
const tap = async (device, index) => {
  await pad(device, [{ index, value: 1 }], []);
  await sleep(180);
  await pad(device, [{ index, value: 0 }], []);
  await sleep(300);
};
const A = 3, B = 4; // IWER's remote button order: trigger, squeeze, thumbstick, A/X, B/Y, thumbrest
const sticks = (lx, ly, rx, ry) =>
  Promise.all([
    pad('controller-left', [], [{ index: 0, value: lx }, { index: 1, value: ly }]),
    pad('controller-right', [], [{ index: 0, value: rx }, { index: 1, value: ry }]),
  ]);
const state = () =>
  page.evaluate(() => {
    const f = window.__flight();
    const r = f.runner.frame;
    const o = f.craft.object.position;
    const hint = window.__room().userData.hint;
    const card = window.iynkware.world.scene.getObjectByName('range-hint');
    return {
      phase: f.runner.phase,
      armed: r.armed,
      airborne: r.airborne,
      course: [r.x, r.y, r.z].map((v) => +v.toFixed(2)),
      yaw: +r.yaw.toFixed(1),
      world: [o.x, o.y, o.z].map((v) => +v.toFixed(3)),
      hint: hint ? hint() : null,
      card: !!card && card.visible,
      say: window.__room().userData.readout(),
    };
  });

await sticks(0, 0, 0, 0);
await sleep(300);
let s = await state();
check('the first-flight hint is up on the pad and says how to arm', s.card && /A/.test(s.hint ?? '') && /arm/i.test(s.hint ?? ''), s);
check('on the pad, disarmed', s.phase === 'disarmed' && !s.airborne, s);
const start = s;

await tap('controller-right', A);
s = await state();
check('A arms', s.armed && s.phase === 'armed', s);
const hum = () => page.evaluate(() => window.__room().userData.motor?.());
const h1 = await hum();
check('the motor sound is running after arm', !!h1?.running && h1.state === 'running', h1);
check('the hint now says how to take off', /take off/i.test(s.hint ?? ''), s.hint);

// throttle: the left stick up for two seconds
await sticks(0, -1, 0, 0);
await sleep(2000);
s = await state();
const h2 = await hum();
check('the motor sound rises with throttle', !!h2?.running && h2.hz > h1.hz, { idle: h1, climb: h2 });
check('left stick up: the craft takes off and climbs in the room', s.airborne && s.course[2] > 1 && s.world[1] > start.world[1] + 0.05, { start: start.world, now: s.world, course: s.course });
await sleep(400);
s = await state();
check('the hint goes at the first take-off', s.hint === null && !s.card, { hint: s.hint, card: s.card });

// a centred stick holds the height
await sticks(0, 0, 0, 0);
await sleep(600);
const held = await state();
await sleep(1000);
s = await state();
check('centred sticks hold the height', Math.abs(s.course[2] - held.course[2]) < 0.6, { before: held.course, after: s.course });

// right stick forward: the craft flies away from the person
const before = s;
await sticks(0, 0, 0, -0.6);
await sleep(1200);
await sticks(0, 0, 0, 0);
await sleep(300);
s = await state();
check('right stick forward flies the craft away (course +y, room -z)', s.course[1] > before.course[1] + 1 && s.world[2] < before.world[2], { before: before.world, after: s.world });

// left stick right: the craft turns right (course yaw falls: it is counted counter-clockwise)
const yaw0 = s.yaw;
await sticks(0.8, 0, 0, 0);
await sleep(700);
await sticks(0, 0, 0, 0);
await sleep(200);
s = await state();
check('left stick right turns the craft right', s.yaw < yaw0 - 10, { yaw0, yaw: s.yaw });

// A again disarms, B puts it back on the pad
await tap('controller-right', A);
s = await state();
check('A again disarms', !s.armed, s);
const h3 = await hum();
check('the motor sound is stopped after disarm', !!h3 && !h3.running, h3);
await sleep(1500);
await tap('controller-right', B);
s = await state();
check('B puts the craft back on the pad', s.phase === 'disarmed' && Math.abs(s.course[0] - start.course[0]) < 0.05 && Math.abs(s.course[1] - start.course[1]) < 0.05 && s.course[2] < 0.05, { start: start.course, now: s.course });
check('the hint stays gone after the first take-off', s.hint === null, s.hint);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
await browser.close();
process.exit(fails ? 1 : 0);
