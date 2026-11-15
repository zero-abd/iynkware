// Hand flight in the IWER emulator, headless (issue #123): arm with the hold plate (a short pinch does not arm), fly with
// the gimbal rings (left hand up climbs, right hand away flies forward), let go and hover, switch to Guide and drag the
// target. `?project=prj_drone-quad5`.
//
//   npx vite --mode http --port 23123 --strictPort     # in another terminal
//   node scripts/range-hands-check.mjs [url] [shot.png]
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23123/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_drone-quad5');
const SHOT = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[page error]', m.text().slice(0, 200)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};
const ev = (fn, arg) => page.evaluate(fn, arg);

// A person who has been through the first-run onboarding: its panel would stand in front and take every pinch.
await page.addInitScript(() => localStorage.setItem('iynkware:xr:onboarding:v1', 'skipped'));
await page.goto(target.href, { waitUntil: 'load' });
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 60000 });
await ev(async () => {
  await window.iynkware.ready;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
});
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await ev(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await sleep(800);
await ev(() => window.iynkware.app.shell.closeHome());
await ev(() => window.iynkware.app.shell.go('range'));
await page.waitForFunction(() => {
  let f = null;
  window.iynkware.world.scene.traverse((o) => o.userData?.hands && (f = o));
  return !!f;
}, null, { timeout: 60000 });
await ev(() => {
  window.__root = () => {
    let f = null;
    window.iynkware.world.scene.traverse((o) => o.userData?.hands && (f = o));
    return f;
  };
  window.__fl = () => window.__root().userData.flight;
  window.__frame = () => {
    const f = window.__fl().runner.frame;
    return { armed: f.armed, x: +f.x.toFixed(2), y: +f.y.toFixed(2), z: +f.z.toFixed(2) };
  };
  window.__hands = () => window.__root().userData.hands;
  window.__plate = (n) => window.iynkware.world.scene.getObjectByName(n).getWorldPosition(window.iynkware.world.camera.position.clone()).toArray();
});
// Home opens on entering for a person who has seen onboarding; it would stand in front of the plates too
await ev(() => window.iynkware.app.shell.closeHome());
await ev(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(600);
check('nothing of the shell stands in front', await ev(() => !window.iynkware.app.shell.homeOpen.value && !window.iynkware.world.scene.getObjectByName('shell-panel:onboarding')?.visible));
check('hands are the source', (await ev(() => window.iynkware.app.input.sources.value)).right === 'hand');
const head = await ev(() => window.iynkware.world.camera.getWorldPosition(window.iynkware.world.camera.position.clone()).toArray());

const setHand = (d, p) => ev(([d, p]) => window.__x('set_transform', { device: d, position: { x: p[0], y: p[1], z: p[2] }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [d, p]);
const pinch = (d, v) => ev(([d, v]) => window.__x('set_select_value', { device: d, value: v }), [d, v]);

// The hand aims at a plate from in front and to the right of it, turned towards it. Straight in front it sits on the
// session controls (Home, Recentre and Exit, just below the view): its fingertip hovers Exit, and IWSDK gives the
// fingertip the pinch before the ray.
const AIM = { right: 0.3, ahead: 0.2 };
const aimAt = (d, p) => {
  const yaw = Math.atan2(AIM.right, AIM.ahead); // turns -Z towards -X: the ray points back at the plate
  return ev(
    ([d, p, yaw, aim]) =>
      window.__x('set_transform', { device: d, position: { x: p[0] + aim.right, y: p[1], z: p[2] + aim.ahead }, orientation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } }),
    [d, p, yaw, AIM],
  );
};

// Arm: a short pinch on the hold plate does nothing, a held one arms
const a = await ev(() => window.__plate('hands:arm'));
await aimAt('hand-right', a);
await sleep(500);
await pinch('hand-right', 1);
await sleep(250);
await pinch('hand-right', 0);
await sleep(300);
check('short pinch does not arm', (await ev(() => window.__frame())).armed === false);
await pinch('hand-right', 1);
await sleep(300);
const mid = await ev(() => window.__hands().held());
await sleep(700);
await pinch('hand-right', 0);
await sleep(300);
check('held pinch arms', mid === true && (await ev(() => window.__frame())).armed === true, await ev(() => window.__frame()));

// Rings: pinch both hands in the air off any target
const hy = head[1] - 0.15;
await setHand('hand-left', [head[0] - 0.2, hy, head[2] - 0.45]);
await setHand('hand-right', [head[0] + 0.2, hy, head[2] - 0.45]);
await sleep(500);
await pinch('hand-left', 1);
await pinch('hand-right', 1);
await sleep(400);
check('rings claim the sticks', await ev(() => window.__hands().claimed()), await ev(() => window.__hands().mode()));
const f0 = await ev(() => window.__frame());
await setHand('hand-left', [head[0] - 0.2, hy + 0.05, head[2] - 0.45]);
await sleep(1200);
const f1 = await ev(() => window.__frame());
check('left hand up climbs', f1.z > f0.z + 0.2, { f0, f1 });
await setHand('hand-left', [head[0] - 0.2, hy, head[2] - 0.45]);
await sleep(600);
await setHand('hand-right', [head[0] + 0.2, hy, head[2] - 0.5]);
await sleep(1200);
const f2 = await ev(() => window.__frame());
check('right hand away flies forward', Math.hypot(f2.x - f1.x, f2.y - f1.y) > 0.3, { f1, f2 });
if (SHOT) await page.screenshot({ path: SHOT });
const calls = await ev(() => window.iynkware.world.renderer.info.render.calls);
await pinch('hand-left', 0);
await pinch('hand-right', 0);
await sleep(1500);
check('let go releases the claim', (await ev(() => window.__hands().claimed())) === false);
// Letting go centres the sticks: the craft levels and coasts down, it is not driven on (it may reach the field's edge)
const speed = async () => {
  const p = await ev(() => window.__fl().runner.session.sim.v.slice(0, 2));
  return Math.hypot(p[0], p[1]);
};
const v0 = await speed();
await sleep(1500);
const v1 = await speed();
check('let go hovers (speed falls, sticks centred)', v1 <= v0 + 0.05, { v0, v1 });
await ev(() => { window.__fl().reset(); window.__fl().arm(); });
await sleep(800);

// Guide: switch, drag the target
const m = await ev(() => window.__plate('hands:mode'));
await aimAt('hand-right', m);
await sleep(500);
await pinch('hand-right', 1);
await sleep(250);
await pinch('hand-right', 0);
await sleep(300);
check('toggle to guide', (await ev(() => window.__hands().mode())) === 'guide');
const c0 = await ev(() => window.__frame());
await setHand('hand-right', [head[0] + 0.1, hy, head[2] - 0.45]);
await sleep(500);
await pinch('hand-right', 1);
await sleep(300);
await setHand('hand-right', [head[0] + 0.1 + 0.25, hy + 0.1, head[2] - 0.45]);
await sleep(600);
const tgt = await ev(() => window.__hands().target());
await pinch('hand-right', 0);
await sleep(3000);
const c1 = await ev(() => window.__frame());
const tgt2 = await ev(() => window.__hands().target());
check('guide target drags and the craft follows', tgt && Math.hypot(c1.x - c0.x, c1.y - c0.y, c1.z - c0.z) > 0.5, { c0, c1, tgt, tgt2 });
if (SHOT) await page.screenshot({ path: SHOT.replace('.png', '-guide.png') });
console.log('render calls', calls, await ev(() => window.iynkware.world.renderer.info.render.calls));
await browser.close();
process.exit(fails ? 1 : 0);
