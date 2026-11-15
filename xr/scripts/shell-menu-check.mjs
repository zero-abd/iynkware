// The in-headset Menu in the IWER emulator, headless: left thumbstick click opens it, a controller ray and trigger on
// Drones opens the drone and goes to the Range, the menu's Home row opens Home there, the menu again with Bench goes back, the Blink lesson changes the
// project, and the palm button (hand input, left palm turned to the head) opens it too.
//
//   npx vite --mode http --port 23182                          # in another terminal
//   node scripts/shell-menu-check.mjs [url] [shot.png]         # url defaults to http://localhost:23182/
//
// IWER numbers the left thumbstick click 2 in set_gamepad_state (index 3 is X); the raw xr-standard gamepad has it at 3.
// Exit 0 when every check passes. Playwright comes with @iwsdk/vite-plugin-dev.
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23182/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
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

await page.goto(target.href, { waitUntil: 'load' });
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 60000 });
await page.evaluate(async () => {
  await window.iynkware.ready;
  const w = window.iynkware.world;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  window.__pos = (name) => {
    const o = w.scene.getObjectByName(name);
    return o ? o.getWorldPosition(w.camera.position.clone()).toArray() : null;
  };
  window.__menu = () => {
    const g = w.scene.getObjectByName('shell-panel:menu');
    return !!g && g.visible;
  };
  window.__state = () => {
    const a = window.iynkware.app;
    return { place: a.shell.place.value, offered: a.shell.offered.value, project: a.project.doc.id, title: a.project.doc.title };
  };
});
await sleep(800);
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await sleep(1500);
const start = await page.evaluate(() => window.__state());
// Entry opens Home (when the lead's Home is mounted); the menu check starts from a clear view.
await page.waitForFunction(() => window.iynkware.app.shell.homeOpen.value, null, { timeout: 8000 }).catch(() => undefined);
await page.evaluate(() => window.iynkware.app.shell.closeHome());
await sleep(400);

const stick = async () => {
  await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-left', buttons: [{ index: 2, value: 1 }], axes: [] }));
  await sleep(200);
  await page.evaluate(() => window.__x('set_gamepad_state', { device: 'controller-left', buttons: [{ index: 2, value: 0 }], axes: [] }));
  await sleep(700);
};
const press = async (device, name, back) => {
  const p = await page.evaluate((n) => window.__pos(n), name);
  if (!p) return false;
  await page.evaluate(([d, q, b]) => window.__x('set_transform', { device: d, position: { x: q[0], y: q[1], z: q[2] + b }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [device, p, back]);
  await sleep(450);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 1 }), device);
  await sleep(220);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 0 }), device);
  await sleep(500);
  return true;
};
const waitFor = (fn, arg, ms = 12000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

// 1. Left stick click opens the menu.
check('menu closed at first', !(await page.evaluate(() => window.__menu())));
await stick();
check('left stick click opens the menu', await page.evaluate(() => window.__menu()));
const names = await page.evaluate(() =>
  [...window.iynkware.world.scene.children].length &&
  ['home', 'projects', 'settings', 'place-bench', 'place-room', 'place-range', 'lesson-blink', 'new', 'leave'].filter((n) => window.iynkware.world.scene.getObjectByName(`button:menu/${n}`)),
);
check('menu has Home, Projects, Settings, three places, Blink, New project, Leave', names.length === 9, names);
// Look at the menu: head a little back, level, for the picture.
if (SHOT) {
  await sleep(300);
  await page.screenshot({ path: SHOT });
}

// 2. Ray and trigger on Drones.
check('ray + trigger on Drones', await press('controller-right', 'button:menu/place-range', 0.35));
const toRange = await waitFor(() => window.__state().place === 'range', null, 15000);
const st = await page.evaluate(() => window.__state());
check('place is range and the drone project is open', toRange && st.project !== start.project && st.project.startsWith('prj_drone'), { start, st });
check('menu closed after the switch', await waitFor(() => !window.__menu(), null, 3000));

// 2b. From the Range, the menu's Home row opens Home and closes the menu.
await stick();
await press('controller-right', 'button:menu/home', 0.35);
const homeUp = await waitFor(() => window.iynkware.app.shell.homeOpen.value && !!window.iynkware.world.scene.getObjectByName('shell-panel:home')?.visible && !window.__menu(), null, 4000);
check('menu Home row opens Home from the Range', homeUp, await page.evaluate(() => ({ ...window.__state(), home: window.iynkware.app.shell.homeOpen.value, menu: window.__menu() })));
await page.evaluate(() => window.iynkware.app.shell.closeHome());
await sleep(600);

// 3. Menu again: Bench.
await stick();
check('menu opens again in the Range', await page.evaluate(() => window.__menu()));
const sel = await page.evaluate(() => window.__state().place);
await press('controller-right', 'button:menu/place-bench', 0.35);
check('Bench goes back to the bench', (await waitFor(() => window.__state().place === 'bench', null, 6000)) && sel === 'range');

// 4. Menu: the Blink lesson changes the project.
await stick();
const before = await page.evaluate(() => window.__state());
await press('controller-right', 'button:menu/lesson-blink', 0.35);
await sleep(2500);
const after = await page.evaluate(() => window.__state());
check('Blink lesson changes the project', after.project !== before.project, { before, after });

// 5. Close by the Close button; and by a second stick click.
await stick();
check('menu opens', await page.evaluate(() => window.__menu()));
await stick();
check('second stick click closes it', await waitFor(() => !window.__menu(), null, 3000));

// 6. Palm button: hand input, left palm turned to the head. Sweeps the hand's roll about x until the palm faces the head.
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(800);
const head = await page.evaluate(() => window.iynkware.world.camera.getWorldPosition(window.iynkware.world.camera.position.clone()).toArray());
const handAt = { x: head[0] - 0.1, y: head[1] - 0.15, z: head[2] - 0.4 };
const palmTry = async (deg) => {
  const a = (deg * Math.PI) / 360;
  await page.evaluate(([p, o]) => window.__x('set_transform', { device: 'hand-left', position: p, orientation: o }), [handAt, { x: Math.sin(a), y: 0, z: 0, w: Math.cos(a) }]);
  await sleep(500);
  return page.evaluate(([h]) => {
    const pose = window.iynkware.app.input.pose('left');
    const g = window.iynkware.world.scene.getObjectByName('shell-button:menu/palm');
    const gp = window.iynkware.world.player.gripSpaces.left.getWorldPosition(window.iynkware.world.camera.position.clone()).toArray();
    const dir = [h[0] - gp[0], h[1] - gp[1], h[2] - gp[2]];
    const l = Math.hypot(...dir);
    return {
      open: pose?.open,
      n: pose?.normal.map((v) => +v.toFixed(2)),
      dot: pose ? +(pose.normal.reduce((s, v, i) => s + (v * dir[i]) / l, 0)).toFixed(2) : null,
      shown: !!g && g.visible,
      off: g && g.visible ? +Math.hypot(...g.getWorldPosition(window.iynkware.world.camera.position.clone()).toArray().map((v, i) => v - gp[i])).toFixed(3) : null,
    };
  }, [head]);
};
const tries = [];
for (const deg of [0, 180, -90, 90, -135, 135, -45, 45]) tries.push([deg, await palmTry(deg)]);
console.log('palm tries (roll about x in degrees, palm.open, normal, dot to head, shown, button distance from the grip)', JSON.stringify(tries));
const good = tries.find(([, r]) => r.shown);
check('palm button hidden while the palm faces away', tries.some(([, r]) => !r.shown && r.dot < 0.4));
check('palm button shows when the palm faces the head, about 6 cm off the palm', !!good && Math.abs(good[1].off - 0.06) < 0.02 && good[1].dot > 0.5, good);
if (good) {
  await palmTry(good[0]);
  check('menu is closed before the palm press', !(await page.evaluate(() => window.__menu())));
  await press('hand-right', 'shell-button:menu/palm', 0.3);
  check('pinch on the palm button opens the menu', await waitFor(() => window.__menu(), null, 3000));
  await palmTry(good[0]);
  await press('hand-right', 'shell-button:menu/palm', 0.3);
  check('pinch on the palm button again closes it', await waitFor(() => !window.__menu(), null, 3000));
  await palmTry(0);
  check('palm button hides when the palm turns away', !(await palmTry(0)).shown);
}
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
