// Home, Recentre and Exit in the IWER emulator, headless: enter a session, turn the head away, press Recentre with a
// controller ray (the bench eases to in front of the head), press Home (Home opens in front of the turned head), turn
// back and pinch Home by hand (Home comes round to the new view), a quick tap on Exit does nothing, a held trigger on Exit
// ends the session.
//   npx vite --mode http --port 23237 ; node scripts/session-controls-check.mjs http://localhost:23237/ [shot.png]
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:8081/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
const SHOT = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};

await page.goto(target.href, { waitUntil: 'load' });
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 60000 });
await page.evaluate(async () => {
  await window.iynkware.ready;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  window.__spot = (name) => window.iynkware.world.scene.getObjectByName(name).getWorldPosition(window.iynkware.world.camera.position.clone()).toArray();
  window.__head = () => window.iynkware.world.camera.getWorldPosition(window.iynkware.world.camera.position.clone()).toArray();
});
await sleep(500);
check('no controls on the flat page', await page.evaluate(() => window.iynkware.world.scene.getObjectByName('session-controls')?.visible === false));
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await sleep(3000);
check('controls shown in the session', await page.evaluate(() => window.iynkware.world.scene.getObjectByName('session-controls')?.visible === true));
const rel = await page.evaluate(() => {
  const p = window.__spot('session-controls');
  const e = window.__head();
  return [p[0] - e[0], p[1] - e[1], p[2] - e[2]].map((v) => +v.toFixed(2));
});
check('centred below the view, within reach', Math.abs(rel[0]) < 0.1 && rel[1] < -0.25 && Math.hypot(...rel) < 0.6, rel);

// Turn the head about the y axis and aim a controller ray at a button.
const turn = async (deg) => {
  const h = (deg * Math.PI) / 360;
  await page.evaluate(([y, w]) => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { x: 0, y: y, z: 0, w } }), [Math.sin(h), Math.cos(h)]);
};
const aimAt = async (name, back, device = 'controller-right') => {
  const p = await page.evaluate((n) => window.__spot(n), name);
  const c = await page.evaluate(() => window.__head());
  const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const len = Math.hypot(...d);
  const f = d.map((v) => v / len);
  const o = p.map((v, i) => v - f[i] * back);
  const yaw = Math.atan2(-f[0], -f[2]);
  const pitch = Math.asin(f[1]);
  const q = { x: Math.sin(pitch / 2) * Math.cos(yaw / 2), y: Math.cos(pitch / 2) * Math.sin(yaw / 2), z: -Math.sin(pitch / 2) * Math.sin(yaw / 2), w: Math.cos(pitch / 2) * Math.cos(yaw / 2) };
  await page.evaluate(([dev, pos, ori]) => window.__x('set_transform', { device: dev, position: { x: pos[0], y: pos[1], z: pos[2] }, orientation: ori }), [device, o, q]);
  await sleep(450);
};
const trigger = async (v, device = 'controller-right') => page.evaluate(([x, dev]) => window.__x('set_select_value', { device: dev, value: x }), [v, device]);
/** Where Home's panel is from the head, along and across a head yaw of `deg` (left positive); null while it is closed. */
const homeFrom = (deg) =>
  page.evaluate((a0) => {
    const w = window.iynkware.world;
    const g = w.scene.getObjectByName('shell-panel:home');
    if (!g?.visible || !window.iynkware.app.shell.homeOpen.value) return null;
    const p = g.getWorldPosition(w.camera.position.clone()).toArray();
    const e = window.__head();
    const a = (a0 * Math.PI) / 180;
    const dx = p[0] - e[0];
    const dz = p[2] - e[2];
    return { along: +(dx * -Math.sin(a) + dz * -Math.cos(a)).toFixed(2), across: +(dx * Math.cos(a) - dz * Math.sin(a)).toFixed(2) };
  }, deg);

await turn(90);
await sleep(2500);
const before = await page.evaluate(() => window.iynkware.app.bench.benchTop.value);
await aimAt('button:session/recentre', 0.25);
await trigger(1);
await sleep(150);
await trigger(0);
await sleep(1200);
const after = await page.evaluate(() => window.iynkware.app.bench.benchTop.value);
// Head at (0, 1.2, 0) turned 90 degrees to the left looks along -x: the bench should now be at negative x, near z = 0.
check('Recentre moved the bench in front of the turned head', after.position[0] < -0.3 && Math.abs(after.position[2]) < 0.1 && Math.abs(after.yawRad - Math.PI / 2) < 0.05, { before, after });
if (SHOT) await page.screenshot({ path: SHOT });

// Home from anywhere: the Home button opens Home in front of the turned head.
await page.evaluate(() => window.iynkware.app.shell.closeHome());
await sleep(600);
await aimAt('button:session/home', 0.25);
await trigger(1);
await sleep(150);
await trigger(0);
await sleep(1000);
const turned = await homeFrom(90);
check('Home button opens Home in front of the turned head', !!turned && turned.along > 0.6 && Math.abs(turned.across) < 0.25, turned);

// Turn back and pinch Home by hand while Home is still open: it comes round to the new view.
await turn(0);
await sleep(2500);
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(800);
await aimAt('button:session/home', 0.25, 'hand-right');
await trigger(1, 'hand-right');
await sleep(220);
await trigger(0, 'hand-right');
await sleep(1000);
const back = await homeFrom(0);
check('a hand pinch on Home brings Home round to the new view', !!back && back.along > 0.6 && Math.abs(back.across) < 0.25, back);
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await page.evaluate(() => window.iynkware.app.shell.closeHome());
await sleep(800);

// Exit: a tap does nothing.
await turn(0);
await sleep(2500);
await aimAt('button:session/exit', 0.25);
await trigger(1);
await sleep(200);
await trigger(0);
await sleep(600);
check('a tap on Exit keeps the session', await page.evaluate(() => window.iynkware.world.session != null && window.iynkware.world.visibilityState.value === 'visible'));
// Exit: a held trigger ends it.
await trigger(1);
await sleep(300);
const mid = await page.evaluate(() => window.iynkware.world.scene.getObjectByName('session-controls').userData.sessionControls.exit.holdProgress);
await sleep(900);
await trigger(0).catch(() => undefined); // the session may already be over
await page.waitForFunction(() => window.iynkware.world.session == null, null, { timeout: 5000 }).catch(() => undefined);
check('hold ring filled part way, then Exit ended the session', mid > 0.1 && mid < 1 && (await page.evaluate(() => window.iynkware.world.session == null)), { mid });
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
