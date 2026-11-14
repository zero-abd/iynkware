// The walking skeleton in the IWER emulator, headless: the entry page loads no engine, Open on this screen draws the
// bench on the flat page, Enter starts a session, a controller ray and trigger on Run starts Blink in the worker, the
// LED toggles every 500 ms, a hand pinch on Stop stops it and a hand pinch on Run starts it again from zero.
//
//   npm run dev:http                                  # in another terminal (IWER is injected by the dev plugin)
//   node scripts/emulator-check.mjs [url] [shot.png]  # url defaults to http://localhost:8081/
//
// Playwright comes with @iwsdk/vite-plugin-dev. It needs a Chromium: `npx playwright install chromium` (that command can
// delete other cached Playwright builds). Exit 0 when every check passes.
import { chromium } from 'playwright';

// Always the built Blink template: without `?project=`, a first-time person gets onboarding (Blink in build mode).
const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:8081/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
const URL = target.href;
const SHOT = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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

await page.goto(URL, { waitUntil: 'load' });
// The entry page loads no engine until asked: Open on this screen boots the bench on the flat page.
check('no engine before a press', await page.evaluate(() => window.iynkware === undefined && !document.querySelector('#scene-container canvas')));
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 60000 });
await page.evaluate(async () => {
  await window.iynkware.ready;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  window.__ev = [];
  window.iynkware.app.input.onAny((e) => {
    if (e.type.endsWith('move')) return;
    window.__ev.push(`${e.type}:${e.target}:${e.pointer.source}/${e.pointer.mode}`);
  });
  window.__led = () => {
    const m = window.iynkware.app.bench.objectOf('cmp_led1')?.getObjectByName('light');
    return m ? m.material.emissiveIntensity : -1;
  };
  window.__btn = (n) => window.iynkware.world.scene.getObjectByName(`button:${n}`).getWorldPosition(window.iynkware.world.camera.position.clone()).toArray();
});
await sleep(800);
check('flat page shows the bench', await page.evaluate(() => window.iynkware.world.renderer.info.render.calls > 5), await page.evaluate(() => window.iynkware.world.renderer.info.render.calls));

await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await sleep(800);
const inXr = await page.evaluate(() => ({
  mode: window.iynkware.app.mode,
  blend: window.iynkware.world.session?.environmentBlendMode,
  sources: window.iynkware.app.input.sources.value,
  shell: getComputedStyle(document.getElementById('shell')).display,
}));
check('immersive session, controllers, shell hidden', inXr.sources.right === 'controller' && inXr.shell === 'none', inXr);

// Controller ray at Run: identity orientation points -Z; start 30 cm in front of the button at its height.
const run = await page.evaluate(() => window.__btn('Run'));
await page.evaluate((p) => window.__x('set_transform', { device: 'controller-right', position: { x: p[0], y: p[1], z: p[2] + 0.3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), run);
await sleep(400);
await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 1 }));
await sleep(200);
await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 0 }));
await sleep(1500);
let ev = await page.evaluate(() => window.__ev.splice(0));
check('controller trigger on Run -> select', ev.includes('select:run:controller/ray'), ev);
const samples = [];
for (let i = 0; i < 12; i++) {
  samples.push(await page.evaluate(() => [window.iynkware.app.sim.state, Math.round((window.iynkware.app.sim.lastFrame?.atNs ?? 0) / 1e6), window.__led()]));
  await sleep(150);
}
const lit = samples.filter((s) => s[2] > 0).length;
check('sim running and LED toggles', samples.every((s) => s[0] === 'running') && lit > 0 && lit < samples.length, samples);
// Seated head, looking down at the bench, for the picture.
await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { x: -0.3007, y: 0, z: 0, w: 0.9537 } }));
await sleep(700);
if (SHOT) await page.screenshot({ path: SHOT });

// Hand pinch on Stop.
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(700);
const stop = await page.evaluate(() => window.__btn('Stop'));
await page.evaluate((p) => window.__x('set_transform', { device: 'hand-right', position: { x: p[0], y: p[1], z: p[2] + 0.35 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), stop);
await sleep(500);
await page.evaluate(() => window.__x('set_select_value', { device: 'hand-right', value: 1 }));
await sleep(250);
await page.evaluate(() => window.__x('set_select_value', { device: 'hand-right', value: 0 }));
await sleep(600);
ev = await page.evaluate(() => window.__ev.splice(0));
const after = await page.evaluate(() => [window.iynkware.app.sim.state, window.__led(), window.iynkware.app.input.sources.value]);
check('hand pinch on Stop -> select, sim idle, LED dark', ev.includes('select:stop:hand/ray') && after[0] === 'idle' && after[1] === 0, { ev, after });

// Hand pinch on Run again: it restarts from the beginning.
await page.evaluate((p) => window.__x('set_transform', { device: 'hand-right', position: { x: p[0], y: p[1], z: p[2] + 0.35 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), run);
await sleep(500);
await page.evaluate(() => window.__x('set_select_value', { device: 'hand-right', value: 1 }));
await sleep(250);
await page.evaluate(() => window.__x('set_select_value', { device: 'hand-right', value: 0 }));
await sleep(800);
const again = await page.evaluate(() => [window.iynkware.app.sim.state, Math.round((window.iynkware.app.sim.lastFrame?.atNs ?? 0) / 1e6)]);
check('hand pinch on Run restarts', again[0] === 'running' && again[1] < 3000, again);
const perf = await page.evaluate(() => ({ calls: window.iynkware.world.renderer.info.render.calls, tris: window.iynkware.world.renderer.info.render.triangles }));
console.log('render', perf);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
