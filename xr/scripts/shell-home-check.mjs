// Home in the IWER emulator, headless: Home opens on entering the headset; its tiles switch inside the session to the
// drone in the Range place, the Blink lesson, a new project from a template, and Continue; Close closes it.
//
//   npx vite --mode http --port 23081                       # in another terminal
//   node scripts/shell-home-check.mjs [url] [shot.png]      # url defaults to http://localhost:8081/
//
// Exit 0 when every check passes. Playwright comes with @iwsdk/vite-plugin-dev.
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:8081/';
const SHOT = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const warnings = [];
let step = 'load';
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[vite]') || t.includes('GPU stall')) return;
  if (m.type() === 'error' || m.type() === 'warning') warnings.push(`${step}: ${m.type()} ${t.slice(0, 200)}`);
});
page.on('pageerror', (e) => warnings.push(`pageerror ${e.message}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};

const waitFor = (fn, arg, ms = 15000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

// A person who has been through the first-run onboarding: for a first-timer it opens on entry in Home's place.
await page.addInitScript(() => localStorage.setItem('iynkware:xr:onboarding:v1', 'skipped'));
await page.goto(URL, { waitUntil: 'load' });
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 60000 });
await page.evaluate(async () => {
  await window.iynkware.ready;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  const { app, world } = window.iynkware;
  window.__home = () => {
    const g = world.scene.getObjectByName('shell-panel:home');
    return { open: app.shell.homeOpen.value, visible: !!g?.visible, place: app.shell.place.value, doc: app.project.doc.id, title: app.project.doc.meta?.title };
  };
  window.__ev = [];
  app.input.onAny((e) => {
    if (!e.type.endsWith('move')) window.__ev.push(`${e.type}:${e.target}`);
  });
  window.__pos = (name) => world.scene.getObjectByName(name)?.getWorldPosition(world.camera.position.clone()).toArray() ?? null;
});
check('home closed on the flat page', await page.evaluate(() => !window.iynkware.app.shell.homeOpen.value));

await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await waitFor(() => window.iynkware.app.shell.homeOpen.value, null, 8000);
await sleep(900);
const entered = await page.evaluate(() => window.__home());
check('home opens on entering the headset', entered.open && entered.visible, entered);
if (SHOT) await page.screenshot({ path: SHOT });

/** Ray and trigger on a Home tile with the right controller, from `back` metres in front of it. */
const press = async (name, back = 0.12) => {
  step = name;
  const p = await page.evaluate((n) => window.__pos(`button:${n}`), name);
  if (!p) return false;
  await page.evaluate(([q, b]) => window.__x('set_transform', { device: 'controller-right', position: { x: q[0], y: q[1], z: q[2] + b }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [p, back]);
  await sleep(400);
  await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 1 }));
  await sleep(200);
  await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 0 }));
  return true;
};
const reopen = async () => {
  await page.evaluate(() => window.iynkware.app.shell.openHome());
  await sleep(700);
};

// The drone: the Range's quad opens on its workbench (Run, not the tile, goes to the Range).
check('drone tile pressed', await press('home/drone'));
const flew = await waitFor(() => window.iynkware.app.shell.place.value === 'bench' && !!window.iynkware.world.scene.getObjectByName('range-bench'));
check('drone tile: quad open on its workbench, home closed', flew && (await page.evaluate(() => !window.iynkware.app.shell.homeOpen.value)), await page.evaluate(() => window.__home()));

// Home from the drone workbench: Blink as a lesson, back on the bench.
await reopen();
check('home reopens on the drone workbench', (await page.evaluate(() => window.__home())).visible);
await press('home/blink');
const blinked = await waitFor(() => window.iynkware.app.shell.place.value === 'bench' && window.iynkware.app.lessons.last.value?.templateId === 'prj_uno-r3-blink');
check('Blink tile: lesson open on the bench', blinked, await page.evaluate(() => window.__home()));
await sleep(800);

// A template as a new library project.
await reopen();
const before = await page.evaluate(() => window.iynkware.app.project.doc.id);
await press('home/template/prj_uno-r3-button');
const made = await waitFor((id) => window.iynkware.app.project.doc.id !== id, before);
check('template tile: a new project opens', made, { ...(await page.evaluate(() => window.__home())), ev: await page.evaluate(() => window.__ev.splice(0).slice(-6)) });
await sleep(800);

// Continue: the project on the bench now, so Home just closes.
await reopen();
const docNow = await page.evaluate(() => window.iynkware.app.project.doc.id);
await press('home/continue');
await sleep(600);
const cont = await page.evaluate(() => window.__home());
check('Continue keeps the open project and closes home', !cont.open && cont.doc === docNow, cont);

// The menu from Home: Home closes, the menu opens.
await reopen();
await press('home/menu');
await sleep(900);
const menu = await page.evaluate(() => ({ home: window.iynkware.app.shell.homeOpen.value, menu: !!window.iynkware.world.scene.getObjectByName('shell-panel:menu')?.visible }));
check('Menu tile: home closes, menu opens', !menu.home && menu.menu, menu);
await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-left', buttons: [{ index: 2, value: 1 }], axes: [] }));
await sleep(300);
await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-left', buttons: [{ index: 2, value: 0 }], axes: [] }));
await sleep(900);
check('left stick click closes the menu', await page.evaluate(() => !window.iynkware.world.scene.getObjectByName('shell-panel:menu')?.visible));

// Close.
await reopen();
await press('home/close');
await sleep(700);
check('Close closes home', await page.evaluate(() => !window.iynkware.app.shell.homeOpen.value && !window.iynkware.world.scene.getObjectByName('shell-panel:home').visible));

const perf = await page.evaluate(() => window.iynkware.world.renderer.info.render.calls);
console.log('draw calls', perf);
// Closed shell panels draw nothing: no visible mesh under a hidden-or-shown shell root while all are closed. The Code
// window is left out while it is open: it stands open by itself with a board that runs a program on the bench.
const drawn = await page.evaluate(() => {
  const r = [];
  const code = window.iynkware.world.scene.getObjectByName('shell-panel:run/code');
  const codeOpen = code?.userData.code?.open === true;
  window.iynkware.world.scene.traverseVisible((o) => {
    if (!o.isMesh) return;
    if (codeOpen) for (let p = o; p; p = p.parent) if (p === code) return;
    for (let p = o; p; p = p.parent) if (/^shell-panel:|^shell-button:/.test(p.name)) return void r.push(p.name);
  });
  return r;
});
check('closed shell panels draw nothing', drawn.length === 0, drawn.slice(0, 4));
// Kit controls stay inside their panel: none may have been moved to the level root (kit/entity.ts).
const strays = await page.evaluate(() => {
  const r = [];
  window.iynkware.world.scene.traverse((o) => {
    if (/^shell-button:home|^button:home/.test(o.name) && !/^shell-panel/.test(o.parent?.name ?? '') && o.parent?.name !== '' && !/^shell-button|shell-panel-body/.test(o.parent?.name ?? '')) r.push(`${o.name} < ${o.parent?.name}`);
  });
  return r;
});
check('home controls stay inside the panel', strays.length === 0, strays.slice(0, 3));
for (const w of warnings.slice(0, 8)) console.log('[page]', w);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
