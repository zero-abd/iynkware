// Home, Recentre and Exit in the IWER emulator, headless: enter a session; the cluster sits on the left, 0.8 to 0.9 m
// away, a little below eye level, facing the head, with a grip bar; drag it by controller ray and trigger, then by hand
// pinch; turn and walk away (it stays put in the room); press Recentre with a controller ray (the bench eases to in front
// of the head and the cluster comes back beside it); press Home (Home opens in front of the turned head), turn back and
// pinch Home by hand (Home comes round to the new view); the menu's Tidy up puts a moved cluster back; a moved cluster
// comes back after a reload; a quick tap on Exit does nothing, a held trigger on Exit ends the session.
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
const waitFor = (fn, arg, ms = 12000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const r3 = (p) => p && p.map((v) => +v.toFixed(3));
const ID = 'shell/session-controls';
const GRIP = `panel-grip:${ID}`;

const boot = async () => {
  await page.click('#flat');
  await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 90000 });
  await page.evaluate(async () => {
    await window.iynkware.ready;
    const w = window.iynkware.world;
    const V = w.camera.position.constructor;
    window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
    window.__spot = (name) => w.scene.getObjectByName(name)?.getWorldPosition(new V()).toArray() ?? null;
    window.__head = () => w.camera.getWorldPosition(new V()).toArray();
    window.__local = (name) => {
      const o = w.scene.getObjectByName(name);
      return o ? window.iynkware.app.bench.table.worldToLocal(o.getWorldPosition(new V())).toArray() : null;
    };
    window.__facing = (name) => {
      const g = w.scene.getObjectByName(name);
      const p = g.getWorldPosition(new V());
      const z = new V(0, 0, 1).transformDirection(g.matrixWorld);
      return z.dot(w.camera.getWorldPosition(new V()).sub(p).normalize());
    };
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
      if (e.target.startsWith('panel-grip/shell/session')) window.__ev.push(`${e.type}:${e.pointer.source}/${e.pointer.mode}`);
      else if (e.type.startsWith('select')) window.__ev.push(`${e.type}:${e.target}:${e.pointer.source}/${e.pointer.mode}`);
    });
  });
  await sleep(500);
  check('no controls on the flat page', await page.evaluate(() => window.iynkware.world.scene.getObjectByName('session-controls')?.visible === false));
  await page.click('#enter');
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
    await page.evaluate(() => window.__x('accept_session'));
    await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
  });
  await sleep(3000);
};

/** The cluster from the head: distance, degrees off the head's heading `deg` (left positive), height under the eyes. */
const clusterFrom = (deg) =>
  page.evaluate((a0) => {
    const p = window.__spot('session-controls');
    const e = window.__head();
    const a = (a0 * Math.PI) / 180;
    const dx = p[0] - e[0];
    const dz = p[2] - e[2];
    const along = dx * -Math.sin(a) + dz * -Math.cos(a);
    const left = -(dx * Math.cos(a) - dz * Math.sin(a));
    return { d: +Math.hypot(dx, p[1] - e[1], dz).toFixed(3), leftDeg: +((Math.atan2(left, along) * 180) / Math.PI).toFixed(1), below: +(e[1] - p[1]).toFixed(3) };
  }, deg);
const atDefault = (c) => !!c && c.d > 0.8 && c.d < 0.9 && c.leftDeg > 45 && c.leftDeg < 65 && c.below > 0.1 && c.below < 0.4;

// Turn the head about the y axis and aim a controller ray at a button.
const turn = async (deg, pos = { x: 0, y: 1.2, z: 0 }) => {
  const h = (deg * Math.PI) / 360;
  await page.evaluate(([y, w, p]) => window.__x('set_transform', { device: 'headset', position: p, orientation: { x: 0, y: y, z: 0, w } }), [Math.sin(h), Math.cos(h), pos]);
};
/** Points `device` at `name` along the line from the head, from `back` metres before it; returns the device's pose. */
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
  return { o, q };
};
const trigger = async (v, device = 'controller-right') => page.evaluate(([x, dev]) => window.__x('set_select_value', { device: dev, value: x }), [v, device]);
/** Holds select on `device` aimed at the grip, glides it by `delta` in steps (keeping its turn), lets go. */
const dragGrip = async (device, delta, steps = 8) => {
  const { o, q } = await aimAt(GRIP, 0.25, device);
  await trigger(1, device);
  await sleep(250);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const at = { x: o[0] + delta[0] * k, y: o[1] + delta[1] * k, z: o[2] + delta[2] * k };
    await page.evaluate(([dev, p, ori]) => window.__x('set_transform', { device: dev, position: p, orientation: ori }), [device, at, q]);
    await sleep(90);
  }
  await sleep(250);
  await trigger(0, device);
  await sleep(400);
};
const press = async (name, device = 'controller-right', back = 0.25) => {
  await aimAt(name, back, device);
  await trigger(1, device);
  await sleep(180);
  await trigger(0, device);
};
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

await page.goto(target.href, { waitUntil: 'load' });
await page.evaluate(() => localStorage.removeItem('iynk:xr:panels:v1'));
await boot();
check('controls shown in the session', await waitFor(() => window.iynkware.world.scene.getObjectByName('session-controls')?.visible === true, null, 8000), await page.evaluate(() => window.iynkware.app.mode.value));
const start = await clusterFrom(0);
check('on the left, out of the forward view, 0.8 to 0.9 m away, a little below eye level', atDefault(start), start);
check('turned to face the head', (await page.evaluate(() => window.__facing('session-controls'))) > 0.98);
check('the cluster has the grip bar and it takes rays', await page.evaluate((g) => window.__hittable(g), GRIP));
if (SHOT) await page.screenshot({ path: SHOT });

// 1. Drag by controller ray and trigger on the grip: 0.12 m right and 0.06 m up.
const p0 = await page.evaluate(() => window.__spot('session-controls'));
await dragGrip('controller-right', [0.12, 0.06, 0]);
const p1 = await page.evaluate(() => window.__spot('session-controls'));
let ev = await page.evaluate(() => window.__ev.splice(0));
check('controller ray + trigger on the grip drags the cluster', ev.includes('select-start:controller/ray') && dist(p0, p1) > 0.08, { ev, from: r3(p0), to: r3(p1) });
check('its place is stored', !!(await page.evaluate((id) => window.__stored()?.places?.[id], ID)));

// 2. Drag by hand pinch along the hand ray: 0.08 m left and down.
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(800);
await dragGrip('hand-right', [-0.08, -0.05, 0]);
const p2 = await page.evaluate(() => window.__spot('session-controls'));
ev = await page.evaluate(() => window.__ev.splice(0));
check('hand pinch on the grip drags the cluster', ev.includes('select-start:hand/ray') && dist(p1, p2) > 0.05, { ev, from: r3(p1), to: r3(p2) });
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(600);

// 3. Turn the head and walk: the cluster stays where it is in the room.
await turn(90);
await sleep(2500);
const p3 = await page.evaluate(() => window.__spot('session-controls'));
check('fixed in the room: turning and walking leave it put', dist(p2, p3) < 0.005, { before: r3(p2), after: r3(p3) });
check('it turns in place to keep facing the head', (await page.evaluate(() => window.__facing('session-controls'))) > 0.98);

// 4. Recentre by controller ray: the bench eases to in front of the turned head, and the cluster comes back beside it.
const before = await page.evaluate(() => window.iynkware.app.bench.benchTop.value);
await press('button:session/recentre');
await sleep(1200);
const after = await page.evaluate(() => window.iynkware.app.bench.benchTop.value);
// Head at (0, 1.2, 0) turned 90 degrees to the left looks along -x: the bench should now be at negative x, near z = 0.
check('Recentre moved the bench in front of the turned head', after.position[0] < -0.3 && Math.abs(after.position[2]) < 0.1 && Math.abs(after.yawRad - Math.PI / 2) < 0.05, { before, after });
const rec = await clusterFrom(90);
check('Recentre brings the cluster back to its place on the left of the turned head', atDefault(rec), rec);
check('Recentre forgets the moved place', !(await page.evaluate((id) => window.__stored()?.places?.[id], ID)));
const pRec = await page.evaluate(() => window.__spot('session-controls'));

// 5. Home from anywhere: the Home button opens Home in front of the turned head.
await page.evaluate(() => window.iynkware.app.shell.closeHome());
await sleep(600);
await press('button:session/home');
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

// 6. The menu's Tidy up puts a moved cluster back where it was put for the person.
// The head stays at the height it recentred from: the cluster's place beside the bench assumes it.
await turn(0);
await sleep(800);
await dragGrip('controller-right', [0.1, 0.05, 0]);
const p6 = await page.evaluate(() => window.__spot('session-controls'));
check('moved again before Tidy up', dist(p6, pRec) > 0.05, { home: r3(pRec), moved: r3(p6) });
await page.evaluate(() => window.__x('set_transform', { device: 'controller-right', position: { x: 0.2, y: 1.3, z: -0.3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }));
const stick = async () => {
  await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-left', buttons: [{ index: 2, value: 1 }], axes: [] }));
  await sleep(200);
  await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-left', buttons: [{ index: 2, value: 0 }], axes: [] }));
  await sleep(700);
};
await stick();
check('the menu opens', await waitFor(() => window.iynkware.world.scene.getObjectByName('shell-panel:menu')?.visible, null, 3000));
const slot = await page.evaluate(() => {
  const order = ['bench', 'view', 'tools'];
  const items = order.flatMap((g) => window.iynkware.app.shell.menuItems.value.filter((i) => i.group === g));
  return items.findIndex((i) => i.id === 'ui/tidy');
});
for (let p = 0; p < Math.floor(slot / 6); p++) {
  await press('button:menu/page', 'controller-right', 0.35);
  await sleep(500);
}
await press(`button:menu/item-${slot}`, 'controller-right', 0.35);
await sleep(800);
const p7 = await page.evaluate(() => window.__spot('session-controls'));
check('Tidy up puts the cluster back in its place beside the person', dist(p7, pRec) < 0.01, { home: r3(pRec), now: r3(p7) });
check('Tidy up forgets its stored place', !(await page.evaluate((id) => window.__stored()?.places?.[id], ID)));

// 7. Move it once more, up and away from the bench's end; it must come back there after a reload (step 9).
await dragGrip('controller-right', [0, 0.1, 0.12]);
const local8 = await page.evaluate(() => window.__local('session-controls'));
check('moved before the reload, and stored', !!(await page.evaluate((id) => window.__stored()?.places?.[id], ID)));

// 8. Exit: a tap does nothing.
await page.evaluate(() => window.__ev.splice(0));
// The controller held near the body (0.6 m back along the line from the head): any nearer, it would sit over the
// bench's end, in poke range of the Look inside chips, and a poke there wins over the ray.
await press('button:session/exit', 'controller-right', 0.6);
await sleep(600);
ev = await page.evaluate(() => window.__ev.splice(0));
check('a tap on Exit keeps the session', ev.includes('select:session/exit:controller/ray') && (await page.evaluate(() => window.iynkware.world.session != null && window.iynkware.world.visibilityState.value === 'visible')), ev);
// Exit: a held trigger ends it.
await trigger(1);
await sleep(300);
const mid = await page.evaluate(() => window.iynkware.world.scene.getObjectByName('session-controls').userData.sessionControls.exit.holdProgress);
await sleep(900);
await trigger(0).catch(() => undefined); // the session may already be over
await page.waitForFunction(() => window.iynkware.world.session == null, null, { timeout: 5000 }).catch(() => undefined);
check('hold ring filled part way, then Exit ended the session', mid > 0.1 && mid < 1 && (await page.evaluate(() => window.iynkware.world.session == null)), { mid });

// 9. A moved cluster comes back after a reload (relative to the bench, like every panel).
await page.reload({ waitUntil: 'load' });
await boot();
const local9 = await page.evaluate(() => window.__local('session-controls'));
check('after a reload the cluster is where it was left (relative to the bench)', !!local9 && dist(local8, local9) < 0.01, { before: r3(local8), after: r3(local9) });
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
