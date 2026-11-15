// The quick input switch in the IWER emulator: B on the right controller turns hands off (hands tracked but ignored:
// no source, no pose, no pointers), and B again turns them on (hands drive the app).
//
//   npx vite --mode http --port 23645          # in another terminal
//   node scripts/input-switch-check.mjs [url]
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23645/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
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
await page.evaluate(() => window.iynkware.ready);
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.IWER_DEVICE.remote.dispatch('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await page.evaluate(() => {
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  window.__state = () => {
    const { app, world } = window.iynkware;
    const mp = world.input.xr.multiPointers.right;
    return {
      mode: app.input.inputMode.value,
      sources: { ...app.input.sources.value },
      pose: !!app.input.pose('right'),
      ray: mp.getPointer('ray').getEnabled(),
    };
  };
});
const pressB = async () => {
  await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-right', buttons: [{ index: 4, value: 1 }], axes: [] }));
  await sleep(250);
  await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-right', buttons: [{ index: 4, value: 0 }], axes: [] }));
  await sleep(250);
};

await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(800);
const s0 = await page.evaluate(() => window.__state());
check('starts in auto with the controllers driving', s0.mode === 'auto' && s0.sources.right === 'controller' && s0.ray, s0);

await pressB();
const s1 = await page.evaluate(() => window.__state());
check('B turns hands off (controllers only); controllers still drive', s1.mode === 'controllers' && s1.sources.right === 'controller' && s1.ray, s1);

await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(800);
const s2 = await page.evaluate(() => window.__state());
check('tracked hands are ignored: no source, no pose, no ray', s2.sources.right === null && !s2.pose && !s2.ray, s2);

await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(800);
await pressB();
const s3 = await page.evaluate(() => window.__state());
check('B again turns hands on; the held controller is now ignored', s3.mode === 'hands' && s3.sources.right === null && !s3.ray, s3);

await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(800);
const s4 = await page.evaluate(() => window.__state());
check('hands drive the app: source, pose and ray', s4.sources.right === 'hand' && s4.pose && s4.ray, s4);

await browser.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
