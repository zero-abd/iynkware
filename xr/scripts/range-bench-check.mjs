// The drone bench in the IWER emulator, headless (issue #121): the drone and the part plates on the bench, MOTORS before
// FRAME is refused with a callout, build in order, the XT60 fitted turned round pops on plug-in, the motor test spins the
// props in turn and finds M3, Build it for me completes the build.
//
//   npx vite --mode http --port 23121 --strictPort            # in another terminal
//   node scripts/range-bench-check.mjs [url] [shot-prefix]    # url defaults to http://localhost:23121/
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23121/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_drone-quad5');
const SHOT = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[vite]')) return;
  if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), t.slice(0, 300));
});
page.on('crash', () => console.log('[page crashed]'));
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
  window.__ev = [];
  window.iynkware.app.input.onAny((e) => {
    if (!e.type.endsWith('move')) window.__ev.push(`${e.type}:${e.target}:${e.pointer.source}/${e.pointer.mode}`);
  });
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  window.__root = () => window.iynkware.world.scene.getObjectByName('range-bench');
  window.__hit = (id) => {
    const m = window.__root().userData.hits[id];
    const v = m.getWorldPosition(window.iynkware.world.camera.position.clone());
    return v.toArray();
  };
  window.__say = () => {
    const g = window.iynkware.world.scene.getObjectByName('range-bench-say');
    return g ? { text: g.userData.text, tone: g.userData.tone } : null;
  };
  window.__bench = () => {
    const d = window.iynkware.app.project.doc.domains.drone.data.ext?.['x-iynkware-bench'];
    return d ? { parts: d.parts.map((p) => p.join(':')), plugged: d.plugged, fault: d.fault ?? null, smokeOk: d.smokeOk, motorOk: d.motorOk, crossed: d.crossed, esc: d.esc } : null;
  };
});
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await page.waitForFunction(() => window.__root()?.userData.hits, null, { timeout: 30000 });
await sleep(1200);
// Seated head, looking down at the bench, for the pictures.
await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { x: -0.3007, y: 0, z: 0, w: 0.9537 } }));
await sleep(600);
const shot = async (name) => {
  if (SHOT) await page.screenshot({ path: `${SHOT}-${name}.png` });
};
const standing = (id) => /^bench:(part|turn):/.test(id);
const press = async (device, id, back0) => {
  const p = await page.evaluate((i) => window.__hit(i), id);
  // A standing plate: a level ray from afar. A plate lying on the bench: a ray coming down at 45 degrees from above.
  const lying = !standing(id);
  const pos = lying ? { x: p[0], y: p[1] + 0.25, z: p[2] + 0.25 } : { x: p[0], y: p[1], z: p[2] + (back0 ?? 0.8) };
  const q = lying ? { x: -0.3827, y: 0, z: 0, w: 0.9239 } : { x: 0, y: 0, z: 0, w: 1 };
  await page.evaluate(([d, ps, o]) => window.__x('set_transform', { device: d, position: ps, orientation: o }), [device, pos, q]);
  await sleep(350);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 1 }), device);
  await sleep(160);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 0 }), device);
  await sleep(250);
};
const dev = 'controller-right';
const info = await page.evaluate(() => {
  const r = window.__root();
  const rend = window.iynkware.world.renderer.info.render;
  return { hits: Object.keys(r.userData.hits).length, calls: rend.calls, place: window.iynkware.app.shell.place.value };
});
check('the bench is up: plates for every part and action', info.hits >= 12 + 6 + 4 && info.place === 'bench', info);
await shot('1-arrival');

// MOTORS before FRAME: refused.
await press(dev, 'bench:part:MOTORS');
let say = await page.evaluate(() => window.__say());
check('MOTORS before FRAME: refusal callout (fail)', say?.tone === 'fail' && /after/i.test(say.text), say);
check('nothing went on', (await page.evaluate(() => window.__bench())) === null || (await page.evaluate(() => window.__bench().parts.length)) === 0);
await shot('2-refusal');

// Build in order (the XT60 the right way round first), then the motor test: M3 is the one found spinning wrong.
for (const id of ['FRAME', 'MOTORS', 'ESC', 'WIRES', 'FC', 'XT60', 'CAM', 'RX', 'VTX', 'TOP', 'BATT']) await press(dev, `bench:part:${id}`);
let b = await page.evaluate(() => window.__bench());
check('built in order', b.parts.length === 11 && b.parts.every((p) => p.endsWith(':0')) && b.crossed.join() === 'M3', b);
await shot('3-built');
await press(dev, 'bench:motors');
const samples = [];
const t0 = Date.now();
while (Date.now() - t0 < 4000) {
  samples.push(await page.evaluate(() => {
    const d = window.__root().userData.drone;
    return ['M1', 'M2', 'M3', 'M4'].map((m) => d.get(`motor:${m}`) ?? 0);
  }));
  if (samples.length === 14) await shot('4-motor-test');
  await sleep(100);
}
const spinning = samples.map((s) => s.findIndex((v) => v !== 0));
const turns = [...new Set(spinning.filter((i) => i >= 0))];
say = await page.evaluate(() => window.__say());
b = await page.evaluate(() => window.__bench());
check('motor test spins M1, M2, M3, M4 in turn, callout only at the end', turns.join() === '0,1,2,3' && spinning[0] === 0 && spinning.at(-1) === -1, turns);
check('M3 found and reversed in the ESC', /M3/.test(say?.text ?? '') && b.motorOk && b.plugged && b.esc.join() === 'M3', { say, motorOk: b.motorOk, esc: b.esc });
await shot('5-found');

await press(dev, 'bench:smoke');
await sleep(300);
await shot('6-smoke-lamp');
await sleep(1200);
say = await page.evaluate(() => window.__say());
check('smoke stopper: result after the lamp', /smoke|short|safe/i.test(say?.text ?? ''), say);

// The smoke stopper left the battery out: turn the XT60 round, plug in: pop.
await press(dev, 'bench:turn:XT60');
b = await page.evaluate(() => window.__bench());
check('XT60 fitted turned round', b.parts.includes('XT60:1'), b.parts);
await press(dev, 'bench:plug');
b = await page.evaluate(() => window.__bench());
say = await page.evaluate(() => window.__say());
check('plug in with XT60 turned: pop', b.plugged && b.fault === 'XT60' && say?.tone === 'fail' && /POP/.test(say.text), { fault: b.fault, say });
await shot('7-pop');
await press(dev, 'bench:plug'); // unplug
await press(dev, 'bench:strip');
b = await page.evaluate(() => window.__bench());
check('strip clears the bench', b.parts.length === 0 && !b.plugged && b.fault === null, b);
await shot('8-stripped');

await press(dev, 'bench:build');
b = await page.evaluate(() => window.__bench());
say = await page.evaluate(() => window.__say());
check('Build it for me: every part on, props too', b.parts.length === 12 && b.parts.includes('PROPS:0') && b.fault === null && !b.plugged, { n: b.parts.length, say });
await sleep(1200);
await shot('9-built-for-me');

// Hands: a pinch on Strip.
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(700);
await press('hand-right', 'bench:strip', 0.35);
b = await page.evaluate(() => window.__bench());
check('hand pinch on Strip', b.parts.length === 0, b);
const perf = await page.evaluate(() => ({ calls: window.iynkware.world.renderer.info.render.calls, tris: window.iynkware.world.renderer.info.render.triangles }));
console.log('render', perf);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
