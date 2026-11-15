// Run here in the IWER emulator, headless: the Drones tile opens the drone workbench, where the run cluster shows Run on
// range and Run here. Run here builds the drone first (as Run does), then flies it on the workbench: the table stays, no
// course, plates, readout or screen, the other windows hide, the craft takes off from its bench spot at real size. The
// same button (Stop) ends it and the windows come back; Run on range flies the course in the Range.
//
//   npx vite --mode http --port 23314 --strictPort            # in another terminal
//   node scripts/range-here-check.mjs [url]                   # url defaults to http://localhost:23314/
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
const onBench = await page.waitForFunction(() => window.iynkware.app.shell.place.value === 'bench' && window.iynkware.world.scene.getObjectByName('range-bench') && window.iynkware.world.scene.getObjectByName('run:here')?.parent?.visible, null, { timeout: 60000 }).then(() => true, () => false);
check('the Drones tile opens the drone workbench, with Run here beside Run on range', onBench, await page.evaluate(() => window.iynkware.world.scene.getObjectByName('run-cluster')?.userData.state));
if (!onBench) {
  await browser.close();
  process.exit(1);
}
await sleep(1500);
const A = 3; // IWER's remote button order: trigger, squeeze, thumbstick, A/X, B/Y, thumbrest
const pad = (device, buttons, axes) => page.evaluate(([d, b, a]) => window.__x('set_gamepad_state', { device: d, buttons: b, axes: a }), [device, buttons, axes]);
const tap = async (device, index) => {
  await pad(device, [{ index, value: 1 }], []);
  await sleep(180);
  await pad(device, [{ index, value: 0 }], []);
  await sleep(300);
};
const sticks = (lx, ly, rx, ry) =>
  Promise.all([
    pad('controller-left', [], [{ index: 0, value: lx }, { index: 1, value: ly }]),
    pad('controller-right', [], [{ index: 0, value: rx }, { index: 1, value: ry }]),
  ]);
// a plate on the bench rail: a ray coming down at 45 degrees from above
const press = async (name) => {
  const q = await page.evaluate((n) => window.iynkware.world.scene.getObjectByName(n).getWorldPosition(window.iynkware.world.camera.position.clone()).toArray(), name);
  await page.evaluate(([q]) => window.__x('set_transform', { device: 'controller-right', position: { x: q[0], y: q[1] + 0.25, z: q[2] + 0.25 }, orientation: { x: -0.3827, y: 0, z: 0, w: 0.9239 } }), [q]);
  await sleep(400);
  await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 1 }));
  await sleep(200);
  await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 0 }));
  await sleep(500);
  await page.evaluate(() => window.__x('set_transform', { device: 'controller-right', position: { x: 0.25, y: 1.0, z: -0.2 }, orientation: { x: 0, y: 0, z: 0, w: 0.7071 } }));
};
const windows = () => page.evaluate(() => window.iynkware.world.scene.children.filter((o) => /^(shell-panel:|shell-button:|session-controls|agent:)/.test(o.name) && o.visible).map((o) => o.name));
const shown = await windows();
const spot = await page.evaluate(() => window.iynkware.world.scene.getObjectByName('range-bench-drone').getWorldPosition(window.iynkware.world.camera.position.clone()).toArray());
// the first press builds the drone (as Run does), the second flies it from the bench
await press('run:here');
await sleep(1500);
check('Run here on an unbuilt drone builds it, nothing flies yet', await page.evaluate(() => !window.__flight()));
await press('run:here');
const went = await page.waitForFunction(() => window.__flight(), null, { timeout: 30000 }).then(() => true, () => false);
await sleep(1500);
const here = await page.evaluate(() => ({
  place: window.iynkware.app.shell.place.value,
  here: window.__room().userData.here,
  table: window.iynkware.app.bench.table.visible,
  course: !!window.__room().getObjectByName('range-course'),
  plates: window.__room().getObjectByName('range-plates').visible,
  readout: window.__room().getObjectByName('range-readout').visible,
  screen: !!window.iynkware.world.scene.getObjectByName('range-screen'),
  benchDrone: window.iynkware.world.scene.getObjectByName('range-bench-drone').visible,
  craft: window.__flight().craft.object.position.toArray(),
  k: window.__flight().map.k,
  label: window.iynkware.world.scene.getObjectByName('run-cluster').userData,
}));
check('Run here flies on the workbench (no Range, no course)', went && here.place === 'bench' && here.here === true && !here.course && here.table, here);
check('nothing floats: no plates, readout or screen', !here.plates && !here.readout && !here.screen, here);
check('the craft sits where the bench drone sat, at real size; the bench drone steps aside', Math.hypot(here.craft[0] - spot[0], here.craft[2] - spot[2]) < 0.05 && Math.abs(here.craft[1] - spot[1]) < 0.05 && here.k === 1 && !here.benchDrone, { spot, craft: here.craft });
await sleep(300);
check('the other windows hide', (await windows()).length === 0, { before: shown, now: await windows() });
await tap('controller-right', A);
await sticks(0, -1, 0, 0);
await sleep(1500);
await sticks(0, 0, 0, 0);
const up = await page.evaluate(() => window.__flight().craft.object.position.toArray());
check('it climbs off the bench', up[1] > spot[1] + 0.3, { spot, up });
check('A arms the drone, it does not undo the bench build', await page.evaluate(() => window.iynkware.app.project.canUndo()) );
// Stop (the same button)
await press('run:here');
await sleep(800);
const after = await page.evaluate(() => ({ flight: !!window.__flight?.(), place: window.iynkware.app.shell.place.value, benchDrone: window.iynkware.world.scene.getObjectByName('range-bench-drone')?.visible }));
check('Stop ends it on the bench, the bench drone back', !after.flight && after.place === 'bench' && after.benchDrone, after);
check('the windows come back', JSON.stringify((await windows()).sort()) === JSON.stringify([...shown].sort()), { before: shown, now: await windows() });
// Run on range: the course in the Range
await press('run:run');
const ranged = await page.waitForFunction(() => window.iynkware.app.shell.place.value === 'range' && window.__flight(), null, { timeout: 30000 }).then(() => true, () => false);
await sleep(800);
check('Run on range flies the course in the Range, the table hidden', ranged && (await page.evaluate(() => window.__room().userData.here === false && !window.iynkware.app.bench.table.visible)));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
