// The Code window in the IWER emulator, headless: Blink on the bench, Enter, a controller trigger on Step loads the
// sketch and opens the Code window beside the bench with `digitalWrite(LED_PIN, HIGH)` marked; a hand pinch on Step
// moves the marker to the `delay` under it; Run then carries it between the delay lines; the menu row Code hides it.
//
//   npm run dev:http                                     # in another terminal
//   node scripts/run-code-check.mjs [url] [shot.png]     # url defaults to http://localhost:8081/
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
  window.__at = (name) => window.iynkware.world.scene.getObjectByName(name).getWorldPosition(window.iynkware.world.camera.position.clone()).toArray();
  window.__ev = [];
  window.iynkware.app.input.onAny((e) => { if (!e.type.endsWith('move')) window.__ev.push(`${e.type}:${e.target}:${e.pointer.source}`); });
  window.__code = () => {
    const g = window.iynkware.world.scene.getObjectByName('shell-panel:run/code');
    return g ? { visible: g.visible, ...g.userData.code } : null;
  };
});
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await sleep(800);

const press = async (device, name, back) => {
  const p = await page.evaluate((n) => window.__at(n), name);
  await page.evaluate(([d, q, b]) => window.__x('set_transform', { device: d, position: { x: q[0], y: q[1], z: q[2] + b }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [device, p, back]);
  await sleep(450);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 1 }), device);
  await sleep(220);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 0 }), device);
};

check('menu has a Code row in Tools', await page.evaluate(() => window.iynkware.app.shell.menuItems.value.some((m) => m.id === 'run/code' && m.group === 'tools' && m.label.de === 'Code')));
check('no Code window before Step', (await page.evaluate(() => window.__code()))?.open !== true);

// Controller trigger on Step: compiles, uploads, steps 10 ms; the window opens on that press.
await press('controller-right', 'run:step', 0.3);
await page.waitForFunction(() => window.iynkware.app.sim.state === 'paused' && window.__code()?.line != null, null, { timeout: 10000 }).catch(() => undefined);
await sleep(300);
const first = await page.evaluate(() => window.__code());
const ev = await page.evaluate(() => window.__ev.splice(0));
check('first Step opens the Code window, marks the HIGH write', ev.includes('select:run:step:controller') && first?.visible && first.open && first.path === 'sketch.ino' && first.lines === 12 && first.tracked && first.pin === 'D13' && first.line === 8 && first.wrote?.level === 1, { first, ev });

// The window sits beside the bench, off the forward view.
const where = await page.evaluate(() => {
  const w = window.iynkware.world;
  const g = w.scene.getObjectByName('shell-panel:run/code');
  const head = w.camera.getWorldPosition(g.position.clone());
  const fwd = w.camera.getWorldDirection(g.position.clone());
  const to = g.position.clone().sub(head).setY(0).normalize();
  return +((Math.acos(Math.max(-1, Math.min(1, to.dot(fwd.setY(0).normalize())))) * 180) / Math.PI).toFixed(1);
});
check('it opens off to the side (about 40 degrees)', where > 25 && where < 60, { degrees: where });

// Hand pinch on Step: 10 ms more, the marker moves to the delay under the write.
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(700);
await press('hand-right', 'run:step', 0.35);
await page.waitForFunction(() => window.__code()?.line === 9, null, { timeout: 5000 }).catch(() => undefined);
const second = await page.evaluate(() => window.__code());
check('hand pinch on Step moves the marker to delay(500)', second?.line === 9 && second.delay?.ms === 500 && second.delay.elapsedMs === 20, second);

// Run: the marker follows the run between the two delays (and the writes).
await press('hand-right', 'run:run', 0.35);
await page.waitForFunction(() => window.iynkware.app.sim.state === 'running', null, { timeout: 5000 }).catch(() => undefined);
const seen = new Set();
for (let i = 0; i < 24; i++) {
  seen.add((await page.evaluate(() => window.__code()))?.line);
  await sleep(120);
}
check('while running it follows the sketch', seen.has(9) && seen.has(11), [...seen]);
await press('hand-right', 'run:run', 0.35);

if (SHOT) {
  // Look at the window for the picture.
  await page.evaluate(() => {
    const w = window.iynkware.world;
    const g = w.scene.getObjectByName('shell-panel:run/code');
    const head = w.camera.getWorldPosition(g.position.clone());
    const yaw = Math.atan2(-(g.position.x - head.x), -(g.position.z - head.z));
    window.__x('set_transform', { device: 'headset', orientation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } });
  });
  await sleep(900);
  await page.screenshot({ path: SHOT });
}

// The menu row hides it.
await page.evaluate(() => window.iynkware.app.shell.menuItems.value.find((m) => m.id === 'run/code').run());
await sleep(700);
const closed = await page.evaluate(() => ({ code: window.__code(), toggle: window.iynkware.app.shell.menuItems.value.find((m) => m.id === 'run/code').toggle.value }));
check('menu row Code hides it', closed.code?.open === false && closed.toggle === false, closed);

await browser.close();
console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
