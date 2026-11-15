// The robot arena in the IWER emulator, headless (issue #126): open a robot project, enter the Range, see the arena on the
// floor 1.0 m ahead, press Run with the controller ray and trigger, watch the program drive the robot (drive-base crosses
// the arena, line-follower stays near its oval), press Stop with a hand pinch, and go Back to the bench.
//
//   npx vite --mode http --port 23126 --strictPort            # in another terminal
//   node scripts/range-robots-check.mjs [url] [shot-prefix]   # url defaults to http://localhost:23126/
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = new globalThis.URL(process.argv[2] ?? 'http://localhost:23126/');
const SHOT = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};

async function walk(projectId, drives) {
  console.log(`--- ${projectId}`);
  const url = new globalThis.URL(base.href);
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  page.on('console', (m) => {
    const t = m.text();
    if (!t.includes('[vite]') && m.type() === 'error') console.log('[page error]', t.slice(0, 300));
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (name) => SHOT && (await page.screenshot({ path: `${SHOT}-${projectId.replace('prj_robot-', '')}-${name}.png` }));

  await page.goto(url.href, { waitUntil: 'load' });
  await page.click('#flat');
  await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 60000 });
  await ev(async () => {
    await window.iynkware.ready;
    window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
    window.__arena = () => window.iynkware.world.scene.getObjectByName('range-arena-room')?.userData.arena;
    window.__obj = (n) => window.iynkware.world.scene.getObjectByName(n);
  });
  await page.click('#enter');
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
    await ev(() => window.__x('accept_session'));
    await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
  });
  await sleep(800);
  const file = new globalThis.URL(`../../content/projects/robots/${projectId.replace('prj_robot-', '')}.project.json`, import.meta.url).pathname;
  await ev(async (f) => {
    const doc = await (await fetch(`/@fs${f}`)).json();
    window.iynkware.app.project.open(doc);
  }, file);
  await sleep(500);
  await ev(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.5, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }));
  await sleep(300);

  check('go(range) is accepted for a robot project', await ev(() => window.iynkware.app.shell.go('range')));
  await page.waitForFunction(() => window.__arena(), null, { timeout: 30000 });
  check('bench is hidden in the range', (await ev(() => window.iynkware.app.bench.table.visible)) === false);
  await page.waitForFunction(() => window.__arena().status().mech?.state === 'ready', null, { timeout: 90000 });
  // look down at the floor, as a person would, so the screenshots show the arena
  await ev(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.5, z: 0 }, orientation: { x: -0.3420, y: 0, z: 0, w: 0.9397 } }));
  await sleep(1200);
  const info = await ev(() => {
    const a = window.__arena();
    return { place: a.place, depth: a.spec.depth, status: a.status(), readout: a.readout() };
  });
  check('physics ready, arena centred 1.0 m + half depth ahead on the floor', info.status.mech.state === 'ready' && Math.abs(info.place.cz + 1 + info.depth / 2) < 0.01 && info.place.floorY === 0, info);
  console.log('readout:', JSON.stringify(info.readout));
  await shot('arena');

  const chassis = () =>
    ev(() => {
      const a = window.__arena();
      const i = a.spec.bodies.findIndex((b) => b.id === a.spec.chassis);
      return [a.poses.pose[i * 4], a.poses.pose[i * 4 + 1], a.poses.pose[i * 4 + 3]];
    });
  const start = await chassis();
  check('chassis starts at the document start pose', start.every(Number.isFinite) && Math.abs(Math.abs(start[0]) - 0.7) < 0.05, start);

  // controller ray at a plate, then the trigger
  const plateAt = (name) => ev((n) => window.__obj(n).getWorldPosition(window.iynkware.world.camera.position.clone()).toArray(), name);
  const aim = async (device, name) => {
    const p = await plateAt(name);
    await ev(([d, ps]) => window.__x('set_transform', { device: d, position: { x: ps[0], y: ps[1], z: ps[2] + 0.6 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [device, p]);
    await sleep(350);
  };
  const trigger = async (device) => {
    await ev((d) => window.__x('set_select_value', { device: d, value: 1 }), device);
    await sleep(180);
    await ev((d) => window.__x('set_select_value', { device: d, value: 0 }), device);
    await sleep(300);
  };
  await aim('controller-right', 'arena:run');
  await trigger('controller-right');
  await page.waitForFunction(() => window.__arena().status().run === 'running', null, { timeout: 15000 }).catch(() => undefined);
  const running = await ev(() => window.__arena().status());
  check('Run with the controller ray starts the run', running.run === 'running', running);

  // watch
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < drives.seconds * 1000) {
    samples.push(await chassis());
    await sleep(200);
    if (samples.length === Math.floor(drives.seconds * 2)) await shot('mid');
  }
  await shot('driving');
  const end = samples.at(-1);
  const travelled = samples.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - samples[i][0], p[1] - samples[i][1]), 0);
  const trailMoved = await ev(() => {
    const t = window.__arena().trail.positions;
    return Math.hypot(t[t.length - 3] - t[0], t[t.length - 2] - t[1]);
  });
  const sensors = await ev(() => window.__arena().readout());
  console.log('readout while running:', JSON.stringify(sensors));
  const simS = (await ev(() => window.__arena().status())).simS;
  check('the sim clock runs', simS > 1, simS);
  check('the robot moved', travelled > 0.3, { travelled: +travelled.toFixed(2), start, end });
  check('the trail follows the path', trailMoved > 0.05, +trailMoved.toFixed(2));
  drives.verify(check, samples, start, end);

  // Stop with a hand pinch
  await ev(() => window.__x('set_input_mode', { mode: 'hand' }));
  await sleep(600);
  const pinchAt = async (name) => {
    const p = await plateAt(name);
    await ev((ps) => window.__x('set_transform', { device: 'hand-right', position: { x: ps[0], y: ps[1], z: ps[2] + 0.35 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), p);
    await sleep(500);
    await ev(() => window.__x('set_select_value', { device: 'hand-right', value: 1 }));
    await sleep(250);
    await ev(() => window.__x('set_select_value', { device: 'hand-right', value: 0 }));
    await sleep(400);
  };
  await pinchAt('arena:stop');
  await page.waitForFunction(() => window.__arena().status().run === 'idle', null, { timeout: 15000 }).catch(() => undefined);
  await sleep(1200);
  const stopped = await ev(() => window.__arena().status());
  const back = await chassis();
  check('Stop with a hand pinch stops the run', stopped.run === 'idle', stopped);
  check('the robot is back at the start', Math.hypot(back[0] - start[0], back[1] - start[1]) < 0.05, { back, start });
  await shot('stopped');

  // Back to the bench
  await pinchAt('arena:back');
  await page.waitForFunction(() => !window.__arena(), null, { timeout: 8000 }).catch(() => undefined);
  await sleep(300);
  const place = await ev(() => window.iynkware.app.shell.place.value);
  const after = await ev(() => ({ table: window.iynkware.app.bench.table.visible, root: window.iynkware.app.bench.root.visible, arena: !!window.__arena(), plates: ['arena:run', 'arena:stop', 'arena:back', 'range-arena-readout'].filter((n) => window.__obj(n)) }));
  check('Back to bench: place is bench, bench shown again, arena gone', place === 'bench' && after.table && after.root && !after.arena && after.plates.length === 0, { place, after });
  await page.close();
}

const dist = (x, y, pts) => {
  let best = Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const j = (i + 2) % pts.length;
    const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[j], pts[j + 1]];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))));
  }
  return best;
};

await walk('prj_robot-drive-base', {
  seconds: 5,
  verify: (c, _s, start, end) => c('drive-base crosses the arena', Math.hypot(end[0] - start[0], end[1] - start[1]) > 0.3, { start, end }),
});
const oval = JSON.parse(readFileSync(new globalThis.URL('../../content/projects/robots/line-follower.project.json', import.meta.url), 'utf8')).domains.robotics.data.arena.tracks[0].points_mm.flat().map((v) => v / 1000);
await walk('prj_robot-line-follower', {
  seconds: 8,
  verify: (c, samples) => {
    const worst = Math.max(...samples.map((p) => dist(p[0], p[1], oval)));
    c('line-follower stays within 12 cm of its oval for the whole run', worst < 0.12, { worst: +worst.toFixed(3) });
  },
});
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
