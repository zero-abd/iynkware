// The calm default layout in the IWER emulator, headless (issue #298). On entry Home is alone: the lesson guide steps
// back behind it, Look inside is closed and takes no rays. With Home closed the bench shows the
// work, the run cluster, the rail, the shelf, the tools rack and the guide. The menu's Look inside switch opens it
// (pressed with a controller ray), the Close beside Look inside's grip bar closes it, and the switch shows it closed.
// A drone at the bench: its design panel starts closed, the menu's Drone design row opens it, its Close closes it, and
// the row leaves with the bench. The Build it with me pill offers itself on an empty bench only.
//
//   npx vite --mode http --port 23298                       # in another terminal
//   node scripts/layout-check.mjs [url] [shot-prefix]       # url defaults to http://localhost:23298/
//
// Exit 0 when every check passes. Playwright comes with @iwsdk/vite-plugin-dev.
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23298/');
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

await page.goto(target.href, { waitUntil: 'load' });
await page.evaluate(() => localStorage.removeItem('iynk:xr:panels:v1'));
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
  // Seen: there and visible all the way up. Hittable: seen and no ancestor closed to pointers.
  window.__seen = (name) => {
    let o = w.scene.getObjectByName(name);
    if (!o) return null;
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  };
  window.__hittable = (name) => {
    let o = w.scene.getObjectByName(name);
    if (!o) return null;
    for (; o; o = o.parent) if (!o.visible || o.pointerEvents === 'none') return false;
    return true;
  };
  window.__row = (id) => window.iynkware.app.shell.menuItems.value.find((i) => i.id === id) ?? null;
  window.__on = (id) => window.__row(id)?.toggle?.value ?? null;
  window.__menu = () => !!w.scene.getObjectByName('shell-panel:menu')?.visible;
  // What shows now, for the audit in the PR.
  window.__audit = () => {
    const names = {
      home: 'shell-panel:home',
      guide: 'guide:panel',
      lookInside: 'scale:panel',
      meter: 'run-meter',
      scopeProbe: 'run:scope:probe',
      serialPlate: 'run:serial:plate',
      serialPanel: 'run-serial-panel',
      scopeScreen: 'run-scope-screen',
      buildWithMe: 'assistant:build-with-me',
      shelf: 'bench:shelf',
      design: 'range/design-panel',
      range: 'range-room',
    };
    return Object.fromEntries(Object.entries(names).map(([k, n]) => [k, window.__seen(n)]));
  };
});
await sleep(600);
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});

const aim = async (device, name, back) => {
  const p = await page.evaluate((n) => window.__pos(n), name);
  if (!p) return null;
  await page.evaluate(([d, q, b]) => window.__x('set_transform', { device: d, position: { x: q[0], y: q[1], z: q[2] + b }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [device, p, back]);
  await sleep(400);
  return p;
};
const press = async (device, name, back = 0.35) => {
  if (!(await aim(device, name, back))) return false;
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 1 }), device);
  await sleep(220);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 0 }), device);
  await sleep(500);
  return true;
};
/** Presses `name` with a ray along its own face normal from `back` metres out: clear of the tools on the bench below. */
const pressFacing = async (device, name, back = 0.35) => {
  const pose = await page.evaluate(([n, b]) => {
    const w = window.iynkware.world;
    const o = w.scene.getObjectByName(n);
    if (!o) return null;
    const V = w.camera.position.constructor;
    const Q = w.camera.quaternion.constructor;
    const p = o.getWorldPosition(new V());
    const z = new V(0, 0, 1).transformDirection(o.matrixWorld);
    const q = new Q().setFromUnitVectors(new V(0, 0, 1), z);
    return { position: { x: p.x + z.x * b, y: p.y + z.y * b, z: p.z + z.z * b }, orientation: { x: q.x, y: q.y, z: q.z, w: q.w } };
  }, [name, back]);
  if (!pose) return false;
  await page.evaluate(([d, ps]) => window.__x('set_transform', { device: d, ...ps }), [device, pose]);
  await sleep(400);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 1 }), device);
  await sleep(220);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 0 }), device);
  await sleep(500);
  return true;
};
const stick = async () => {
  await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-left', buttons: [{ index: 2, value: 1 }], axes: [] }));
  await sleep(200);
  await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-left', buttons: [{ index: 2, value: 0 }], axes: [] }));
  await sleep(700);
};
const headAhead = () => page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }));
/** The row's slot on the open menu (pillar rows by group, bench, view, tools, six to a page), paged to. */
let menuPage = 0;
const pressRow = async (id) => {
  const slot = await page.evaluate((rid) => {
    const order = ['bench', 'view', 'tools'];
    const items = order.flatMap((g) => window.iynkware.app.shell.menuItems.value.filter((i) => i.group === g));
    return items.findIndex((i) => i.id === rid);
  }, id);
  if (slot < 0) return false;
  const want = Math.floor(slot / 6);
  while (menuPage !== want) {
    await press('controller-right', 'button:menu/page');
    menuPage = (menuPage + 1) % 99;
    if (menuPage > 6) return false;
  }
  return press('controller-right', `button:menu/item-${slot}`);
};
const openMenu = async () => {
  if (!(await page.evaluate(() => window.__menu()))) await stick();
  menuPage = 0;
  return waitFor(() => window.__menu(), null, 3000);
};
const closeMenu = async () => {
  if (await page.evaluate(() => window.__menu())) await stick();
  return waitFor(() => !window.__menu(), null, 3000);
};

// 1. Entry: Home alone. The Blink lesson is open behind it.
check('Home opens on entry', await waitFor(() => window.__seen('shell-panel:home'), null, 8000));
await page.evaluate(() => window.iynkware.app.lessons.open('prj_uno-r3-blink').catch(() => undefined));
check('the lesson guide is built', await waitFor(() => !!window.iynkware.world.scene.getObjectByName('guide:panel'), null, 12000));
await sleep(800);
const entry = await page.evaluate(() => window.__audit());
console.log('entry:', JSON.stringify(entry));
check('on entry the guide steps back behind Home and takes no rays', entry.guide === false && (await page.evaluate(() => window.__hittable('panel-grip:learn/guide'))) !== true, entry);
check('on entry Look inside is closed and takes no rays', entry.lookInside === false && (await page.evaluate(() => window.__hittable('scale:insight/seeThrough'))) !== true);
check('on a bench with parts the Build it with me pill stays away', entry.buildWithMe === false && (await page.evaluate(() => window.__hittable('assistant:build-with-me'))) !== true);
if (SHOT) await page.screenshot({ path: `${SHOT}-entry.png` });

// 2. Home closed: the bench in a lesson.
await page.evaluate(() => window.iynkware.app.shell.closeHome());
await sleep(800);
const bench = await page.evaluate(() => window.__audit());
console.log('bench (lesson):', JSON.stringify(bench));
check('with Home closed the guide is back and takes rays', bench.guide === true && (await page.evaluate(() => window.__hittable('panel-grip:learn/guide'))) === true, bench);
check('the bench in a lesson: no Look inside, no pill, no scope or serial panel', !bench.lookInside && !bench.buildWithMe && !bench.serialPanel && !bench.scopeScreen, bench);
if (SHOT) await page.screenshot({ path: `${SHOT}-bench.png` });

// 3. The menu opens Look inside; its own Close closes it.
await headAhead();
check('the menu opens', await openMenu());
check('the menu has a Look inside switch, off', (await page.evaluate(() => window.__on('scale/look-inside'))) === false);
check('pressing Look inside on the menu (controller ray)', await pressRow('scale/look-inside'));
check('Look inside opens and takes rays', await waitFor(() => window.__seen('scale:panel') && window.__hittable('scale:insight/seeThrough'), null, 3000));
check('its switch shows on', (await page.evaluate(() => window.__on('scale/look-inside'))) === true);
check('the menu closes', await closeMenu());
check("Look inside's Close sits beside its grip bar and takes rays", await page.evaluate(() => window.__hittable('panel-close:scale/look-inside')));
await headAhead();
check("pressing Look inside's Close", await pressFacing('controller-right', 'panel-close:scale/look-inside'));
check('Look inside closes and takes no rays', await waitFor(() => !window.__seen('scale:panel') && window.__hittable('scale:insight/seeThrough') !== true, null, 3000));
check('its switch shows off', (await page.evaluate(() => window.__on('scale/look-inside'))) === false);

// 4. A free project on an empty bench: the pill offers Build it with me.
await page.evaluate(async () => {
  const { emptyBench } = await import('/src/assistant/empty.ts');
  window.iynkware.app.lessons.close?.();
  window.iynkware.app.project.open(emptyBench(window.iynkware.app.project.doc));
});
check('on an empty bench the Build it with me pill shows and takes rays', await waitFor(() => window.__seen('assistant:build-with-me') && window.__hittable('assistant:build-with-me'), null, 4000));
const free = await page.evaluate(() => window.__audit());
console.log('bench (free, empty):', JSON.stringify(free));
check('the free bench: no Look inside, no guide', !free.lookInside && !free.guide, free);

// 5. A drone at the bench: the design panel starts closed and opens from the menu's Drone design row.
await page.evaluate(async () => {
  const app = window.iynkware.app;
  app.project.open(await app.templates.load('prj_drone-quad5'));
});
check('with a drone at the bench the menu has a Drone design switch, off', await waitFor(() => window.__on('range/design') === false, null, 8000));
await sleep(600);
check('the design panel starts closed', !(await page.evaluate(() => !!window.iynkware.world.scene.getObjectByName('range/design-panel'))));
await page.evaluate(() => window.__row('range/design').run());
check('the Drone design row opens it', await waitFor(() => window.__seen('range/design-panel'), null, 8000));
await sleep(700);
const drone = await page.evaluate(() => window.__audit());
console.log('bench (drone, design open):', JSON.stringify(drone));
await headAhead();
check("pressing the design panel's Close", await pressFacing('controller-right', 'panel-close:range/design'));
check('the design panel closes and its switch shows off', await waitFor(() => !window.iynkware.world.scene.getObjectByName('range/design-panel') && window.__on('range/design') === false, null, 3000));

// 6. The range: the flight essentials; the Drone design row leaves with the bench.
await page.evaluate(() => window.iynkware.app.shell.go('range'));
check('the range opens', await waitFor(() => window.iynkware.app.shell.place.value === 'range', null, 6000));
await sleep(1500);
const range = await page.evaluate(() => window.__audit());
console.log('range:', JSON.stringify(range));
check('at the range there is no Drone design row', (await page.evaluate(() => window.__row('range/design'))) === null);
check('the range: no Look inside, no design panel', !range.lookInside && !range.design, range);
if (SHOT) await page.screenshot({ path: `${SHOT}-range.png` });

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
