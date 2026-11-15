// Movable panels in the IWER emulator, headless: Home's grip bar is dragged by a controller ray and trigger, the
// panel follows and faces the head, stays put when let go and when Home is closed and opened again; a hand pinch along
// the hand ray drags it again; after a reload Home comes back where it was left; the menu's Tidy up puts it back in
// its default place; a closed panel's grip takes no rays. The Blink lesson's guide has a grip too.
//
//   npx vite --mode http --port 23268                       # in another terminal
//   node scripts/panels-check.mjs [url] [shot.png]          # url defaults to http://localhost:23268/
//
// Exit 0 when every check passes. Playwright comes with @iwsdk/vite-plugin-dev.
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23268/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
const SHOT = process.argv[3];
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
    window.__home = () => w.scene.getObjectByName('shell-panel:home');
    window.__homeAt = () => window.__home()?.getWorldPosition(new V()).toArray() ?? null;
    window.__homeLocal = () => {
      const g = window.__home();
      return g ? window.iynkware.app.bench.table.worldToLocal(g.getWorldPosition(new V())).toArray() : null;
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
      if (e.target.startsWith('panel-grip')) window.__ev.push(`${e.type}:${e.target}:${e.pointer.source}/${e.pointer.mode}`);
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
const GRIP = 'panel-grip:shell/home';

await page.goto(target.href, { waitUntil: 'load' });
await page.evaluate(() => localStorage.removeItem('iynk:xr:panels:v1'));
await boot();
check('Home opens on entry', await waitFor(() => window.__home()?.visible, null, 8000));
await sleep(700);
check('Home has the grip bar under it and it takes rays', await page.evaluate((g) => window.__hittable(g), GRIP));
const home0 = await page.evaluate(() => window.__homeAt());
const grip0 = await page.evaluate((g) => window.__pos(g), GRIP);
check('the grip sits under Home, centred', !!grip0 && !!home0 && grip0[1] < home0[1] - 0.25 && Math.abs(grip0[0] - home0[0]) < 0.01, { home: r3(home0), grip: r3(grip0) });

// 1. Controller ray and trigger on the grip, glide 0.3 m right and 0.08 m up.
const at = await aim('controller-right', GRIP, 0.35);
await dragBy('controller-right', at, [0.3, 0.08, 0]);
let ev = await page.evaluate(() => window.__ev.splice(0));
const home1 = await page.evaluate(() => window.__homeAt());
const moved1 = home1 && [home1[0] - home0[0], home1[1] - home0[1], home1[2] - home0[2]];
check('controller ray + trigger on the grip starts a drag', ev.includes('select-start:panel-grip/shell/home:controller/ray') && ev.includes('select-end:panel-grip/shell/home:controller/ray'), ev);
check('Home followed the controller (about 0.3 m right, 0.08 m up)', !!moved1 && Math.abs(moved1[0] - 0.3) < 0.06 && Math.abs(moved1[1] - 0.08) < 0.04, { moved: r3(moved1) });
check('Home faces the head after the drag', (await page.evaluate(() => window.__facing('shell-panel:home'))) > 0.98);
await sleep(600);
const home1b = await page.evaluate(() => window.__homeAt());
check('Home stays where it was let go', dist(home1, home1b) < 0.002, { after: r3(home1b) });
const stored1 = await page.evaluate(() => window.__stored());
check('the place is stored per panel id, relative to the bench', !!stored1?.places?.['shell/home'], stored1);

// 2. Close and open Home again: it comes back where it was left, not ahead of the head.
await page.evaluate(() => window.iynkware.app.shell.closeHome());
await sleep(600);
check('a closed Home grip takes no rays', (await page.evaluate((g) => window.__hittable(g), GRIP)) === false);
await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 }, orientation: { x: 0, y: 0.2588, z: 0, w: 0.9659 } }));
await sleep(400);
await page.evaluate(() => window.iynkware.app.shell.openHome());
await sleep(800);
const home2 = await page.evaluate(() => window.__homeAt());
check('opened again (head turned 30 degrees), Home is back where it was left', dist(home2, home1) < 0.01, { home2: r3(home2), home1: r3(home1) });
await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }));
await sleep(500);

// 3. A hand: pinch along the hand ray on the grip, glide 0.2 m left and 0.1 m down.
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(800);
const atH = await aim('hand-right', GRIP, 0.3);
await dragBy('hand-right', atH, [-0.2, -0.1, 0]);
ev = await page.evaluate(() => window.__ev.splice(0));
const home3 = await page.evaluate(() => window.__homeAt());
const moved3 = home3 && [home3[0] - home2[0], home3[1] - home2[1], home3[2] - home2[2]];
check('hand pinch on the grip starts a drag', ev.includes('select-start:panel-grip/shell/home:hand/ray'), ev);
check('Home followed the hand (about 0.2 m left, 0.1 m down) and faces the head', !!moved3 && Math.abs(moved3[0] + 0.2) < 0.06 && Math.abs(moved3[1] + 0.1) < 0.05 && (await page.evaluate(() => window.__facing('shell-panel:home'))) > 0.98, { moved: r3(moved3) });
const local3 = await page.evaluate(() => window.__homeLocal());
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(400);
if (SHOT) await page.screenshot({ path: SHOT });

// 4. Reload: Home comes back at the same place relative to the bench.
await page.reload({ waitUntil: 'load' });
await boot();
check('after a reload Home opens again', await waitFor(() => window.__home()?.visible, null, 8000));
await sleep(900);
const local4 = await page.evaluate(() => window.__homeLocal());
check('after a reload Home is where it was left (relative to the bench)', dist(local4, local3) < 0.01, { before: r3(local3), after: r3(local4) });

// 5. The menu's Tidy up: Home goes back to its default place and the record is gone. Home is closed first, so it is
// not between the controller and the menu (1.0 m ahead).
await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }));
await page.evaluate(() => window.iynkware.app.shell.closeHome());
await sleep(500);
const stick = async () => {
  await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-left', buttons: [{ index: 2, value: 1 }], axes: [] }));
  await sleep(200);
  await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-left', buttons: [{ index: 2, value: 0 }], axes: [] }));
  await sleep(700);
};
await stick();
check('the menu opens', await waitFor(() => window.iynkware.world.scene.getObjectByName('shell-panel:menu')?.visible, null, 3000));
check('the menu panel has a grip too', await page.evaluate(() => window.__hittable('panel-grip:shell/menu')));
// Tidy up's row: the menu lists pillar rows by group (bench, view, tools), six to a page.
const slot = await page.evaluate(() => {
  const order = ['bench', 'view', 'tools'];
  const items = order.flatMap((g) => window.iynkware.app.shell.menuItems.value.filter((i) => i.group === g));
  return items.findIndex((i) => i.id === 'ui/tidy');
});
check('Tidy up is a menu row', slot >= 0, slot);
for (let p = 0; p < Math.floor(slot / 6); p++) await press('controller-right', 'button:menu/page', 0.35);
const tidyName = `button:menu/item-${slot}`;
check('Tidy up shows on the menu', !!(await page.evaluate((n) => window.__pos(n), tidyName)));
await press('controller-right', tidyName, 0.35);
await sleep(500);
const stored5 = await page.evaluate(() => window.__stored());
check('Tidy up forgets every moved place', !stored5?.places?.['shell/home'], stored5);
check('the menu closes after Tidy up', await waitFor(() => !window.iynkware.world.scene.getObjectByName('shell-panel:menu')?.visible, null, 3000));
await page.evaluate(() => window.iynkware.app.shell.openHome());
await sleep(800);
const local5 = await page.evaluate(() => window.__homeLocal());
const home5 = await page.evaluate(() => window.__homeAt());
const head5 = await page.evaluate(() => window.__head());
check('after Tidy up Home opens in its default place: 0.95 m straight ahead', dist(local5, local4) > 0.1 && Math.abs(dist(home5, head5) - 0.95) < 0.05 && Math.abs(home5[0] - head5[0]) < 0.05, { home: r3(home5), head: r3(head5), was: r3(local4) });

// 6. The lesson guide has the grip as well.
await page.evaluate(() => window.iynkware.app.shell.closeHome());
await page.evaluate(() => window.iynkware.app.lessons.open('prj_uno-r3-blink').catch(() => undefined));
const guide = await waitFor(() => !!window.iynkware.world.scene.getObjectByName('panel-grip:learn/guide'), null, 10000);
check('the lesson guide carries a grip', guide);

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
