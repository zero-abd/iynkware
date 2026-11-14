// The walking skeleton in the IWER emulator, headless: the entry page loads no engine, Open on this screen draws the
// bench on the flat page, Enter starts a session, a controller ray and trigger on the run cluster's Run compiles,
// uploads and starts Blink in the worker, the LED toggles every 500 ms, a hand pinch on Pause holds it, a hand pinch on
// Run resumes it, Step adds 10 ms, Reset stops it at t = 0, and Run starts it again from zero.
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
  window.__btn = (n) => window.iynkware.world.scene.getObjectByName(`run:${n}`).getWorldPosition(window.iynkware.world.camera.position.clone()).toArray();
  window.__cluster = () => {
    const g = window.iynkware.world.scene.getObjectByName('run-cluster');
    return { ...g.userData.state, clock: g.userData.clock };
  };
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
const ctlPose = await page.evaluate(() => {
  const p = window.iynkware.app.input.pose('right');
  return p && { source: p.source, position: p.position.map((v) => +v.toFixed(3)), dir: Math.hypot(...p.ray.direction), open: p.open };
});
check('controller pose each frame', ctlPose?.source === 'controller' && Math.abs(ctlPose.dir - 1) < 1e-3 && ctlPose.open === false, ctlPose);

// Presses a plate of the run cluster (`run:<name>`) with a ray: identity orientation points -Z, so start `back`
// metres in front of the plate at its height. Trigger for a controller, pinch for a hand.
const press = async (device, name, back) => {
  const p = await page.evaluate((n) => window.__btn(n), name);
  await page.evaluate(([d, q, b]) => window.__x('set_transform', { device: d, position: { x: q[0], y: q[1], z: q[2] + b }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [device, p, back]);
  await sleep(450);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 1 }), device);
  await sleep(220);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 0 }), device);
};
const sim = () => page.evaluate(() => [window.iynkware.app.sim.state, Math.round((window.iynkware.app.sim.lastFrame?.atNs ?? 0) / 1e6), window.__led(), window.__cluster().phase]);
const waitState = (s, ms) => page.waitForFunction((want) => window.iynkware.app.sim.state === want, s, { timeout: ms }).then(() => true, () => false);

// Controller ray and trigger on Run: compiling, uploading (600 ms each), then running.
await press('controller-right', 'run', 0.3);
await sleep(150);
const compiling = await page.evaluate(() => window.__cluster());
let ev = await page.evaluate(() => window.__ev.splice(0));
check('controller trigger on Run -> select, compiling', ev.includes('select:run:run:controller/ray') && compiling.phase === 'compiling' && compiling.label === 'compiling', { ev, compiling });
const started = await waitState('running', 8000);
await sleep(300);
const samples = [];
for (let i = 0; i < 12; i++) {
  samples.push(await sim());
  await sleep(150);
}
const lit = samples.filter((s) => s[2] > 0).length;
check('sim running and LED toggles', started && samples.every((s) => s[0] === 'running' && s[3] === 'running') && lit > 0 && lit < samples.length, samples);
// Seated head, looking down at the bench, for the picture.
await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { x: -0.3007, y: 0, z: 0, w: 0.9537 } }));
await sleep(700);
if (SHOT) await page.screenshot({ path: SHOT });
const perf = await page.evaluate(() => ({ calls: window.iynkware.world.renderer.info.render.calls, tris: window.iynkware.world.renderer.info.render.triangles }));

// Hand pinch on Pause (the Run plate while running): paused, the LED holds.
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(700);
await press('hand-right', 'run', 0.35);
await sleep(500);
ev = await page.evaluate(() => window.__ev.splice(0));
const p1 = await sim();
await sleep(700);
const p2 = await sim();
check('hand pinch on Pause -> select, paused, LED holds', ev.includes('select:run:run:hand/ray') && p1[0] === 'paused' && p1[3] === 'paused' && p1[1] === p2[1] && p1[2] === p2[2], { ev, p1, p2, sources: await page.evaluate(() => window.iynkware.app.input.sources.value) });

// Poses every frame, touching nothing: a tracked hand has a pinch point, a unit palm normal and an aim ray.
const handPose = await page.evaluate(() => {
  const p = window.iynkware.app.input.pose('right');
  return p && { source: p.source, position: p.position.map((v) => +v.toFixed(3)), n: Math.hypot(...p.normal), dir: Math.hypot(...p.ray.direction), open: p.open, pinching: p.pinching };
});
check('hand pose each frame', handPose?.source === 'hand' && Math.abs(handPose.n - 1) < 1e-3 && Math.abs(handPose.dir - 1) < 1e-3, handPose);

// Hand pinch on Run again: resumes where it was, without compiling again.
await press('hand-right', 'run', 0.35);
await sleep(150);
const resumed = await sim();
await sleep(600);
const later = await sim();
check('hand pinch on Run resumes without a reload', resumed[0] === 'running' && resumed[3] === 'running' && later[1] > p2[1], { p2, resumed, later });

// Step from running pauses first, then each Step adds 10 ms of simulated time.
await press('hand-right', 'step', 0.35);
await sleep(500);
const s1 = await sim();
await press('hand-right', 'step', 0.35);
await sleep(500);
const s2 = await sim();
ev = await page.evaluate(() => window.__ev.splice(0));
check('hand pinch on Step pauses, then steps 10 ms', ev.includes('select:run:step:hand/ray') && s1[0] === 'paused' && s2[0] === 'paused' && s2[1] - s1[1] === 10, { s1, s2 });

// Reset: stopped, t = 0, the LED dark.
await press('hand-right', 'reset', 0.35);
await sleep(600);
const r = await sim();
const clock = await page.evaluate(() => window.__cluster().clock);
check('hand pinch on Reset -> idle, t = 0, LED dark', r[0] === 'idle' && r[3] === 'stopped' && r[2] === 0 && clock.startsWith('t 0.00 s'), { r, clock });

// The controller again: Run starts from the beginning.
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(600);
await press('controller-right', 'run', 0.3);
const again = (await waitState('running', 8000)) && (await sim());
check('controller Run after Reset starts from zero', again && again[0] === 'running' && again[1] < 3000, again);
console.log('render', perf);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
