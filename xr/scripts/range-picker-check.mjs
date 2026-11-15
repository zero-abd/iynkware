// The Range picker in the IWER emulator, headless (issue #282): from Home press the Drones tile with the controller ray,
// the picker opens in the Range, pick racer, pick a course, the flight re-enters, arm and fly a little with the
// thumbsticks; then pick another craft with a hand pinch. The Craft plate and the menu row reopen it.
//
//   npx vite --mode http --port 23282 --strictPort            # in another terminal
//   node scripts/range-picker-check.mjs [url] [shot-prefix]  # url defaults to http://localhost:23282/
import { chromium } from 'playwright';

const URL_ = process.argv[2] ?? 'http://localhost:23282/';
const SHOT = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[vite]') || t.includes('GPU stall')) return;
  if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), t.slice(0, 300));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};
const waitFor = (fn, arg, ms = 20000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const shot = async (name) => {
  if (SHOT) await page.screenshot({ path: `${SHOT}-${name}.png` });
};

await page.goto(URL_, { waitUntil: 'load' });
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 60000 });
await page.evaluate(async () => {
  await window.iynkware.ready;
  const { app, world } = window.iynkware;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  window.__room = () => world.scene.getObjectByName('range-room');
  window.__flight = () => window.__room()?.userData.flight;
  window.__pos = (name) => world.scene.getObjectByName(name)?.getWorldPosition(world.camera.position.clone()).toArray() ?? null;
  window.__picker = () => {
    const g = world.scene.getObjectByName('shell-panel:range-picker');
    return { visible: !!g?.visible, open: window.iynkware.app.shell.place.value, place: app.shell.place.value };
  };
  window.__ev = [];
  app.input.onAny((e) => { if (!e.type.endsWith('move')) window.__ev.push(e.type + ':' + e.target); });
  window.__courseIds = () => {
    const ids = [];
    world.scene.traverse((o) => o.name?.startsWith('button:range/picker/course/') && ids.push(o.name.slice('button:range/picker/course/'.length)));
    return ids;
  };
  window.__state = () => {
    const f = window.__flight();
    return f ? { contentId: f.contentId, course: f.course.id, armed: f.runner.frame.armed, pos: [f.runner.frame.x, f.runner.frame.y, f.runner.frame.z].map((v) => +v.toFixed(2)) } : null;
  };
});
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await waitFor(() => window.iynkware.app.shell.homeOpen.value, null, 10000);
await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.5, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }));
await sleep(900);
check('home is open on entering', await page.evaluate(() => window.iynkware.app.shell.homeOpen.value));
await shot('1-home');

/** Ray (or hand pinch) and select on a named object, from `back` metres in front of it. */
const press = async (device, name, back = 0.12) => {
  const p = await page.evaluate((n) => window.__pos(n), name);
  if (!p) return false;
  await page.evaluate(([d, q, b]) => window.__x('set_transform', { device: d, position: { x: q[0], y: q[1], z: q[2] + b }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [device, p, back]);
  await sleep(450);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 1 }), device);
  await sleep(220);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 0 }), device);
  await sleep(300);
  return true;
};
const park = (device) => page.evaluate((d) => window.__x('set_transform', { device: d, position: { x: 0.4, y: 1.0, z: 0.3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), device);
const pickerVisible = () => page.evaluate(() => !!window.iynkware.world.scene.getObjectByName('shell-panel:range-picker')?.visible);

// 1. the Drones tile
check('Drones tile pressed', await press('controller-right', 'button:home/drone'));
check('in the Range, quad5 flies', await waitFor(() => window.__state()?.contentId === 'quad5'), await page.evaluate(() => window.__state()));
await sleep(2000);
check('the picker opened on arriving', await pickerVisible());
await shot('2-picker-open');
await park('controller-right');

// 4. close it with the Craft plate, then arm and fly a little (the thumbsticks are not read while a panel is under the ray)
await waitFor(() => (window.__pos('room:craft')?.[1] ?? 0) > 0.5, null, 30000);
await press('controller-right', 'room:craft', 0.4);
await park('controller-right');
await sleep(1500);
check('the Craft plate closes the picker', !(await pickerVisible()));
await page.evaluate(() => [window.iynkware.app.input.stick('left'), window.iynkware.app.input.stick('right')]); // as the crash check does: the pads are read from here on
const pad = (device, buttons, axes) => page.evaluate(([d, b, a]) => window.__x('set_gamepad_state', { device: d, buttons: b, axes: a }), [device, buttons, axes]);
for (let i = 0; i < 3; i++) {
  await pad('controller-left', [], [{ index: 0, value: 0 }, { index: 1, value: 0 }]);
  await pad('controller-right', [], [{ index: 0, value: 0 }, { index: 1, value: 0 }]);
  await sleep(250);
}
for (let i = 0; i < 6 && !(await page.evaluate(() => window.__state().armed)); i++) {
  await pad('controller-left', [], [{ index: 0, value: 0 }, { index: 1, value: 0 }]);
  await sleep(700);
  await pad('controller-right', [{ index: 3, value: 1 }], []);
  await sleep(180);
  await pad('controller-right', [{ index: 3, value: 0 }], []);
  await sleep(500);
}
check('armed with A', await page.evaluate(() => window.__state().armed), await page.evaluate(() => window.__room().userData.readout()));
const p0 = await page.evaluate(() => window.__state().pos);
await pad('controller-right', [], [{ index: 0, value: 0 }, { index: 1, value: 0 }]);
await pad('controller-left', [], [{ index: 0, value: 0 }, { index: 1, value: -1 }]);
await sleep(2500);
for (let i = 0; i < 30 && (await page.evaluate(() => window.__state().pos[2])) < p0[2] + 0.01; i++) {
  await pad('controller-left', [], [{ index: 0, value: 0 }, { index: 1, value: -1 }]); // held: sent again, a source refresh can drop it
  await sleep(1000);
}
await pad('controller-left', [], [{ index: 0, value: 0 }, { index: 1, value: 0 }]);
const p1 = await page.evaluate(() => window.__state().pos);
check('the thumbstick lifts the craft', p1[2] - p0[2] > 0.01, { p0, p1, dbg: await page.evaluate(() => { const fr0 = window.iynkware.world.renderer.info.render.frame; const r = window.__flight().runner; return { phase: r.phase, f: { thr: r.frame.thr, armed: r.frame.armed, z: r.frame.z, low: r.frame.low }, mode: r.mode, say: window.__room().userData.readout(), fr0, fr: window.iynkware.world.renderer.info.render.frame, t: r.session?.sim?.t }; }) });
await shot('4-flying');

// 3. pick a course (the Craft plate opens the picker again)
await press('controller-right', 'room:craft', 0.4);
await park('controller-right');
await sleep(1500);
check('the Craft plate opens it again', await pickerVisible());
const courses = await page.evaluate(() => window.__courseIds());
const before = await page.evaluate(() => window.__state().course);
const other = courses.find((c) => c !== before) ?? courses[0];
const oldRoom = await page.evaluate(() => window.__room().uuid);
check('course pressed', await press('controller-right', `button:range/picker/course/${other}`), { courses, before, other });
check('the flight re-entered on that course', await waitFor((c) => window.__state()?.course === c, other), await page.evaluate(() => window.__state()));
check('a new room object', (await page.evaluate(() => window.__room().uuid)) !== oldRoom || before === other);
await sleep(800);
await sleep(1500);
check('the picker closed after a course', !(await pickerVisible()));
check('the plates settle in place', await waitFor(() => (window.__pos('room:craft')?.[1] ?? 0) > 0.5, null, 30000), await page.evaluate(() => window.__pos('room:craft')));
const first = await press('controller-right', 'room:craft', 0.4);
await sleep(900);
check('the Craft plate opens the picker (first)', first && (await pickerVisible()), await page.evaluate(() => ({ ev: window.__ev.splice(0).slice(-8), plate: window.__pos('room:craft'), cam: window.iynkware.world.camera.position.toArray() })));
await park('controller-right');

await press('controller-right', 'room:craft', 0.4); // toggles it closed
await park('controller-right');
await sleep(1500);
check('the Craft plate closes it again', !(await pickerVisible()));

// 2. pick racer with the controller
await press('controller-right', 'room:craft', 0.4); // opens again, for the craft pick below
await park('controller-right');
check('racer pressed', await press('controller-right', 'button:range/picker/craft/racer'));
check('the flight re-entered on racer', await waitFor(() => window.__state()?.contentId === 'racer'), await page.evaluate(() => ({ s: window.__state(), doc: window.iynkware.app.project.doc.id, place: window.iynkware.app.shell.place.value })));
await sleep(1200);
check('the picker stays open after a craft', await pickerVisible());
await shot('3-racer');
await park('controller-right');

// 5. the Craft plate reopens it; the menu row exists in the Range
check('the Craft plate exists', !!(await page.evaluate(() => window.__pos('room:craft'))));
const wasOpen = await pickerVisible();
await press('controller-right', 'room:craft', 0.4);
await sleep(900);
check('the Craft plate toggles the picker', (await pickerVisible()) !== wasOpen);
await park('controller-right');
check('menu row present in the Range', await page.evaluate(() => window.iynkware.app.shell.menuItems.value.some((m) => m.id === 'range/picker')));

// 6. recentre must not open it: close, leave and re-enter the place
await page.evaluate(() => window.iynkware.app.shell.go('bench'));
await sleep(600);
check('menu row gone on the bench', await page.evaluate(() => !window.iynkware.app.shell.menuItems.value.some((m) => m.id === 'range/picker')));
await page.evaluate(() => window.iynkware.app.shell.go('range'));
await sleep(1800);
check('re-entering the Range does not pop the picker open', !(await pickerVisible()));

// 7. a hand pinch picks a craft
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(500);
await page.evaluate(() => window.iynkware.app.shell.menuItems.value.find((m) => m.id === 'range/picker').run());
await sleep(2000);
check('the picker is open for the hand', await pickerVisible());
await shot('5-hand');
check('whoop pinched', await press('hand-right', 'button:range/picker/craft/whoop', 0.12));
check('the flight re-entered on whoop', await waitFor(() => window.__state()?.contentId === 'whoop'), await page.evaluate(() => window.__state()));
await sleep(800);
await shot('6-whoop');

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
