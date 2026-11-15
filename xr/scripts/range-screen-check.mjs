// The FPV and chase screen in the IWER emulator, headless (issue #125): Y and the View plate (ray, then hand pinch)
// cycle los -> chase -> fpv -> los; the screen shows and hides; the picture changes while the craft flies; the person's
// own camera never moves.
//
//   npx vite --mode http --port 23125 --strictPort           # in another terminal
//   node scripts/range-screen-check.mjs [url] [shot-prefix]  # url defaults to http://localhost:23125/
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23125/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_drone-quad5');
const SHOT = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[vite]')) return;
  if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), t.slice(0, 300));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};
const shot = async (name) => {
  if (SHOT) await page.screenshot({ path: `${SHOT}-${name}.png` });
};

await page.goto(target.href, { waitUntil: 'load' });
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 60000 });
await page.evaluate(async () => {
  await window.iynkware.ready;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  window.__room = () => window.iynkware.world.scene.getObjectByName('range-room');
  window.__flight = () => window.__room()?.userData.flight;
  window.__obj = (name) => window.iynkware.world.scene.getObjectByName(name);
});
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await sleep(800);
await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.5, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }));
await sleep(300);
await page.evaluate(() => window.iynkware.app.shell.go('range'));
await page.waitForFunction(() => window.__flight(), null, { timeout: 60000 });
await sleep(1500);

const pad = (device, buttons, axes) => page.evaluate(([d, b, a]) => window.__x('set_gamepad_state', { device: d, buttons: b, axes: a }), [device, buttons, axes]);
const tap = async (device, index) => {
  await pad(device, [{ index, value: 1 }], []);
  await sleep(180);
  await pad(device, [{ index, value: 0 }], []);
  await sleep(300);
};
const view = () => page.evaluate(() => window.__room().userData.view);
const panelState = () =>
  page.evaluate(() => {
    const s = window.__room().userData.screen;
    const g = s.panel.group;
    let vis = true;
    for (let p = g; p; p = p.parent) if (!p.visible) vis = false;
    return { visible: vis, open: s.panel.isOpen, pos: g.getWorldPosition(g.position.clone()).toArray().map((v) => +v.toFixed(2)) };
  });
const camPos = () => page.evaluate(() => window.iynkware.world.camera.getWorldPosition(window.iynkware.world.camera.position.clone()).toArray().map((v) => +v.toFixed(4)));
// a cheap hash of a stride of the render target's pixels
const pixels = () =>
  page.evaluate(() => {
    const s = window.__room().userData.screen;
    const r = window.iynkware.world.renderer;
    const buf = new Uint8Array(512 * 288 * 4);
    r.readRenderTargetPixels(s.target, 0, 0, 512, 288, buf);
    let h = 0, lit = 0;
    for (let i = 0; i < buf.length; i += 4 * 7) {
      h = (h * 31 + buf[i] + buf[i + 1] * 3 + buf[i + 2] * 5) >>> 0;
      if (buf[i] + buf[i + 1] + buf[i + 2] > 30) lit++;
    }
    return { h, lit };
  });

const cam0 = await camPos();
check('the screen starts away in line of sight', (await view()) === 'los' && !(await panelState()).visible);
await shot('1-los');

// Y on the left controller: chase
await tap('controller-left', 4);
await sleep(900);
check('Y shows the chase view on the screen', (await view()) === 'chase' && (await panelState()).visible, await panelState());
const ps = await panelState();
const head = await page.evaluate(() => window.__flight().head);
const dist = Math.hypot(ps.pos[0] - head.x, ps.pos[2] - head.z);
check('the screen stands about 1.2 m away, world-locked', dist > 1 && dist < 1.3, { dist: +dist.toFixed(2), pos: ps.pos });
await sleep(400);
const c1 = await pixels();
check('the chase picture has content', c1.lit > 200, c1);
await shot('2-chase');

// Y again: fpv
await tap('controller-left', 4);
await sleep(700);
check('Y again shows FPV', (await view()) === 'fpv' && (await panelState()).visible);
await shot('3-fpv');

// arm with A and fly: the FPV picture moves
await tap('controller-right', 3);
await sleep(300);
const armed = await page.evaluate(() => window.__flight().runner.frame.armed);
check('armed with A', armed, await page.evaluate(() => window.__room().userData.readout()));
const pA = await pixels();
const craftBefore = await page.evaluate(() => window.__flight().craft.object.position.toArray());
await pad('controller-left', [], [{ index: 0, value: 0 }, { index: 1, value: -1 }]);
await pad('controller-right', [], [{ index: 0, value: 0.4 }, { index: 1, value: -0.3 }]);
const hashes = new Set();
for (let i = 0; i < 6; i++) {
  await sleep(350);
  hashes.add((await pixels()).h);
}
await shot('4-fpv-flying');
const craftAfter = await page.evaluate(() => window.__flight().craft.object.position.toArray());
const moved = Math.hypot(...craftAfter.map((v, i) => v - craftBefore[i]));
check('the craft flew', moved > 0.05, { moved: +moved.toFixed(2) });
check('the FPV picture changes while flying', hashes.size >= 3 && !hashes.has(pA.h) === true || hashes.size >= 3, { distinct: hashes.size });
check('the person\'s camera did not move with the craft', JSON.stringify(await camPos()) === JSON.stringify(cam0), { cam0, now: await camPos() });
await pad('controller-left', [], [{ index: 0, value: 0 }, { index: 1, value: 0 }]);
await pad('controller-right', [], [{ index: 0, value: 0 }, { index: 1, value: 0 }]);

// the chase picture moves too
await tap('controller-left', 4);
await sleep(300);
check('Y after FPV returns to line of sight and the screen goes', (await view()) === 'los');
await sleep(800);
check('the screen is hidden in los', !(await panelState()).visible, await panelState());

// the View plate by controller ray
const aimAt = async (device, p, yaw, dist = 0.5) => {
  const n = [Math.sin(yaw), 0, Math.cos(yaw)];
  await page.evaluate(([d, ps, y]) => window.__x('set_transform', { device: d, position: ps, orientation: { x: 0, y: Math.sin(y / 2), z: 0, w: Math.cos(y / 2) } }), [device, { x: p[0] + n[0] * dist, y: p[1], z: p[2] + n[2] * dist }, yaw]);
};
const platePose = () =>
  page.evaluate(() => {
    const o = window.__obj('screen:view');
    return { p: o.getWorldPosition(o.position.clone()).toArray(), yaw: o.parent.rotation.y };
  });
const pressPlate = async (device) => {
  const pp = await platePose();
  await aimAt(device, pp.p, pp.yaw);
  await sleep(400);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 1 }), device);
  await sleep(200);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 0 }), device);
  await sleep(500);
};
await pressPlate('controller-right');
check('the View plate (ray and trigger) shows the chase view', (await view()) === 'chase', await view());
await shot('5-plate-chase');
await pressPlate('controller-right');
check('the View plate again shows FPV', (await view()) === 'fpv');

// hand pinch
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(700);
await pressPlate('hand-right');
check('the View plate by hand pinch returns to line of sight', (await view()) === 'los', await view());
await pressPlate('hand-right');
check('and a second pinch shows chase again', (await view()) === 'chase', await view());
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(500);
check('the person\'s camera never moved', JSON.stringify(await camPos()) === JSON.stringify(cam0));
const perf = await page.evaluate(() => ({ calls: window.iynkware.world.renderer.info.render.calls }));
console.log('render', perf);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
