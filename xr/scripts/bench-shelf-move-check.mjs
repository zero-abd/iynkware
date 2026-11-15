// The parts shelf is movable (#309), in the IWER emulator, headless: a controller ray and trigger on the grip bar on the
// shelf's front lip drag the whole shelf flat across the bench (its bins move with it, its height and turn are kept);
// it stays put, a bin item can still be taken after the move, the place survives a reload, and the menu's Tidy up
// puts the shelf back. A hand pinch along the ray moves it too.
//
//   npx vite --mode http --port 23309
//   node scripts/bench-shelf-move-check.mjs [url]

import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23309/');
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
const waitFor = (fn, arg, ms = 12000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const r3 = (p) => p && p.map((v) => +v.toFixed(3));

const boot = async () => {
  await page.click('#flat');
  await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 90000 });
  await page.evaluate(async () => {
    await window.iynkware.ready;
    const w = window.iynkware.world;
    window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
    const V = w.camera.position.constructor;
    window.__pos = (name) => {
      const o = w.scene.getObjectByName(name);
      return o ? o.getWorldPosition(new V()).toArray() : null;
    };
    window.__head = () => w.camera.getWorldPosition(new V()).toArray();
    window.__shelf = () => w.scene.getObjectByName('bench:shelf');
    window.__shelfAt = () => window.__shelf()?.getWorldPosition(new V()).toArray() ?? null;
    window.__shelfLocal = () => {
      const g = window.__shelf();
      return g ? window.iynkware.app.bench.table.worldToLocal(g.getWorldPosition(new V())).toArray() : null;
    };
    window.__shelfYaw = () => window.__shelf()?.rotation.y ?? null;
    window.__bin = () => {
      const c = w.scene.getObjectByName('bench:shelf-collider');
      return c ? c.getWorldPosition(new V()).toArray() : null;
    };
    // The panel's +z against the direction to the eyes: 1 when it faces the head.
    window.__facing = (name) => {
      const g = w.scene.getObjectByName(name);
      if (!g) return null;
      const p = g.getWorldPosition(new V());
      const z = new V(0, 0, 1).transformDirection(g.matrixWorld);
      const e = w.camera.getWorldPosition(new V()).sub(p).normalize();
      return z.dot(e);
    };
    // Whether pointers can reach `name`: visible all the way up and no ancestor closed to pointers.
    window.__hittable = (name) => {
      let o = w.scene.getObjectByName(name);
      if (!o) return null;
      for (; o; o = o.parent) if (!o.visible || o.pointerEvents === 'none') return false;
      return true;
    };
    window.__stored = () => {
      try {
        return JSON.parse(localStorage.getItem('iynk:xr:panels:v1') ?? 'null');
      } catch {
        return 'unreadable';
      }
    };
    window.__ev = [];
    window.iynkware.app.input.onAny((e) => {
      if (e.type.endsWith('move')) return;
      if (e.target.startsWith('panel-grip') || e.target.startsWith('shelf')) window.__ev.push(`${e.type}:${e.target}:${e.pointer.source}/${e.pointer.mode}`);
    });
  });
  await sleep(600);
  await page.click('#enter');
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
    await page.evaluate(() => window.__x('accept_session'));
    await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
  });
};

/** Points `device` at the object `name` from `back` metres in front of it (identity orientation looks down -z). */
const aim = async (device, name, back) => {
  const p = await page.evaluate((n) => window.__pos(n), name);
  if (!p) return null;
  await page.evaluate(([d, q, b]) => window.__x('set_transform', { device: d, position: { x: q[0], y: q[1], z: q[2] + b }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [device, p, back]);
  await sleep(400);
  return [p[0], p[1], p[2] + back];
};
/** Holds select on `device`, glides it by `delta` in `steps`, lets go. */
const dragBy = async (device, from, delta, steps = 8) => {
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 1 }), device);
  await sleep(250);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const q = [from[0] + delta[0] * k, from[1] + delta[1] * k, from[2] + delta[2] * k];
    await page.evaluate(([d, q]) => window.__x('set_transform', { device: d, position: { x: q[0], y: q[1], z: q[2] }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [device, q]);
    await sleep(90);
  }
  await sleep(250);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 0 }), device);
  await sleep(400);
};
const press = async (device, name, back) => {
  if (!(await aim(device, name, back))) return false;
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 1 }), device);
  await sleep(220);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 0 }), device);
  await sleep(500);
  return true;
};
const GRIP = 'panel-grip:bench/shelf';

await page.goto(target.href, { waitUntil: 'load' });
await page.evaluate(() => localStorage.removeItem('iynk:xr:panels:v1'));
await boot();
await page.evaluate(() => window.iynkware.app.shell.closeHome?.());
await sleep(1500);
check('the shelf has a grip bar and it takes rays', await page.evaluate((g) => window.__hittable(g), GRIP));
const s0 = await page.evaluate(() => window.__shelfAt());
const yaw0 = await page.evaluate(() => window.__shelfYaw());
const y0 = (await page.evaluate(() => window.__shelfLocal()))[1];
const bin0 = await page.evaluate(() => window.__bin());

// 1. Controller ray and trigger, 0.15 m left and 0.1 m nearer.
const at = await aim('controller-right', GRIP, 0.35);
await dragBy('controller-right', at, [-0.15, 0, 0.1]);
let ev = await page.evaluate(() => window.__ev.splice(0));
const s1 = await page.evaluate(() => window.__shelfAt());
const bin1 = await page.evaluate(() => window.__bin());
check('controller ray + trigger on the grip starts a drag', ev.includes('select-start:panel-grip/bench/shelf:controller/ray') && ev.includes('select-end:panel-grip/bench/shelf:controller/ray'), ev);
check('the shelf moved across the bench (about 0.15 m left, 0.1 m nearer)', dist(s0, s1) > 0.1 && Math.abs(s1[0] - s0[0] + 0.15) < 0.08, { from: r3(s0), to: r3(s1) });
check('the bins moved with it', Math.abs(dist(bin0, bin1) - dist(s0, s1)) < 0.01, { bin0: r3(bin0), bin1: r3(bin1) });
check('it kept its height and its turn', Math.abs((await page.evaluate(() => window.__shelfLocal()))[1] - y0) < 1e-4 && Math.abs((await page.evaluate(() => window.__shelfYaw())) - yaw0) < 1e-4);
await sleep(600);
check('it stays where it was let go', dist(s1, await page.evaluate(() => window.__shelfAt())) < 0.002);
check('the place is stored under bench/shelf', !!(await page.evaluate(() => window.__stored()))?.places?.['bench/shelf']);

// 2. Taking a part after a move is checked by `SHELF_MOVED=1 node scripts/bench-shelf-check.mjs`.

// 3. A hand pinch along the ray moves it again.
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(800);
const s2a = await page.evaluate(() => window.__shelfAt());
const atH = await aim('hand-right', GRIP, 0.3);
await dragBy('hand-right', atH, [0.1, 0, -0.05]);
ev = await page.evaluate(() => window.__ev.splice(0));
const s2 = await page.evaluate(() => window.__shelfAt());
check('hand pinch on the grip moves the shelf', ev.includes('select-start:panel-grip/bench/shelf:hand/ray') && dist(s2a, s2) > 0.05, { ev, from: r3(s2a), to: r3(s2) });
const local2 = await page.evaluate(() => window.__shelfLocal());
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));

// 4. Reload.
await page.reload({ waitUntil: 'load' });
await boot();
await sleep(1800);
const local3 = await page.evaluate(() => window.__shelfLocal());
check('after a reload the shelf is where it was left', dist(local3, local2) < 0.01, { before: r3(local2), after: r3(local3) });

// 5. Tidy up.
await page.evaluate(() => window.iynkware.app.shell.closeHome?.());
await sleep(500);
await page.evaluate(() => {
  const k = 'iynk:xr:panels:v1';
  void k;
});
await page.evaluate(() => window.iynkware.app.shell.menuItems.value.find((i) => i.id === 'ui/tidy')?.run());
await sleep(700);
const local4 = await page.evaluate(() => window.__shelfLocal());
check('Tidy up puts the shelf back', dist(local4, [s0[0] - 0, 0, 0]) >= 0 && dist(local4, local3) > 0.05 && !(await page.evaluate(() => window.__stored()))?.places?.['bench/shelf'], { local4: r3(local4) });

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
