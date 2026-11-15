// The whole bench is movable by the grip bar on its front edge (#323), in the IWER emulator, headless: a controller ray
// and trigger on the bar drag the bench up, right and away, and a part on it moves with it by the same amount.
//
//   npx vite --mode http --port 23323
//   node scripts/bench-move-check.mjs [url]

import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23323/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
const r3 = (p) => p && p.map((v) => +v.toFixed(3));
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dist = (a, b) => Math.hypot(...sub(a, b));

await page.goto(target.href, { waitUntil: 'load' });
await page.evaluate(() => localStorage.removeItem('iynk:xr:bench:v1'));
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 90000 });
await page.evaluate(async () => {
  await window.iynkware.ready;
  const w = window.iynkware.world;
  const app = window.iynkware.app;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  const V = w.camera.position.constructor;
  window.__pos = (name) => w.scene.getObjectByName(name)?.getWorldPosition(new V()).toArray() ?? null;
  window.__bench = () => app.bench.table.getWorldPosition(new V()).toArray();
  window.__part = () => {
    const o = app.bench.root.children.find((c) => c.userData?.partId);
    return o ? { id: o.userData.partId, at: o.getWorldPosition(new V()).toArray() } : null;
  };
  window.__ev = [];
  app.input.onAny((e) => {
    if (!e.type.endsWith('move') && e.target === 'bench/grip') window.__ev.push(`${e.type}:${e.pointer.source}/${e.pointer.mode}`);
  });
});
await sleep(600);
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await page.evaluate(() => window.iynkware.app.shell.closeHome?.());
await sleep(1500);

// The controller 0.25 m above and 0.25 m in front of the bar, pointing down at it (45 degrees), as a hand holds it.
const bar = await page.evaluate(() => window.__pos('bench:grip'));
check('the bench has its grip bar', !!bar, r3(bar));
const q = { x: -Math.sin(Math.PI / 8), y: 0, z: 0, w: Math.cos(Math.PI / 8) };
const from = [bar[0], bar[1] + 0.25, bar[2] + 0.25];
const pose = (p) => page.evaluate(([p, q]) => window.__x('set_transform', { device: 'controller-right', position: { x: p[0], y: p[1], z: p[2] }, orientation: q }), [p, q]);
await pose(from);
await sleep(400);
const bench0 = await page.evaluate(() => window.__bench());
const part0 = await page.evaluate(() => window.__part());

const delta = [0.15, 0.1, -0.1];
await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 1 }));
await sleep(250);
for (let i = 1; i <= 8; i++) {
  await pose(from.map((v, j) => v + (delta[j] * i) / 8));
  await sleep(90);
}
await sleep(250);
await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 0 }));
await sleep(400);

const ev = await page.evaluate(() => window.__ev.splice(0));
const bench1 = await page.evaluate(() => window.__bench());
const part1 = await page.evaluate(() => window.__part());
const moved = sub(bench1, bench0);
const partMoved = part0 && part1 ? sub(part1.at, part0.at) : null;
check(
  'dragging the bar moves the bench up, right and away by the hand move, and the part on it with it',
  ev.includes('select-start:controller/ray') &&
    dist(moved, delta) < 0.02 &&
    !!partMoved &&
    dist(partMoved, moved) < 0.003,
  { ev, delta, bench: r3(moved), part: part0?.id, partMoved: r3(partMoved) },
);

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
