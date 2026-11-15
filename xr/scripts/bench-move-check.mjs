// The whole bench is movable by the grip bar on its far edge (#323, #363), in the IWER emulator, headless: a controller ray
// held where a hand is and its trigger on the bar drag the bench up, right and away, and a part on it moves with it by the same amount.
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

// The controller where a hand is: 0.3 m below the eyes, 0.35 m ahead of them and 0.15 m to the right, aimed at the bar.
// (The bar used to lie against the body, behind where the hands are, so no ray from a hand could reach it; #363.)
const bar = await page.evaluate(() => window.__pos('bench:grip'));
check('the bench has its grip bar', !!bar, r3(bar));
const eye0 = await page.evaluate(() => window.iynkware.world.camera.getWorldPosition(new window.iynkware.world.camera.position.constructor()).toArray());
const from = [eye0[0] + 0.15, eye0[1] - 0.3, eye0[2] - 0.35];
check('the bar is beyond the hand, out on the table', bar[2] < from[2] - 0.2, { bar: r3(bar), hand: r3(from) });
// The controller's -z along the aim: yaw about y, then pitch about x.
const aim = sub(bar, from);
const yaw = Math.atan2(-aim[0], -aim[2]);
const pitch = Math.atan2(aim[1], Math.hypot(aim[0], aim[2]));
const q = {
  x: Math.cos(yaw / 2) * Math.sin(pitch / 2),
  y: Math.sin(yaw / 2) * Math.cos(pitch / 2),
  z: -Math.sin(yaw / 2) * Math.sin(pitch / 2),
  w: Math.cos(yaw / 2) * Math.cos(pitch / 2),
};
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
const bar1 = await page.evaluate(() => window.__pos('bench:grip'));
const top1 = await page.evaluate(() => window.iynkware.app.bench.benchTop.value);
const eye = await page.evaluate(() => window.iynkware.world.camera.getWorldPosition(new window.iynkware.world.camera.position.constructor()).toArray());
const barMoved = sub(bar1, bar);
// The bench swings round the eyes as it is carried right (bench/pose/move.ts `orbitedTop`): its bar stays in the hand,
// it turns to face the eyes, and the part on it keeps its place on the bench.
const facing = Math.atan2(-(bench1[0] - eye[0]), -(bench1[2] - eye[2]));
const partSpan = (b, p) => Math.hypot(p[0] - b[0], p[1] - b[1], p[2] - b[2]);
check(
  'dragging the bar carries it with the hand, the bench turned round to face the eyes, and the part on it with it',
  ev.includes('select-start:controller/ray') &&
    dist(barMoved, delta) < 0.02 &&
    top1.yawRad < -0.1 &&
    Math.abs(top1.yawRad - facing) < 0.02 &&
    !!part0 &&
    !!part1 &&
    Math.abs(partSpan(bench1, part1.at) - partSpan(bench0, part0.at)) < 0.003,
  { ev, delta, bar: r3(barMoved), yaw: top1.yawRad, facing, part: part0?.id },
);

// A hand where a hand is, pinching along its ray, carries the bench too (#363): left and back towards the person.
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(600);
const hBar = await page.evaluate(() => window.__pos('bench:grip'));
const hEye = await page.evaluate(() => window.iynkware.world.camera.getWorldPosition(new window.iynkware.world.camera.position.constructor()).toArray());
const hFrom = [hEye[0] + 0.15, hEye[1] - 0.3, hEye[2] - 0.35];
const hAim = sub(hBar, hFrom);
const hYaw = Math.atan2(-hAim[0], -hAim[2]);
const hPitch = Math.atan2(hAim[1], Math.hypot(hAim[0], hAim[2]));
const hq = {
  x: Math.cos(hYaw / 2) * Math.sin(hPitch / 2),
  y: Math.sin(hYaw / 2) * Math.cos(hPitch / 2),
  z: -Math.sin(hYaw / 2) * Math.sin(hPitch / 2),
  w: Math.cos(hYaw / 2) * Math.cos(hPitch / 2),
};
const hPose = (p) => page.evaluate(([p, q]) => window.__x('set_transform', { device: 'hand-right', position: { x: p[0], y: p[1], z: p[2] }, orientation: q }), [p, hq]);
await hPose(hFrom);
await sleep(450);
const hDelta = [-0.1, 0, 0.05];
await page.evaluate(() => window.__x('set_select_value', { device: 'hand-right', value: 1 }));
await sleep(250);
for (let i = 1; i <= 8; i++) {
  await hPose(hFrom.map((v, j) => v + (hDelta[j] * i) / 8));
  await sleep(90);
}
await sleep(250);
await page.evaluate(() => window.__x('set_select_value', { device: 'hand-right', value: 0 }));
await sleep(400);
const hEv = await page.evaluate(() => window.__ev.splice(0));
const hMoved = sub(await page.evaluate(() => window.__pos('bench:grip')), hBar);
check('a hand pinch along its ray on the bar carries the bench', hEv.includes('select-start:hand/ray') && dist(hMoved, hDelta) < 0.03, {
  ev: hEv,
  delta: hDelta,
  bar: r3(hMoved),
});

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
